import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { auditProject } from "./audit.mjs";
import { ensureRepoPatternGitignore, isTracked, readJson, readRepoLock, repoLockPath, writePrivateJson } from "./fs-utils.mjs";
import React from "react";
import { Box, Text, render } from "ink";
import { printBox } from "./prompt.mjs";
import { applyPlanTuneHooks, validateProjectGstack } from "./gstack.mjs";
import { isValidEccAgentProvenance, verifyAgentInventory } from "./rules.mjs";

const GROUPS = ["Workspace", "Settings & MCP", "ECC", "gstack"];

function groupFor(label) {
  if (/\.repo-pattern\/\.repo-pattern\.lock\.json ecc/.test(label)) return "ECC";
  if (/gstack|Chromium|browser/.test(label) && !label.includes(".repo-pattern/.repo-pattern.json workflow")) return "gstack";
  if (/ECC|ecc\.|\.claude\/rules\/ecc|\.claude\/agents/.test(label)) return "ECC";
  if (/settings|MCP|\.mcp\.json|\.repo-pattern\/.+lock/.test(label)) return "Settings & MCP";
  return "Workspace";
}

function repairFor(label, target) {
  if (label.includes("not tracked")) return `Stop tracking this file and retain the local copy; deleting it is not required. If credentials were committed, revoke and rotate them. Never delete local config as a substitute.`;
  if (label.includes(".repo-pattern/.repo-pattern.json")) return `Initialize repo-pattern with repo-pattern setup --target ${quoteTarget(target)} --yes, or restore valid metadata from backup.`;
  if (label.includes("lock.json")) return `Restore the lock file from backup or rerun repo-pattern setup --target ${quoteTarget(target)} --yes after reviewing local configuration.`;
  if (label.includes("settings.json") || label.includes(".mcp.json")) return `Review and repair this generated configuration from the project's selected setup; do not copy credentials into tracked files.`;
  if (label.includes(".claude exists")) return `Restore the .claude workspace directory from backup, or initialize repo-pattern with repo-pattern setup --target ${quoteTarget(target)} --yes.`;
  if (label.includes(".claude/skills") || label.includes(".claude/commands") || label.includes(".claude/hooks") || label.includes(".claude/scripts")) return `Move the unexpected runtime item only after confirming it is not project-owned; rerun repo-pattern setup --target ${quoteTarget(target)} --yes if this project should be initialized.`;
  if (label.includes("gstack")) return `Review the local gstack installation; rerun repo-pattern setup --target ${quoteTarget(target)} --yes only if that pipeline is intended.`;
  if (label.includes("ECC") || label.includes("ecc")) return `Restore the expected repo-pattern-managed ECC rules/agents, or rerun repo-pattern setup --target ${quoteTarget(target)} --yes if ECC is intended.`;
  return `Repair by restoring the expected workspace path or removing only confirmed unmanaged runtime items.`;
}

function quoteTarget(target) {
  return `'${target.replaceAll("'", "'\\''")}'`;
}

async function addEccChecks(check, audit, lock, target) {
  const appliedRules = lock.ecc?.appliedRules || [];
  const managedRulesClaimed = lock.ecc?.rulesSyncedBy === "repo-pattern-auto-cache" || appliedRules.length > 0;
  if (managedRulesClaimed) {
    const existingRules = new Set(audit.eccRulePackDirs || []);
    check(appliedRules.length > 0, ".repo-pattern/.repo-pattern.lock.json ecc.appliedRules lists synced ECC rule packs");
    check(audit.hasOnlyEccRulesDir, ".claude/rules/ecc contains only ECC-managed project rules");
    check(audit.hasClaudeEccRulesDir && existingRules.size > 0, ".claude/rules/ecc contains synced ECC rule pack directories");
    check(appliedRules.every((rule) => existingRules.has(rule)), "all locked ECC rule packs exist under .claude/rules/ecc");
  }
  const appliedAgents = lock.ecc?.appliedAgents || [];
  const managedAgentsClaimed = lock.ecc?.agentsSyncedBy === "repo-pattern-auto-cache" || appliedAgents.length > 0;
  if (managedAgentsClaimed) {
    check(audit.hasClaudeAgentsDir, ".claude/agents exists for managed ECC agents");
    check(isValidEccAgentProvenance(lock.ecc), ".repo-pattern/.repo-pattern.lock.json ECC agent provenance and manifest are valid");
    check(await verifyAgentInventory(path.join(target, ".claude", "agents"), appliedAgents), ".claude/agents exactly matches the locked ECC SHA-256 manifest");
  }
}

