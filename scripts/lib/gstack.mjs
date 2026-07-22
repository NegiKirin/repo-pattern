import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendGitignoreLine, ensureDir, exists, isTracked, writePrivateJson } from "./fs-utils.mjs";
import { printSummary } from "./prompt.mjs";

const GSTACK_REPOSITORY = "https://github.com/garrytan/gstack.git";
const GSTACK_DIR = path.join(os.homedir(), ".claude", "skills", "gstack");
const BUN_INSTALLER_URL = "https://bun.sh/install";
const BUN_INSTALLER_MAX_BYTES = 1024 * 1024;
const BUN_INSTALLER_MARKERS = ["#!/usr/bin/env bash", "BUN_INSTALL", "github.com/oven-sh/bun/releases"];

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
    if (source.length === 0 || source.length > BUN_INSTALLER_MAX_BYTES || !BUN_INSTALLER_MARKERS.every((marker) => source.includes(marker))) {
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
    console.log(`[dry-run] cd ${GSTACK_DIR} && ./setup`);
    status = "dry-run";
  } else {
    console.log("Checking gstack prerequisites");
    const bun = await ensureBun();
    if (!validateGstackCheckout()) {
      console.log("Cloning gstack");
      await ensureDir(path.dirname(GSTACK_DIR));
      execFileSync("git", ["clone", "--single-branch", "--depth", "1", GSTACK_REPOSITORY, GSTACK_DIR], { stdio: "inherit" });
    } else {
      console.log("Using existing gstack checkout");
    }
    console.log("Running gstack setup");
    execFileSync(process.platform === "win32" ? "bash" : "./setup", process.platform === "win32" ? ["./setup"] : [], {
      cwd: GSTACK_DIR,
      stdio: "inherit",
      env: gstackEnvironment(bun)
    });
    printSummary("gstack", [["Status", "installed for Claude Code"]]);
  }

  return status;
}
