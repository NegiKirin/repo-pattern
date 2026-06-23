import { execSync } from "node:child_process";
import path from "node:path";
import { readJson, writeJson } from "./fs-utils.mjs";

export async function setupEcc({ target, dryRun = false }) {
  console.log("ECC setup flow");

  let status = "manual-plugin-install-required";

  if (process.env.REPO_PATTERN_ECC_SETUP_CMD) {
    console.log("Using REPO_PATTERN_ECC_SETUP_CMD for ECC setup.");
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
    setupOnInit: true,
    installMode: "plugin",
    status,
    rulesSyncedBy: "setup-function",
    hooks: "plugin-managed",
    syncedAt: status === "installed" ? new Date().toISOString() : null
  };
  await writeJson(lockPath, lock, { dryRun });

  return status;
}
