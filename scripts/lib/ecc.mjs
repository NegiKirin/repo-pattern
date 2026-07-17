import { execSync } from "node:child_process";
import path from "node:path";
import { appendGitignoreLine, isTracked, readJson, writeJson } from "./fs-utils.mjs";
import { printSummary } from "./prompt.mjs";

const ECC_PLUGIN_ID = "ecc@ecc";
const ECC_MARKETPLACE = {
  source: {
    source: "git",
    url: "https://github.com/affaan-m/ECC.git"
  }
};

export function applyEccPluginSettings(settings = {}) {
  return {
    ...settings,
    enabledPlugins: {
      ...(settings.enabledPlugins || {}),
      [ECC_PLUGIN_ID]: true
    },
    extraKnownMarketplaces: {
      ...(settings.extraKnownMarketplaces || {}),
      ecc: ECC_MARKETPLACE
    }
  };
}

function hasEccPlugin() {
  try {
    return execSync("claude plugin list", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).includes(ECC_PLUGIN_ID);
  } catch {
    return false;
  }
}

async function writeEccLocalSettings({ target, dryRun }) {
  if (isTracked(target, ".claude/settings.local.json")) throw new Error(".claude/settings.local.json is tracked. Untrack it before writing local plugin settings.");
  const file = path.join(target, ".claude", "settings.local.json");
  await writeJson(file, applyEccPluginSettings(await readJson(file, {})), { dryRun });
  await appendGitignoreLine(target, ".claude/", { dryRun });
}

export async function setupEcc({ target, dryRun = false }) {
  await writeEccLocalSettings({ target, dryRun });
  let status = hasEccPlugin() ? "installed" : "manual-plugin-install-required";

  if (status === "installed") {
    printSummary("ECC", [["Status", "plugin detected in Claude Code"]]);
  } else if (process.env.REPO_PATTERN_ECC_SETUP_CMD) {
    printSummary("ECC", [["Status", "using REPO_PATTERN_ECC_SETUP_CMD"]]);
    if (dryRun) {
      console.log(`[dry-run] REPO_PATTERN_TARGET=${target} ${process.env.REPO_PATTERN_ECC_SETUP_CMD}`);
      status = "dry-run";
    } else {
      execSync(process.env.REPO_PATTERN_ECC_SETUP_CMD, {
        cwd: target,
        stdio: "inherit",
        env: {
          ...process.env,
          REPO_PATTERN_TARGET: target
        },
        shell: true
      });
      status = "installed";
    }
  } else {
    console.log(`
Install ECC inside Claude Code:

/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc@ecc

repo-pattern does not vendor ECC skills, commands, hooks, scripts, or rules.
ECC runtime surfaces are plugin-managed.
`);
  }

  const lockPath = path.join(target, ".repo-pattern.lock.json");
  const lock = await readJson(lockPath, {});
  lock.ecc = {
    ...(lock.ecc || {}),
    installMode: "plugin",
    status,
    rulesSyncedBy: lock.ecc?.rulesSyncedBy || null,
    hooks: "plugin-managed",
    syncedAt: status === "installed" ? new Date().toISOString() : lock.ecc?.syncedAt || null
  };
  await writeJson(lockPath, lock, { dryRun });

  return status;
}
