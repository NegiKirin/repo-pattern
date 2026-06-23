import path from "node:path";
import { execFileSync } from "node:child_process";
import { auditProject } from "./audit.mjs";
import { readJson, writeJson } from "./fs-utils.mjs";

function pass(label) {
  console.log(`[PASS] ${label}`);
}

function fail(label) {
  console.log(`[FAIL] ${label}`);
}

function info(label) {
  console.log(`[INFO] ${label}`);
}

function isTracked(root, relPath) {
  try {
    const output = execFileSync("git", ["ls-files", relPath], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export async function doctorProject(target, { updateLock = false, dryRun = false } = {}) {
  console.log(`Repo Pattern Doctor`);
  console.log(`Target: ${target}\n`);

  const audit = await auditProject(target);
  const failures = [];

  const check = (condition, label) => {
    if (condition) pass(label);
    else {
      fail(label);
      failures.push(label);
    }
  };

  check(!audit.hasSpecify, ".specify does not exist");
  check(!audit.hasSpecKitReferences, "Spec Kit references do not exist");
  check(!audit.hasClaudeSkillsDir, ".claude/skills does not exist");
  check(!audit.hasClaudeCommandsDir, ".claude/commands does not exist");
  check(!audit.hasClaudeHooksDir, ".claude/hooks does not exist");
  check(!audit.hasClaudeScriptsDir, ".claude/scripts does not exist");
  check(!audit.hasClaudeRulesDir || audit.hasOnlyEccRulesDir, "no non-ECC .claude/rules");
  check(audit.hasClaudeDir, ".claude exists");
  check(!audit.hasSettingsHooks, ".claude/settings.json hooks is {}");
  check(!isTracked(target, ".claude/settings.local.json"), ".claude/settings.local.json is not tracked");
  check(!audit.hasHardcodedMcpPath, ".mcp.json has no absolute machine path");
  check(audit.hasRepoPatternJson, ".repo-pattern.json exists");

  const repoPattern = audit.repoPattern || {};
  check(repoPattern.workflow === "ecc-native", ".repo-pattern.json workflow=ecc-native");
  check(repoPattern.ecc?.setupOnInit === true, ".repo-pattern.json ecc.setupOnInit=true");
  check(repoPattern.runtime?.localSkills === false, ".repo-pattern.json runtime.localSkills=false");
  check(repoPattern.runtime?.localCommands === false, ".repo-pattern.json runtime.localCommands=false");
  check(repoPattern.runtime?.localHooks === false, ".repo-pattern.json runtime.localHooks=false");
  check(repoPattern.runtime?.localScripts === false, ".repo-pattern.json runtime.localScripts=false");
  check(repoPattern.runtime?.localRules === false, ".repo-pattern.json runtime.localRules=false");

  const lockPath = path.join(target, ".repo-pattern.lock.json");
  const lock = await readJson(lockPath, {});
  const settings = await readJson(path.join(target, ".claude", "settings.json"), {});
  const expectedMcpServers = lock.mcp?.enabledServers || [];
  if (expectedMcpServers.length > 0) {
    const actualMcpServers = settings.enabledMcpjsonServers || [];
    check(
      JSON.stringify(actualMcpServers) === JSON.stringify(expectedMcpServers),
      ".claude/settings.json enabledMcpjsonServers matches MCP profile"
    );
  }
  const appliedRules = lock.ecc?.appliedRules || [];
  if (appliedRules.length > 0) {
    check(audit.hasOnlyEccRulesDir, ".claude/rules/ecc contains ECC-managed project rules");
  }
  info(`ECC setup status: ${lock.ecc?.status || "unknown"}`);
  if (lock.ecc?.status === "manual-plugin-install-required") {
    info("Open Claude Code and run:");
    info("/plugin marketplace add https://github.com/affaan-m/ECC");
    info("/plugin install ecc@ecc");
  }

  if (updateLock) {
    lock.repoPattern = lock.repoPattern || {};
    lock.repoPattern.lastDoctorRun = new Date().toISOString();
    await writeJson(lockPath, lock, { dryRun });
  }

  if (failures.length > 0) {
    throw new Error(`Doctor failed with ${failures.length} failure(s).`);
  }

  console.log("\nDoctor passed.");
}
