import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject } from "./audit.mjs";
import { ensureRepoPatternGitignore, isTracked, readJson, readRepoLock, repoLockPath, writePrivateJson } from "./fs-utils.mjs";
import { readMcpConfig } from "./mcp.mjs";
import { printBox, style } from "./prompt.mjs";
import { assertCommand, assertGraphifyMcpDefinition, GRAPHIFY_MCP_COMMAND, validateGraphFile } from "./graphify.mjs";
import { applyPlanTuneHooks, validateProjectGstack } from "./gstack.mjs";
import { isValidEccAgentProvenance, verifyAgentInventory } from "./rules.mjs";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MCP_PROFILES = new Set(["backend", "web", "research", "full", "custom"]);

function renderDoctor(target, checks, infoRows) {
  const failed = checks.filter((row) => !row.ok);
  const visibleChecks = checks.filter((row) => !row.silent);

  printBox("Doctor", [
    `Target  ${target}`,
    `Checks  ${checks.length - failed.length}/${checks.length} ${style("success", "passed")}${failed.length ? `, ${failed.length} ${style("error", "failed")}` : ""}`,
    "",
    ...visibleChecks.map((row) => `${row.ok ? style("success", "✓") : style("error", "✗")} ${row.label}`),
    ...infoRows.map((row) => `${style("info", "i")} ${row}`)
  ]);
}

