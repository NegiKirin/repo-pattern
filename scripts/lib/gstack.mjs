import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendGitignoreLine, ensureDir, exists, isTracked, writePrivateJson } from "./fs-utils.mjs";
import { isInteractive, printSummary, withSpinner } from "./prompt.mjs";

const GSTACK_REPOSITORY = "https://github.com/garrytan/gstack.git";
const GSTACK_DIR = path.join(os.homedir(), ".claude", "skills", "gstack");
const BUN_INSTALLER_URL = "https://bun.sh/install";
const BUN_INSTALLER_MIN_BYTES = 1024;
const BUN_INSTALLER_MAX_BYTES = 1024 * 1024;
const BUN_INSTALLER_MARKERS = ["#!/usr/bin/env bash", "set -euo pipefail", "install_env=BUN_INSTALL", "github_repo=\"$GITHUB/oven-sh/bun\"", "bun_uri=$github_repo/releases/latest/download/bun-$target.zip"];

export function isValidBunInstaller(source) {
  const text = Buffer.isBuffer(source) ? source.toString("utf8") : String(source);
  return source.length >= BUN_INSTALLER_MIN_BYTES &&
    source.length <= BUN_INSTALLER_MAX_BYTES &&
    text.startsWith("#!/usr/bin/env bash\n") &&
    !text.includes("\0") &&
    BUN_INSTALLER_MARKERS.every((marker) => text.includes(marker));
}
const GSTACK_SETUP_ARGS = ["--quiet", "--no-plan-tune-hooks"];
const GSTACK_DIAGNOSTIC_MAX_CHARS = 4000;
const GSTACK_SETUP_MAX_BUFFER = 16 * 1024 * 1024;

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options });
}

function parseBunVersion(output) {
  const match = String(output).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match || Number(match[1]) < 1) throw new Error(`Bun v1.0+ is required; found ${String(output).trim() || "an invalid version"}.`);
}