function renderDoctor(target, setupPipeline, checks, infoRows, verbose) {
  const failed = checks.filter((row) => !row.ok);
  const status = failed.length ? "FAIL" : "PASS";
  const groups = GROUPS.map((name) => {
    const rows = checks.filter((row) => row.group === name);
    const groupStatus = rows.some((row) => !row.ok) ? "FAIL" : rows.length ? "PASS" : "N/A";
    return { name, rows, status: groupStatus };
  });
  const warnings = infoRows.filter((row) => /browser skipped|plugin installation is required|^\/plugin /.test(row));
  const information = infoRows.filter((row) => !warnings.includes(row));
  const lines = [
    `Target  ${target}`,
    `Pipeline  ${setupPipeline}`,
    `Status  ${status} · ${checks.length - failed.length} passed, ${failed.length} failed, ${checks.length} total`,
    "",
    ...groups.map(({ name, rows, status: groupStatus }) => `${name}  ${groupStatus} · ${rows.length - rows.filter((row) => !row.ok).length} passed, ${rows.filter((row) => !row.ok).length} failed, ${rows.length} total`),
    "",
    ...(failed.length ? ["Issues", ...failed.map((row) => `✗ ${row.label}\n  Why: ${row.reason || "The expected workspace condition is not met."}\n  Repair: ${repairFor(row.label, target)}`)] : []),
    ...(warnings.length ? ["Warnings", ...warnings.map((row) => `! ${row}`)] : []),
    ...(information.length ? ["Information", ...information.map((row) => `i ${row}`)] : []),
    ...(!verbose && !failed.length ? ["Run repo-pattern doctor --verbose to show successful checks."] : [])
  ];
  if (verbose) lines.push("", "Detailed checks", ...groups.filter(({ rows }) => rows.length).flatMap(({ name, rows }) => [name, ...rows.map((row) => `${row.ok ? "✓" : "✗"} ${row.label}`)]));
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.CI || process.env.NO_COLOR || process.env.TERM === "dumb") {
    printBox("Doctor", lines);
    return;
  }

  const report = React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, { bold: true, color: "cyan" }, "Doctor"),
    ...lines.map((line, index) => {
      const heading = ["Issues", "Warnings", "Information", "Detailed checks", ...GROUPS].includes(line);
      const color = /^✗|^Status  FAIL|  FAIL ·/.test(line) ? "red"
        : /^!|^Warnings$/.test(line) ? "yellow"
        : /^✓|^Status  PASS|  PASS ·/.test(line) ? "green" : undefined;
      const dimColor = /^(Target|Pipeline|i |Run repo-pattern)|  N\/A ·/.test(line);
      return React.createElement(Box, { key: index, minHeight: 1 },
        React.createElement(Text, { bold: heading || line.startsWith("Status  "), color, dimColor, wrap: "wrap" }, line)
      );
    })
  );
  const instance = render(report, { stdin: process.stdin, stdout: process.stdout, patchConsole: false });
  instance.unmount();
}

async function updateDoctorLock(target, lockPath, lock, dryRun) {
  await ensureRepoPatternGitignore(target, { dryRun });
  const updatedLock = {
    ...lock,
    repoPattern: {
      ...(lock.repoPattern || {}),
      lastDoctorRun: new Date().toISOString()
    }
  };
  await writePrivateJson(lockPath, updatedLock, {
    dryRun,
    label: ".repo-pattern/.repo-pattern.lock.json",
    parentLabel: ".repo-pattern"
  });
}