async function assertNoDoctorLockSymlink(target) {
  const statePath = path.dirname(repoLockPath(target));
  try {
    if ((await fs.lstat(statePath)).isSymbolicLink()) {
      throw new Error(".repo-pattern must not be a symlink.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const lockPath = repoLockPath(target);
  try {
    if ((await fs.lstat(lockPath)).isSymbolicLink()) {
      throw new Error(".repo-pattern/.repo-pattern.lock.json must not be a symlink.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function doctorProject(target, { updateLock = false, dryRun = false, silent = false, graphifyRunner = null } = {}) {
  await assertNoDoctorLockSymlink(target);
  const audit = await auditProject(target);
  const checks = [];
  const infoRows = [];

  const check = (condition, label, { silentPass = false } = {}) => {
    checks.push({ ok: Boolean(condition), label, silent: Boolean(condition && silentPass) });
  };

  const lockPath = repoLockPath(target);
  const lock = await readRepoLock(target, {});
  const allowSourceSkills = audit.repoPattern?.mode === "template";
  const managedSkills = audit.repoPattern?.runtime?.localSkills === true && Array.isArray(audit.repoPattern?.optionalSkills) && audit.hasOnlyManagedSkills;
  check(!audit.hasClaudeSkillsDir || allowSourceSkills || audit.hasRepoPatternJson, ".claude/skills is preserved for initialized repo-pattern projects");
  check(!audit.hasClaudeCommandsDir, ".claude/commands does not exist");
  check(!audit.hasClaudeHooksDir, ".claude/hooks does not exist");
  check(!audit.hasClaudeScriptsDir, ".claude/scripts does not exist");
  const usesEcc = audit.repoPattern?.workflow === "ecc-native" || audit.repoPattern?.workflow === "ecc-gstack";
  check(!audit.hasClaudeEccRulesDir || audit.hasManagedEccRules, ".claude/rules/ecc is repo-pattern-managed when present");
  check(audit.hasClaudeDir, ".claude exists");
  const usesGstack = audit.repoPattern?.workflow === "gstack" || audit.repoPattern?.workflow === "ecc-gstack";
  check(!audit.hasSettingsHooks || usesGstack, ".claude/settings.json hooks is {} unless gstack plan-tune is enabled");
  check(!isTracked(target, ".claude/settings.json"), ".claude/settings.json is not tracked");
  check(!isTracked(target, ".claude/settings.local.json"), ".claude/settings.local.json is not tracked");
  check(!isTracked(target, ".mcp.json"), ".mcp.json is not tracked");
  check(!isTracked(target, ".repo-pattern/.repo-pattern.lock.json"), ".repo-pattern/.repo-pattern.lock.json is not tracked");
  check(!audit.hasHardcodedMcpPath, ".mcp.json has no absolute machine path");
  check(audit.hasRepoPatternJson, ".repo-pattern/.repo-pattern.json exists");

  const repoPattern = audit.repoPattern || {};
  const setupPipeline = {
    "ecc-native": "ecc",
    gstack: "gstack",
    "ecc-gstack": "both",
    none: "none"
  }[repoPattern.workflow] || "ecc";
  check(["ecc-native", "gstack", "ecc-gstack", "none"].includes(repoPattern.workflow), ".repo-pattern/.repo-pattern.json workflow is ecc-native, gstack, ecc-gstack, or none");
  check(repoPattern.runtime?.localSkills === false || managedSkills, ".repo-pattern/.repo-pattern.json runtime.localSkills=false unless optional skills are managed");
  if (managedSkills) check(audit.hasClaudeSkillsDir, ".claude/skills exists for managed optional skills");
  check(repoPattern.runtime?.localCommands === false, ".repo-pattern/.repo-pattern.json runtime.localCommands=false");
  check(repoPattern.runtime?.localHooks === false, ".repo-pattern/.repo-pattern.json runtime.localHooks=false");
  check(repoPattern.runtime?.localScripts === false, ".repo-pattern/.repo-pattern.json runtime.localScripts=false");
  check(repoPattern.runtime?.localRules === false, ".repo-pattern/.repo-pattern.json runtime.localRules=false");

  const settings = await readJson(path.join(target, ".claude", "settings.json"), {});
  const hasMcpLock = Boolean(lock.mcp?.profile) || Array.isArray(lock.mcp?.enabledServers);
  if (!hasMcpLock) {
    check(false, ".repo-pattern lock contains MCP profile and enabled servers. Recovery: repo-pattern mcp --profile web --yes");
  } else {
    const profile = MCP_PROFILES.has(lock.mcp?.profile) ? lock.mcp.profile : null;
    const selectedServers = profile === "custom" ? lock.mcp?.enabledServers : null;
    const recoveryProfile = profile && profile !== "custom" ? profile : "web";
    const recovery = `Recovery: repo-pattern mcp --profile ${recoveryProfile} --yes`;
    check(Boolean(profile), `.repo-pattern MCP profile is backend, web, research, full, or custom. ${recovery}`);
    if (profile) {
      let expectedMcpServers = [];
      try {
        expectedMcpServers = (await readMcpConfig({ sourceRoot: SOURCE_ROOT, profile, mcpServers: selectedServers })).profileServers;
        check(
          JSON.stringify(lock.mcp?.enabledServers || []) === JSON.stringify(expectedMcpServers),
          ".repo-pattern lock MCP servers exactly match the current profile"
        );
      } catch (error) {
        check(false, `${error.message} ${recovery}`);
      }
      const actualMcpServers = settings.enabledMcpjsonServers || [];
      check(
        JSON.stringify(actualMcpServers) === JSON.stringify(expectedMcpServers),
        ".claude/settings.json enabledMcpjsonServers exactly matches the current MCP profile"
      );
      let mcpConfig = null;
      try {
        mcpConfig = await readJson(path.join(target, ".mcp.json"), null);
        const mcpServerIds = Object.keys(mcpConfig?.mcpServers || {});
        check(
          JSON.stringify(mcpServerIds) === JSON.stringify(expectedMcpServers),
          ".mcp.json mcpServers exactly matches the current MCP profile"
        );
      } catch {
        check(false, `.mcp.json must contain valid JSON. ${recovery}`);
      }
      let graphValid = true;
      try {
        await validateGraphFile(target);
        check(true, "graphify-out/graph.json is a valid regular JSON file");
      } catch (error) {
        graphValid = false;
        check(false, `${error.message} ${recovery}`);
      }
      if (graphValid) {
        try {
          await assertCommand(GRAPHIFY_MCP_COMMAND, { runner: graphifyRunner || undefined });
          check(true, "graphify-mcp resolves on PATH");
        } catch (error) {
          check(false, `${error.message} ${recovery}`);
        }
      }
      try {
        assertGraphifyMcpDefinition(mcpConfig?.mcpServers?.graphify);
        check(true, ".mcp.json Graphify definition uses graphify-mcp graphify-out/graph.json");
      } catch (error) {
        check(false, `${error.message} ${recovery}`);
      }
    }
  }
  const appliedRules = lock.ecc?.appliedRules || [];
  const managedRulesClaimed = lock.ecc?.rulesSyncedBy === "repo-pattern-auto-cache" || appliedRules.length > 0;
  if (managedRulesClaimed) {
    const existingRules = new Set(audit.eccRulePackDirs || []);
    check(appliedRules.length > 0, ".repo-pattern/.repo-pattern.lock.json ecc.appliedRules lists synced ECC rule packs");
    check(audit.hasOnlyEccRulesDir, ".claude/rules/ecc contains only ECC-managed project rules");
    check(audit.hasClaudeEccRulesDir && existingRules.size > 0, ".claude/rules/ecc contains synced ECC rule pack directories");
    check(appliedRules.every((rule) => existingRules.has(rule)), "all locked ECC rule packs exist under .claude/rules/ecc");
  }
  const managedAgentsClaimed = lock.ecc?.agentsSyncedBy === "repo-pattern-auto-cache" || (lock.ecc?.appliedAgents || []).length > 0;
  if (managedAgentsClaimed) {
    check(audit.hasClaudeAgentsDir, ".claude/agents exists for managed ECC agents");
    check(isValidEccAgentProvenance(lock.ecc), ".repo-pattern/.repo-pattern.lock.json ECC agent provenance and manifest are valid");
    check(await verifyAgentInventory(path.join(target, ".claude", "agents"), lock.ecc?.appliedAgents), ".claude/agents exactly matches the locked ECC SHA-256 manifest");
  }
  if (setupPipeline === "gstack" || setupPipeline === "both") {
    const gstack = await validateProjectGstack(target);
    const checkout = gstack.checkout;
    const statePath = gstack.statePath;
    const expectedSettings = applyPlanTuneHooks({ ...settings, hooks: {} }, {
      checkout,
      statePath,
      enabled: Boolean(lock.gstack?.planTuneHooks)
    });
    const actualHooks = JSON.stringify(settings.hooks || {});
    const expectedHooks = JSON.stringify(expectedSettings.hooks || {});
    const hookCommands = Object.values(settings.hooks || {}).flatMap((entries) => (entries || []).flatMap((entry) => entry.hooks || [])).map((hook) => hook.command || "");
    const hasHomePathLeak = hookCommands.some((command) => /\$HOME|~\/?\.claude\/skills\/gstack|\/\.claude\/skills\/gstack/.test(command) && !command.includes(checkout));
    check(lock.gstack?.status === "installed", ".repo-pattern/.repo-pattern.lock.json gstack.status=installed");
    check(lock.gstack?.installMode === "project-local", "gstack install mode is project-local");
    check(lock.gstack?.path === ".claude/skills/gstack" && lock.gstack?.statePath === ".repo-pattern/gstack", "gstack lock paths are project-local");
    check(gstack.checkoutValid, ".claude/skills/gstack is a valid local Git checkout");
    check(gstack.stateValid, ".repo-pattern/gstack state exists");
    check(gstack.wrappersValid, "gstack wrappers match local checkout state");
    check(gstack.assetsValid, "gstack workflow assets match local checkout state");
    check(gstack.sidecarsValid, "gstack review sidecars match local checkout state");
    check(
      !lock.gstack?.planTuneHooks || await Promise.all(["question-log-hook", "question-preference-hook"].map(async (hookName) => {
        const hook = path.join(checkout, "hosts", "claude", "hooks", hookName);
        try {
          const stat = await fs.lstat(hook);
          if (!stat.isFile() || stat.isSymbolicLink()) return false;
          await fs.access(hook, constants.X_OK);
          return true;
        } catch {
          return false;
        }
      })).then((valid) => valid.every(Boolean)),
      "gstack plan-tune hook files are local and executable"
    );
    check(actualHooks === expectedHooks, "gstack plan-tune hooks match local settings");
    check(!hasHomePathLeak, "gstack hooks do not reference home or global paths");
  }
  if (setupPipeline === "both") infoRows.push(`ECC setup status: ${lock.ecc?.status || "unknown"}, gstack setup status: ${lock.gstack?.status || "unknown"}`);
  else if (setupPipeline !== "none") infoRows.push(`${setupPipeline === "gstack" ? "gstack" : "ECC"} setup status: ${lock[setupPipeline]?.status || "unknown"}`);
  else infoRows.push("setup pipeline: none");
  if ((setupPipeline === "ecc" || setupPipeline === "both") && lock.ecc?.status === "manual-plugin-install-required") {
    infoRows.push("Open Claude Code and run:");
    infoRows.push("/plugin marketplace add https://github.com/affaan-m/ECC");
    infoRows.push("/plugin install ecc@ecc");
  }

  if (updateLock) {
    await ensureRepoPatternGitignore(target, { dryRun });
    lock.repoPattern = lock.repoPattern || {};
    lock.repoPattern.lastDoctorRun = new Date().toISOString();
    await writePrivateJson(lockPath, lock, {
      dryRun,
      label: ".repo-pattern/.repo-pattern.lock.json",
      parentLabel: ".repo-pattern"
    });
  }

  if (!silent) renderDoctor(target, checks, infoRows);

  const failures = checks.filter((row) => !row.ok);
  if (failures.length > 0) {
    throw new Error(`Doctor failed with ${failures.length} failure(s).`);
  }
}
