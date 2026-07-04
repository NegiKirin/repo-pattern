import path from "node:path";
import { auditProject } from "./audit.mjs";
import { isTracked, readJson, writeJson } from "./fs-utils.mjs";

function renderDoctor(target, checks, infoRows) {
  const failed = checks.filter((row) => !row.ok);
  const visibleChecks = checks.filter((row) => !row.silent);

  console.log("Repo Pattern Doctor");
  console.log(`Target: ${target}`);
  console.log(`Checks: ${checks.length - failed.length}/${checks.length} passed${failed.length ? `, ${failed.length} failed` : ""}\n`);

  for (const row of visibleChecks) {
    console.log(`${row.ok ? "✓" : "✗"} ${row.label}`);
  }
  for (const row of infoRows) {
    console.log(`i ${row}`);
  }
}

export async function doctorProject(target, { updateLock = false, dryRun = false } = {}) {
  const audit = await auditProject(target);
  const checks = [];
  const infoRows = [];

  const check = (condition, label, { silentPass = false } = {}) => {
    checks.push({ ok: Boolean(condition), label, silent: Boolean(condition && silentPass) });
  };

  check(!audit.hasSpecify, ".specify does not exist", { silentPass: true });
  check(!audit.hasSpecKitReferences, "Spec Kit references do not exist", { silentPass: true });
  const lockPath = path.join(target, ".repo-pattern.lock.json");
  const lock = await readJson(lockPath, {});
  const allowSourceSkills = audit.repoPattern?.mode === "template";
  check(!audit.hasClaudeSkillsDir || allowSourceSkills, ".claude/skills does not exist outside source template repos");
  check(!audit.hasClaudeCommandsDir, ".claude/commands does not exist");
  check(!audit.hasClaudeHooksDir, ".claude/hooks does not exist");
  check(!audit.hasClaudeScriptsDir, ".claude/scripts does not exist");
  check(!audit.hasClaudeRulesDir || audit.hasOnlyEccRulesDir, "no non-ECC .claude/rules");
  check(audit.hasClaudeDir, ".claude exists");
  check(!audit.hasSettingsHooks, ".claude/settings.json hooks is {}");
  check(!isTracked(target, ".claude/settings.json"), ".claude/settings.json is not tracked");
  check(!isTracked(target, ".claude/settings.local.json"), ".claude/settings.local.json is not tracked");
  check(!audit.hasHardcodedMcpPath, ".mcp.json has no absolute machine path");
  check(audit.hasRepoPatternJson, ".repo-pattern.json exists");

  const repoPattern = audit.repoPattern || {};
  check(repoPattern.workflow === "ecc-native", ".repo-pattern.json workflow=ecc-native");
  check(repoPattern.runtime?.localSkills === false, ".repo-pattern.json runtime.localSkills=false");
  check(repoPattern.runtime?.localCommands === false, ".repo-pattern.json runtime.localCommands=false");
  check(repoPattern.runtime?.localHooks === false, ".repo-pattern.json runtime.localHooks=false");
  check(repoPattern.runtime?.localScripts === false, ".repo-pattern.json runtime.localScripts=false");
  check(repoPattern.runtime?.localRules === false, ".repo-pattern.json runtime.localRules=false");

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
  infoRows.push(`ECC setup status: ${lock.ecc?.status || "unknown"}`);
  if (lock.ecc?.status === "manual-plugin-install-required") {
    infoRows.push("Open Claude Code and run:");
    infoRows.push("/plugin marketplace add https://github.com/affaan-m/ECC");
    infoRows.push("/plugin install ecc@ecc");
  }

  if (updateLock) {
    lock.repoPattern = lock.repoPattern || {};
    lock.repoPattern.lastDoctorRun = new Date().toISOString();
    await writeJson(lockPath, lock, { dryRun });
  }

  renderDoctor(target, checks, infoRows);

  const failures = checks.filter((row) => !row.ok);
  if (failures.length > 0) {
    throw new Error(`Doctor failed with ${failures.length} failure(s).`);
  }

  console.log("\nDoctor passed.");
}