async function addGstackChecks(check, infoRows, target, lock, settings, setupPipeline) {
  if (setupPipeline !== "gstack" && setupPipeline !== "both") return;
  const gstack = await validateProjectGstack(target);
  const checkout = gstack.checkout;
  const statePath = gstack.statePath;
  const expectedSettings = applyPlanTuneHooks(settings, {
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
  for (const runtime of gstack.runtimeChecks) check(runtime.ok, `gstack ${runtime.stage}${runtime.ok ? " executable" : `: ${runtime.error}`}`);
  check(gstack.runtimeValid, "gstack browse/design/PDF runtimes ready; rerun repo-pattern setup to repair failures");
  if (gstack.browserStatus === "skipped") infoRows.push("gstack browser skipped by persisted GSTACK_SKIP_PLAYWRIGHT=1; rerun setup without the flag to enable Chromium");
  else check(gstack.browserStatus === "ready", `gstack Chromium ${gstack.browserStatus}; rerun repo-pattern setup to repair`, { group: "gstack" });
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
    "gstack plan-tune hook files are local and executable",
    { group: "gstack" }
  );
  check(actualHooks === expectedHooks, "gstack plan-tune hooks match local settings");
  check(!hasHomePathLeak, "gstack hooks do not reference home or global paths");
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

export async function doctorProject(target, { updateLock = false, dryRun = false, silent = false, verbose = false } = {}) {
  await assertNoDoctorLockSymlink(target);
  const audit = await auditProject(target);
  const checks = [];
  const infoRows = [];

  const check = (condition, label, { silentPass = false, group = groupFor(label), reason = "" } = {}) => {
    const reasons = [
      [/not tracked/, "This generated configuration is tracked by Git and may expose machine-specific data."],
      [/\.repo-pattern\/\.repo-pattern\.json workflow/, "Repo-pattern metadata does not declare a supported setup workflow."],
      [/\.repo-pattern\/\.repo-pattern\.json/, "Repo-pattern metadata is missing or does not describe a supported setup."],
      [/settings|\.mcp\.json/, "Generated settings or selected MCP server values do not match the expected project state."],
      [/ECC|ecc\.|\.claude\/agents|\.claude\/rules\/ecc/, "ECC rules or agent inventory do not match the managed manifest."],
      [/gstack|Chromium|browser/, "The project-local gstack installation or runtime is incomplete."],
      [/\.claude\/(skills|commands|hooks|scripts)|\.claude exists/, "An unexpected Claude runtime path is present or required workspace metadata is missing."]
    ];
    const checkReason = reason || reasons.find(([pattern]) => pattern.test(label))?.[1] || "The expected workspace condition is not met.";
    checks.push({ ok: Boolean(condition), label, silent: Boolean(condition && silentPass), group, reason: checkReason });
  };

  const lockPath = repoLockPath(target);
  const lock = await readRepoLock(target, {});
  const allowSourceSkills = audit.repoPattern?.mode === "template";
  const managedSkills = audit.repoPattern?.runtime?.localSkills === true && Array.isArray(audit.repoPattern?.optionalSkills) && audit.hasOnlyManagedSkills;
  check(!audit.hasClaudeSkillsDir || allowSourceSkills || audit.hasRepoPatternJson, ".claude/skills is preserved for initialized repo-pattern projects");
  check(!audit.hasClaudeCommandsDir, ".claude/commands does not exist");
  check(!audit.hasClaudeHooksDir || audit.hasOnlyGeneratedAttributionHookFile, ".claude/hooks contains only the generated attribution hook");
  check(!audit.hasClaudeScriptsDir, ".claude/scripts does not exist");
  const usesEcc = audit.repoPattern?.workflow === "ecc-native" || audit.repoPattern?.workflow === "ecc-gstack";
  check(!audit.hasClaudeEccRulesDir || audit.hasManagedEccRules, ".claude/rules/ecc is repo-pattern-managed when present");
  check(audit.hasClaudeDir, ".claude exists");
  const usesGstack = audit.repoPattern?.workflow === "gstack" || audit.repoPattern?.workflow === "ecc-gstack";
  check(!audit.hasSettingsHooks || usesGstack || audit.hasManagedGeneratedAttributionHook, ".claude/settings.json includes the managed attribution removal hook");
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
  const expectedMcpServers = lock.mcp?.enabledServers || [];
  if (expectedMcpServers.length > 0) {
    const actualMcpServers = settings.enabledMcpjsonServers || [];
    check(
      JSON.stringify(actualMcpServers) === JSON.stringify(expectedMcpServers),
      ".claude/settings.json enabledMcpjsonServers matches selected MCP servers"
    );
  }
  await addEccChecks(check, audit, lock, target);
  await addGstackChecks(check, infoRows, target, lock, settings, setupPipeline);
  if (setupPipeline === "both") infoRows.push(`ECC setup status: ${lock.ecc?.status || "unknown"}, gstack setup status: ${lock.gstack?.status || "unknown"}`);
  else if (setupPipeline !== "none") infoRows.push(`${setupPipeline === "gstack" ? "gstack" : "ECC"} setup status: ${lock[setupPipeline]?.status || "unknown"}`);
  else infoRows.push("setup pipeline: none");
  if ((setupPipeline === "ecc" || setupPipeline === "both") && lock.ecc?.status === "manual-plugin-install-required") {
    infoRows.push("ECC plugin installation is required; open Claude Code and run:");
    infoRows.push("/plugin marketplace add https://github.com/affaan-m/ECC");
    infoRows.push("/plugin install ecc@ecc");
  }

  if (updateLock) await updateDoctorLock(target, lockPath, lock, dryRun);

  if (!silent) renderDoctor(target, setupPipeline, checks, infoRows, verbose);

  const failures = checks.filter((row) => !row.ok);
  if (failures.length > 0) {
    throw new Error(`Doctor failed with ${failures.length} failure(s).`);
  }
}