function checkedBun(command, runCommand) {
  const version = runCommand(command, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
  parseBunVersion(version);
  return command;
}

export async function ensureBun({
  platform = process.platform,
  homedir = os.homedir(),
  tmpdir = os.tmpdir(),
  run: runCommand = run,
  mkdtemp = fs.mkdtemp,
  readFile = fs.readFile,
  rm = fs.rm
} = {}) {
  try {
    return checkedBun("bun", runCommand);
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Bun validation failed: ${error.message}`);
  }

  if (!["linux", "darwin"].includes(platform)) {
    throw new Error(`Bun is missing; automatic Bun installation is supported only on Linux and macOS. Install Bun v1.0+ manually on ${platform} and rerun setup.`);
  }

  console.log("Installing Bun");
  const installerDir = await mkdtemp(path.join(tmpdir, "repo-pattern-bun-"));
  const installer = path.join(installerDir, "install.sh");
  try {
    runCommand("curl", [
      "--fail", "--show-error", "--silent", "--location",
      "--proto", "=https", "--proto-redir", "=https", "--tlsv1.2",
      "--max-filesize", String(BUN_INSTALLER_MAX_BYTES), "--output", installer,
      BUN_INSTALLER_URL
    ], { stdio: "inherit" });
    const source = await readFile(installer);
    if (!isValidBunInstaller(source)) {
      throw new Error("Downloaded Bun installer failed content validation; it was not executed.");
    }
    runCommand("bash", ["-n", installer], { stdio: "ignore" });
    runCommand("bash", [installer], { stdio: "inherit" });
    return checkedBun(path.join(homedir, ".bun", "bin", "bun"), runCommand);
  } catch (error) {
    throw new Error(`Automatic Bun installation failed: ${error.message} Install Bun v1.0+ from https://bun.sh/docs/installation and rerun setup.`);
  } finally {
    await rm(installerDir, { recursive: true, force: true });
  }
}

function withoutEccPlugin(settings = {}) {
  const enabledPlugins = { ...(settings.enabledPlugins || {}) };
  const extraKnownMarketplaces = { ...(settings.extraKnownMarketplaces || {}) };
  delete enabledPlugins["ecc@ecc"];
  delete extraKnownMarketplaces.ecc;
  return { ...settings, enabledPlugins, extraKnownMarketplaces };
}

function validateGstackCheckout() {
  if (!exists(GSTACK_DIR)) return false;
  if (!exists(path.join(GSTACK_DIR, "setup"))) throw new Error(`Existing gstack checkout is invalid: ${GSTACK_DIR}/setup is missing.`);
  try {
    execFileSync("git", ["-C", GSTACK_DIR, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  } catch {
    throw new Error(`Existing gstack checkout is invalid: ${GSTACK_DIR} is not a Git worktree.`);
  }
  return true;
}

export async function removeEccPluginSettings({ target, dryRun = false }) {
  if (isTracked(target, ".claude/settings.local.json")) throw new Error(".claude/settings.local.json is tracked. Untrack it before writing local plugin settings.");
  await writePrivateJson(path.join(target, ".claude", "settings.local.json"), withoutEccPlugin, {
    dryRun,
    label: ".claude/settings.local.json",
    parentLabel: ".claude"
  });
  await appendGitignoreLine(target, ".claude/", { dryRun });
}

export function gstackEnvironment(bun, environment = process.env) {
  if (!path.isAbsolute(bun)) return { ...environment };
  return { ...environment, PATH: `${path.dirname(bun)}${path.delimiter}${environment.PATH || ""}` };
}

function redactedGstackDiagnostic(error) {
  const output = [error.stderr, error.stdout]
    .map((value) => String(value || "").slice(-65536))
    .join("\n");
  const diagnostics = [
    "Upstream output: [redacted].",
    ...(Number.isInteger(error.status) ? [`Exit code: ${error.status}.`] : []),
    ...(/\b(?:bun)\b/i.test(output) ? ["Bun prerequisite or installation failed."] : []),
    ...(/\b(?:git|clone|checkout)\b/i.test(output) ? ["Git checkout or repository operation failed."] : []),
    ...(/\b(?:network|download|fetch|connection|dns|tls|certificate)\b/i.test(output) ? ["Network or download operation failed."] : []),
    ...(/\b(?:permission|denied|access)\b/i.test(output) ? ["Permission or access check failed."] : []),
    ...(/\b(?:missing|required|not found|prerequisite)\b/i.test(output) ? ["A required prerequisite is missing or invalid."] : []),
    ...(/\b(?:unsupported)\b/i.test(output) ? ["The current environment is unsupported."] : []),
    ...(/\b(?:settings?|hooks?)\b/i.test(output) ? ["Claude Code settings or hook setup failed."] : []),
    ...(/\b(?:error|fatal|fail(?:ed|ure)?)\b/i.test(output) ? ["Upstream reported a setup failure."] : []),
    ...(/\b(?:retry|rerun)\b/i.test(output) ? ["Correct the reported prerequisite and rerun setup."] : [])
  ];
  const summary = diagnostics.length > 0 ? diagnostics.join("\n") : "No safe upstream diagnostic was available.";
  return summary.slice(0, GSTACK_DIAGNOSTIC_MAX_CHARS);
}

export function gstackSummaryRows() {
  return [["Scope", "user-global ~/.claude/skills/gstack"], ["Status", "ready"]];
}

export function runGstackSetup({
  platform = process.platform,
  bun,
  run: runCommand = run,
  log = console.error
}) {
  const command = platform === "win32" ? "bash" : "./setup";
  const args = platform === "win32" ? ["./setup", ...GSTACK_SETUP_ARGS] : GSTACK_SETUP_ARGS;
  try {
    runCommand(command, args, {
      cwd: GSTACK_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: gstackEnvironment(bun),
      maxBuffer: GSTACK_SETUP_MAX_BUFFER
    });
  } catch (error) {
    log("gstack setup diagnostics (redacted):");
    log(redactedGstackDiagnostic(error));
    throw new Error("gstack setup failed; review the diagnostics above and rerun setup.");
  }
}

export async function setupGstack({ target, dryRun = false }) {
  if (isTracked(target, ".claude/settings.local.json")) throw new Error(".claude/settings.local.json is tracked. Untrack it before writing local plugin settings.");

  let status = "installed";
  if (process.env.REPO_PATTERN_GSTACK_SETUP_CMD) {
    printSummary("gstack", [["Status", "using REPO_PATTERN_GSTACK_SETUP_CMD"]]);
    if (dryRun) {
      console.log(`[dry-run] REPO_PATTERN_TARGET=${target} ${process.env.REPO_PATTERN_GSTACK_SETUP_CMD}`);
      status = "dry-run";
    } else {
      execSync(process.env.REPO_PATTERN_GSTACK_SETUP_CMD, {
        cwd: target,
        stdio: "inherit",
        env: { ...process.env, REPO_PATTERN_TARGET: target },
        shell: true
      });
    }
  } else if (dryRun) {
    console.log("Checking gstack prerequisites");
    if (!exists(GSTACK_DIR)) {
      console.log("Cloning gstack");
      console.log(`[dry-run] git clone --single-branch --depth 1 ${GSTACK_REPOSITORY} ${GSTACK_DIR}`);
    } else {
      console.log("Using existing gstack checkout");
    }
    console.log("Running gstack setup");
    console.log(`[dry-run] cd ${GSTACK_DIR} && ./setup ${GSTACK_SETUP_ARGS.join(" ")}`);
    status = "dry-run";
  } else {
    const runSetup = async () => {
      const bun = await ensureBun();
      if (!validateGstackCheckout()) {
        console.log("Cloning gstack");
        await ensureDir(path.dirname(GSTACK_DIR));
        execFileSync("git", ["clone", "--single-branch", "--depth", "1", GSTACK_REPOSITORY, GSTACK_DIR], { stdio: "inherit" });
      } else if (!isInteractive()) {
        console.log("Using existing gstack checkout");
      }
      runGstackSetup({ bun });
    };
    if (isInteractive()) await withSpinner("Installing global gstack", runSetup);
    else {
      console.log("Checking gstack prerequisites");
      console.log("Running gstack setup");
      await runSetup();
    }
    printSummary("gstack", gstackSummaryRows());
  }

  return status;
}
