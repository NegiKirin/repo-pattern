import { execFileSync, execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { appendGitignoreLine, ensureDir, exists, isTracked, writePrivateJson } from "./fs-utils.mjs";
import { printSummary } from "./prompt.mjs";

const GSTACK_REPOSITORY = "https://github.com/garrytan/gstack.git";
const GSTACK_DIR = path.join(os.homedir(), ".claude", "skills", "gstack");

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
    if (!exists(GSTACK_DIR)) console.log(`[dry-run] git clone --single-branch --depth 1 ${GSTACK_REPOSITORY} ${GSTACK_DIR}`);
    console.log(`[dry-run] cd ${GSTACK_DIR} && ./setup`);
    status = "dry-run";
  } else {
    if (!validateGstackCheckout()) {
      await ensureDir(path.dirname(GSTACK_DIR));
      execFileSync("git", ["clone", "--single-branch", "--depth", "1", GSTACK_REPOSITORY, GSTACK_DIR], { stdio: "inherit" });
    }
    execFileSync(process.platform === "win32" ? "bash" : "./setup", process.platform === "win32" ? ["./setup"] : [], { cwd: GSTACK_DIR, stdio: "inherit" });
    printSummary("gstack", [["Status", "installed for Claude Code"]]);
  }

  return status;
}
