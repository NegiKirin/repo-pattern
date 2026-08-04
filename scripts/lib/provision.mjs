import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditProject, printAudit } from "./audit.mjs";
import { cleanupProject } from "./cleanup.mjs";
import { generateMcp, withoutPersistedMcpValues } from "./mcp.mjs";
import { ECC_PLUGIN, applyEccPluginSettings, setupEcc } from "./ecc.mjs";
import { gstackCheckoutPath, gstackStatePath, setupGstack } from "./gstack.mjs";
import { doctorProject } from "./doctor.mjs";
import { applyEccRules, clearEccRules } from "./rules.mjs";
import { appendGitignoreLine, backupPaths, copyRecursive, ensureDir, ensureRepoPatternGitignore, exists, isTracked, readJson, readPrivateJson, readRepoConfig, removePath, repoConfigPath, repoLockPath, writeIfMissing, writePrivateJson } from "./fs-utils.mjs";
import { printSummary, style } from "./prompt.mjs";
import { createSetupProgress } from "./progress.mjs";
import { applyOptionalSkills, OPTIONAL_SKILLS, reconcilePluginSkillSettings } from "./skills.mjs";

const TARGET_CLAUDE_MD = "";
const BASIC_GITIGNORE_LINES = [".DS_Store", "Thumbs.db", ".vscode/", ".idea/"];

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

const SETUP_PIPELINES = ["ecc", "gstack", "both", "none"];

function usesEcc(setupPipeline) {
  return setupPipeline === "ecc" || setupPipeline === "both";
}

function usesGstack(setupPipeline) {
  return setupPipeline === "gstack" || setupPipeline === "both";
}

export function setupPipelineScope(setupPipeline) {
  return {
    ecc: "project-scoped ECC",
    gstack: "project-local gstack at .claude/skills/gstack",
    both: "project-scoped ECC + project-local gstack at .claude/skills/gstack",
    none: "writes only base project metadata"
  }[setupPipeline];
}

function workflowName(setupPipeline) {
  return {
    ecc: "ecc-native",
    gstack: "gstack",
    both: "ecc-gstack",
    none: "none"
  }[setupPipeline];
}

async function repoPatternConfig(sourceRoot, profile, setupPipeline) {
  const template = await readJson(path.join(sourceRoot, ".repo-pattern.example.json"), {});
  const { ecc, ...base } = template;
  return {
    ...base,
    workflow: workflowName(setupPipeline),
    ...(usesEcc(setupPipeline) ? { ecc } : {}),
    mode: "target",
    mcp: {
      ...(template.mcp || {}),
      profile,
      generated: true
    }
  };
}

function lockConfig(target, profile, setupPipeline, lock = {}, pipelineStatus = {}, planTuneHooks = false) {
  const status = typeof pipelineStatus === "string" ? { ecc: pipelineStatus, gstack: pipelineStatus } : pipelineStatus;
  const eccStatus = status.ecc || "not-run";
  const gstack = status.gstack || { status: "not-run" };
  const gstackStatus = typeof gstack === "string" ? gstack : gstack.status;
  const now = new Date().toISOString();
  return {
    ...lock,
    repoPattern: {
      ...(lock.repoPattern || {}),
      version: "2.0.0",
      lastProvisionRun: now,
      lastDoctorRun: null
    },
    setupPipeline,
    ...(usesEcc(setupPipeline) ? {
      ecc: {
        ...(lock.ecc || {}),
        installMode: "plugin",
        status: eccStatus,
        hooks: "plugin-managed",
        syncedAt: eccStatus === "installed" ? now : null
      }
    } : {}),
    ...(usesGstack(setupPipeline) ? {
      gstack: {
        installMode: "project-local",
        source: "https://github.com/garrytan/gstack.git",
        path: path.relative(target, gstackCheckoutPath(target)),
        statePath: path.relative(target, gstackStatePath(target)),
        planTuneHooks: gstackStatus === "installed" ? planTuneHooks : false,
        status: gstackStatus,
        ...(gstackStatus === "installed" ? { syncedAt: now } : {}),
        ...(gstackStatus === "failed" ? { failedAt: now, error: gstack.error } : {})
      }
    } : {}),
    mcp: {
      ...(lock.mcp || {}),
      profile,
      generatedAt: null
    }
  };
}

export function applyAttributionSetting(settings, attributionConfig = { mode: "off" }) {
  return {
    ...settings,
    attribution: {
      commit: attributionConfig.mode === "custom" ? attributionConfig.commit : "",
      pr: ""
    }
  };
}

export function applyPermissionSettings(settings, permissionConfig = { bypass: "deny" }) {
  const permissions = { ...(settings.permissions || {}) };
  if (permissionConfig.bypass === "allow") {
    permissions.defaultMode = "bypassPermissions";
    delete permissions.disableBypassPermissionsMode;
  } else {
    permissions.defaultMode = "default";
    permissions.disableBypassPermissionsMode = "disable";
  }
  return { ...settings, permissions };
}

async function writeClaudeSettings({ sourceRoot, target, attributionConfig, permissionConfig, dryRun, silent = false }) {
  const template = await readJson(path.join(sourceRoot, ".claude.example", "settings.example.json"), {});
  const settings = applyPermissionSettings(applyAttributionSetting(template, attributionConfig), permissionConfig);
  await writePrivateJson(path.join(target, ".claude", "settings.json"), settings, {
    dryRun,
    label: ".claude/settings.json",
    parentLabel: ".claude",
    silent
  });
}

export async function updateClaudeAttribution({ sourceRoot, target, attributionConfig, dryRun }) {
  if (isTracked(target, ".claude/settings.json")) throw new Error(".claude/settings.json is tracked. Untrack it before writing Claude Code settings.");
  const file = path.join(target, ".claude", "settings.json");
  const current = await readPrivateJson(file, null, { label: ".claude/settings.json", parentLabel: ".claude" });
  const template = await readJson(path.join(sourceRoot, ".claude.example", "settings.example.json"), {});
  await writePrivateJson(file, applyAttributionSetting(current || template, attributionConfig), {
    dryRun,
    label: ".claude/settings.json",
    parentLabel: ".claude"
  });
  await appendGitignoreLine(target, ".claude/", { dryRun });
}

export async function updateClaudePermissions({ sourceRoot, target, permissionConfig, dryRun }) {
  if (isTracked(target, ".claude/settings.json")) throw new Error(".claude/settings.json is tracked. Untrack it before writing Claude Code settings.");
  const file = path.join(target, ".claude", "settings.json");
  const current = await readPrivateJson(file, null, { label: ".claude/settings.json", parentLabel: ".claude" });
  const template = await readJson(path.join(sourceRoot, ".claude.example", "settings.example.json"), {});
  await writePrivateJson(file, applyPermissionSettings(current || template, permissionConfig), {
    dryRun,
    label: ".claude/settings.json",
    parentLabel: ".claude"
  });
  await appendGitignoreLine(target, ".claude/", { dryRun });
}

export function applyLocalSettings(settings, localSettingsEnv) {
  const env = Object.fromEntries(Object.entries(withoutPersistedMcpValues({
    ...(settings.env || {}),
    ...localSettingsEnv
  })).filter(([name]) => name !== "workflowSizeGuideline"));
  return { ...settings, env };
}

export function reconcileLocalPluginSettings(settings = {}, { setupPipeline, optionalSkills = [] }) {
  const { attribution, ...withoutAttribution } = settings;
  const withoutManagedSkills = reconcilePluginSkillSettings(withoutAttribution, optionalSkills);
  const enabledPlugins = { ...(withoutManagedSkills.enabledPlugins || {}) };
  const extraKnownMarketplaces = { ...(withoutManagedSkills.extraKnownMarketplaces || {}) };
  delete enabledPlugins[ECC_PLUGIN.id];
  delete extraKnownMarketplaces[ECC_PLUGIN.marketplaceName];
  const withoutManagedPlugins = { ...withoutManagedSkills, enabledPlugins, extraKnownMarketplaces };
  return setupPipeline === "ecc" || setupPipeline === "both"
    ? applyEccPluginSettings(withoutManagedPlugins)
    : withoutManagedPlugins;
}

async function rejectClaudeSymlink(target, { dryRun = false } = {}) {
  if (dryRun) return;
  const managedPaths = [
    [".claude", ".claude"],
    [".claude/settings.json", ".claude/settings.json"],
    [".claude/settings.local.json", ".claude/settings.local.json"],
    [".repo-pattern", ".repo-pattern"],
    [".repo-pattern/.repo-pattern.json", ".repo-pattern/.repo-pattern.json"],
    [".repo-pattern/.repo-pattern.lock.json", ".repo-pattern/.repo-pattern.lock.json"]
  ];
  for (const [relativePath, label] of managedPaths) {
    try {
      if ((await fs.lstat(path.join(target, relativePath))).isSymbolicLink()) {
        throw new Error(`${label} must not be a symlink.`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function snapshotProvisionState(target, { dryRun = false } = {}) {
  if (dryRun) return null;
  const files = [
    path.join(target, "CLAUDE.md"),
    path.join(target, ".gitignore"),
    path.join(target, ".mcp.json"),
    path.join(target, ".claude", "CLAUDE.md"),
    path.join(target, ".claude", "settings.json"),
    path.join(target, ".claude", "settings.local.json"),
    repoConfigPath(target),
    repoLockPath(target),
    path.join(target, ".repo-pattern", ".gitignore")
  ];
  const snapshots = await Promise.all(files.map(async (file) => {
    try {
      return { file, exists: true, content: await fs.readFile(file) };
    } catch (error) {
      if (error.code === "ENOENT") return { file, exists: false, content: null };
      throw error;
    }
  }));
  const snapshotRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-provision-transaction-"));
  const directories = [
    { path: path.join(target, ".claude", "agents"), snapshot: path.join(snapshotRoot, "agents") },
    { path: path.join(target, ".claude", "rules", "ecc"), snapshot: path.join(snapshotRoot, "ecc-rules") },
    { path: path.join(target, ".claude", "skills"), snapshot: path.join(snapshotRoot, "skills") },
    { path: path.join(target, ".repo-pattern", "cache"), snapshot: path.join(snapshotRoot, "cache") }
  ].map((entry) => ({ ...entry, exists: exists(entry.path) }));
  for (const directory of directories) {
    if (directory.exists) await fs.cp(directory.path, directory.snapshot, { recursive: true, force: true });
  }
  return { snapshots, directories, snapshotRoot };
}

async function restoreProvisionState(snapshot) {
  if (!snapshot) return;
  for (const directory of snapshot.directories) {
    await fs.rm(directory.path, { recursive: true, force: true });
    if (directory.exists) await fs.cp(directory.snapshot, directory.path, { recursive: true, force: true });
  }
  for (const entry of snapshot.snapshots) {
    if (entry.exists) {
      await ensureDir(path.dirname(entry.file));
      await fs.writeFile(entry.file, entry.content);
    } else await fs.rm(entry.file, { force: true });
  }
}

async function removeProvisionSnapshot(snapshot) {
  if (snapshot) await fs.rm(snapshot.snapshotRoot, { recursive: true, force: true });
}

async function writeLocalSettings({ sourceRoot, target, localSettingsEnv = {}, setupPipeline, optionalSkills, dryRun, silent = false }) {
  if (isTracked(target, ".claude/settings.local.json")) throw new Error(".claude/settings.local.json is tracked. Untrack it before writing local provider settings.");
  const claudeDir = path.join(target, ".claude");
  await rejectClaudeSymlink(target, { dryRun });
  const template = await readJson(path.join(sourceRoot, ".claude.example", "settings.local.example.json"), {});
  const file = path.join(claudeDir, "settings.local.json");
  await writePrivateJson(file, (current) => reconcileLocalPluginSettings(applyLocalSettings({
    ...template,
    ...current,
    env: { ...(template.env || {}), ...(current.env || {}) }
  }, localSettingsEnv), { setupPipeline, optionalSkills }), {
    dryRun,
    label: ".claude/settings.local.json",
    silent
  });
  await appendGitignoreLine(target, ".claude/", { dryRun, silent });
}

export async function provisionProject({ sourceRoot, target, profile = "web", setupPipeline = "ecc", planTuneHooks = false, mcpServers = null, mcpValues = {}, dryRun = false, force = false, migrate = false, localSettingsEnv = null, attributionConfig = { mode: "off" }, permissionConfig = { bypass: "deny" }, ruleMode = "auto", rules = null, applyRules = null, optionalSkills = [], interactiveSetup = false, onBeforeSuccessSummary = null }) {
  if (!SETUP_PIPELINES.includes(setupPipeline)) throw new Error(`Unknown setup pipeline: ${setupPipeline}. Available: ${SETUP_PIPELINES.join(", ")}`);
  const shouldApplyRules = applyRules ?? usesEcc(setupPipeline);
  if (planTuneHooks && !usesGstack(setupPipeline)) throw new Error("--with-plan-tune-hooks requires --setup-pipeline gstack or both.");
  if (!interactiveSetup) printSummary("Provisioning target", [["Target", target]]);
  await rejectClaudeSymlink(target, { dryRun });
  const audit = await auditProject(target);
  if (!interactiveSetup) printAudit(audit);

  if (audit.state === "LEGACY_VENDOR" && !migrate) {
    throw new Error("Target has legacy/local Claude runtime surfaces. Re-run setup with --migrate, not --force.");
  }
  if (isTracked(target, ".claude/settings.json")) throw new Error(".claude/settings.json is tracked. Untrack it before writing Claude Code settings.");
  if (isTracked(target, ".repo-pattern/.repo-pattern.lock.json") || isTracked(target, ".repo-pattern.lock.json")) throw new Error("repo-pattern lock is tracked. Untrack it before writing local setup state.");

  const localOptionalSkills = optionalSkills
    .map((value) => OPTIONAL_SKILLS.find((skill) => skill.value === value))
    .filter((skill) => skill && !skill.plugin);
  const hasPluginOnlySkills = optionalSkills.some((value) => OPTIONAL_SKILLS.find((skill) => skill.value === value)?.plugin) && localOptionalSkills.length === 0;
  const progressPlan = [
    { id: "backup", label: "Backing up workspace", weight: 1 },
    { id: "workspace", label: "Generating workspace", weight: 2 },
    { id: "mcp-generation", label: "Generating MCP workspace", weight: 1 },
    ...(shouldApplyRules ? [
      { id: "ecc-cache", label: "Syncing ECC cache", weight: 3 },
      { id: "ecc-sync", label: "Staging ECC rules and agents", weight: 3 },
      { id: "ecc-backup", label: "Backing up ECC rules", weight: 1 }
    ] : []),
    ...localOptionalSkills.flatMap((skill) => [
      { id: `skill-git-${skill.value}`, label: `Syncing ${skill.value}`, weight: 2 },
      { id: `skill-copy-${skill.value}`, label: `Copying ${skill.value}`, weight: 2 }
    ]),
    ...(localOptionalSkills.length > 0 ? [{ id: "skills-backup", label: "Backing up local skills", weight: 1 }] : []),
    ...(usesGstack(setupPipeline) ? [
      { id: "gstack-checkout", label: "Downloading gstack", weight: 3 },
      { id: "gstack-bootstrap", label: "Bootstrapping gstack", weight: 2 },
      { id: "gstack-hooks", label: "Writing gstack hooks", weight: 1 }
    ] : [])
  ];
  const progress = createSetupProgress(progressPlan, {
    interactive: Boolean(interactiveSetup && process.stdin.isTTY && process.stdout.isTTY && !process.env.CI),
    ansi: Boolean(interactiveSetup && process.stdin.isTTY && process.stdout.isTTY && !process.env.CI && !process.env.NO_COLOR && process.env.TERM !== "dumb"),
    hasExtendedSkills: localOptionalSkills.length > 0 || hasPluginOnlySkills
  });
  const provisionSnapshot = await snapshotProvisionState(target, { dryRun });
  let backupRoot = null;
  const lockPath = repoLockPath(target);
  let eccStatus = null;
  let gstackStatus = null;
  let mcpResult = null;
  let eccWarnings = [];
  let setupWarnings = [];
  try {
    const previousRepoConfig = await readRepoConfig(target, {});

    if (audit.state === "LEGACY_VENDOR") {
      backupRoot = await cleanupProject({
        sourceRoot,
        target,
        dryRun,
        preserveGstack: usesGstack(setupPipeline),
        progress,
        silent: interactiveSetup
      });

    } else {
      backupRoot = await backupPaths(target, ["CLAUDE.md", ".claude/CLAUDE.md", ".claude/settings.json", ".claude/rules", ".claude/agents", ".claude/skills", ".claude/commands", ".claude/hooks", ".claude/scripts", ".repo-pattern/.repo-pattern.json", ".repo-pattern/.repo-pattern.lock.json"], { dryRun, progress, silent: interactiveSetup });
    }

    const workspace = progress?.beginOperation?.({ id: "workspace", label: "Generating workspace", totalUnits: 5, unitLabel: "items", weight: 2 });
    let workspaceCompleted = 0;
    const advanceWorkspace = (detail) => workspace?.update({ completedUnits: ++workspaceCompleted, totalUnits: 5, detail });
    await ensureDir(path.join(target, ".claude"), { dryRun, silent: interactiveSetup });

    // Target CLAUDE.md is created empty when missing so project-specific instructions can be added later. Existing target CLAUDE.md is preserved.
    await writeIfMissing(path.join(target, "CLAUDE.md"), TARGET_CLAUDE_MD, { dryRun, silent: interactiveSetup });
    for (const line of BASIC_GITIGNORE_LINES) await appendGitignoreLine(target, line, { dryRun, silent: interactiveSetup });
    advanceWorkspace("Writing project instructions");

    await copyRecursive(
      path.join(sourceRoot, ".claude.example", "CLAUDE.md"),
      path.join(target, ".claude", "CLAUDE.md"),
      { dryRun, silent: interactiveSetup }
    );
    advanceWorkspace("Copying workspace template");

    await writeClaudeSettings({ sourceRoot, target, attributionConfig, permissionConfig, dryRun, silent: interactiveSetup });
    advanceWorkspace("Writing Claude settings");
    await appendGitignoreLine(target, ".claude/", { dryRun, silent: interactiveSetup });
    await writeLocalSettings({ sourceRoot, target, localSettingsEnv, setupPipeline, optionalSkills, dryRun, silent: interactiveSetup });
    advanceWorkspace("Writing local settings");
    await ensureRepoPatternGitignore(target, { dryRun, silent: interactiveSetup });
    advanceWorkspace("Writing workspace state");
    mcpResult = await generateMcp({ sourceRoot, target, profile, mcpServers, mcpValues, dryRun, progress, silent: interactiveSetup });
    if (mcpResult.warnings) setupWarnings.push(...mcpResult.warnings);
    workspace?.complete({ detail: dryRun ? "preview" : "completed" });
    eccStatus = usesEcc(setupPipeline) ? await setupEcc({ sourceRoot, target, dryRun, configurePlugin: false, silent: interactiveSetup }) : null;
    await writePrivateJson(repoConfigPath(target), await repoPatternConfig(sourceRoot, profile, setupPipeline), {
      dryRun,
      label: ".repo-pattern/.repo-pattern.json",
      parentLabel: ".repo-pattern",
      silent: interactiveSetup
    });
    const eccRulesResult = shouldApplyRules
      ? await applyEccRules({ target, dryRun, ruleMode, rules, progress, silent: interactiveSetup })
      : await clearEccRules({ target, dryRun, silent: interactiveSetup });
    if (eccRulesResult?.warnings) eccWarnings = eccRulesResult.warnings;
    if (hasPluginOnlySkills) progress?.beginGroup?.("skills");
    await applyOptionalSkills({
      target,
      skills: optionalSkills,
      dryRun,
      reconcile: true,
      previousOptionalSkills: previousRepoConfig.optionalSkills,
      progress,
      silent: interactiveSetup
    });
    if (hasPluginOnlySkills) progress?.completeGroup?.("skills");
  } catch (error) {
    progress?.fail({ detail: "failed" });
    progress?.flush?.();
    let rollbackResult = "Rollback: completed.";
    try {
      await restoreProvisionState(provisionSnapshot);
    } catch (rollbackError) {
      rollbackResult = `Rollback: failed — ${rollbackError.message}`;
      if (!interactiveSetup) console.warn(`WARN: Provision rollback failed: ${rollbackError.message}`);
    }
    if (interactiveSetup) {
      throw new Error([
        error.message,
        rollbackResult,
        ...(backupRoot ? [`Backup: ${backupRoot}`] : []),
        `Recovery: rerun repo-pattern setup --target ${shellQuote(target)} --setup-pipeline ${setupPipeline}`
      ].join("\n"));
    }
    throw error;
  } finally {
    try {
      await removeProvisionSnapshot(provisionSnapshot);
    } catch (cleanupError) {
      if (!interactiveSetup) console.warn(`WARN: Provision rollback snapshot cleanup failed: ${cleanupError.message}`);
      else setupWarnings.push(`Provision rollback snapshot cleanup failed: ${cleanupError.message}`);
    }
  }

  if (usesGstack(setupPipeline)) gstackStatus = await setupGstack({ target, dryRun, planTuneHooks, progress, silent: interactiveSetup });
  const gstackFailed = gstackStatus?.status === "failed";
  if (gstackFailed) {
    progress?.failGroup?.("components", "Downloading gstack");
    progress?.fail({ detail: "gstack setup failed" });
    progress?.flush?.();
    const gstackError = `gstack setup failed: ${gstackStatus.error}`;
    const recovery = `Recovery: install Bun v1.0+ or fix gstack, then rerun repo-pattern setup --target ${shellQuote(target)} --setup-pipeline ${setupPipeline} --yes`;
    const currentLock = await readPrivateJson(lockPath, {}, {
      label: ".repo-pattern/.repo-pattern.lock.json",
      parentLabel: ".repo-pattern"
    });
    await writePrivateJson(lockPath, lockConfig(target, profile, setupPipeline, currentLock, { ecc: eccStatus, gstack: gstackStatus }, planTuneHooks), {
      dryRun,
      label: ".repo-pattern/.repo-pattern.lock.json",
      parentLabel: ".repo-pattern",
      silent: interactiveSetup
    });
    if (interactiveSetup) {
      const rollback = gstackStatus.rollbackErrors?.length
        ? `Rollback: failed — ${gstackStatus.rollbackErrors.join("; ")}`
        : "Rollback: completed.";
      throw new Error([
        gstackError,
        rollback,
        ...(backupRoot ? [`Backup: ${backupRoot}`] : []),
        recovery
      ].join("\n"));
    }
    throw new Error([gstackError, recovery].join("\n"));
  }

  const currentLock = await readPrivateJson(lockPath, {}, {
    label: ".repo-pattern/.repo-pattern.lock.json",
    parentLabel: ".repo-pattern"
  });
  await writePrivateJson(lockPath, lockConfig(target, profile, setupPipeline, currentLock, { ecc: eccStatus, gstack: gstackStatus }, planTuneHooks), {
    dryRun,
    label: ".repo-pattern/.repo-pattern.lock.json",
    parentLabel: ".repo-pattern",
    silent: interactiveSetup
  });
  await ensureRepoPatternGitignore(target, { dryRun, silent: interactiveSetup });

  if (!dryRun) await doctorProject(target, { updateLock: true, dryRun, silent: interactiveSetup });

  const warnings = [
    ...(eccStatus === "manual-plugin-install-required" ? ["ECC plugin pending: run /plugin install ecc@ecc in Claude Code"] : []),
    ...eccWarnings,
    ...setupWarnings
  ];
  const pending = [
    ...(eccStatus === "manual-plugin-install-required" ? ["ECC plugin"] : []),
    ...(mcpResult.missingValues.length > 0 ? ["MCP values"] : [])
  ];
  const next = dryRun
    ? "review output, then rerun without --dry-run"
    : warnings.length
      ? "resolve warnings, then run claude"
      : `cd ${shellQuote(target)} && claude`;
  const compactSummary = [
    ["Status", dryRun ? "preview only" : style("success", "ready")],
    ["Target", target],
    ...(warnings.length > 0 ? [["Warnings", warnings.join("; ")]] : []),
    ["Next", next]
  ];
  const detailedSummary = [
    ["Status", dryRun ? `preview only; ${pending.length ? `${pending.join(", ")} pending` : style("success", "ready")}` : pending.length ? `${pending.join(", ")} pending` : style("success", "ready")],
    ["Target", target],
    ["Setup pipeline", setupPipeline],
    ["Pipeline scope", setupPipelineScope(setupPipeline)],
    ...(usesGstack(setupPipeline) ? [["gstack", "installed at .claude/skills/gstack"], ["Plan-tune hooks", planTuneHooks ? "installed in .claude/settings.json" : "not installed"]] : []),
    ["Profile", profile],
    [dryRun ? "Would write" : "Written", `CLAUDE.md (if missing), .claude/, .mcp.json, .repo-pattern/.repo-pattern.json, .repo-pattern/.repo-pattern.lock.json${optionalSkills.length ? ", optional skill/plugin config" : ""}`],
    ["Doctor", dryRun ? "skipped (dry-run)" : style("success", "passed")],
    ["Next", next]
  ];
  try {
    await onBeforeSuccessSummary?.();
  } catch (error) {
    progress?.fail({ detail: "failed" });
    progress?.flush?.();
    if (interactiveSetup) {
      throw new Error([
        error.message,
        "Rollback: not required; setup content was completed.",
        `Recovery: rerun repo-pattern setup --target ${shellQuote(target)} --setup-pipeline ${setupPipeline}`
      ].join("\n"));
    }
    throw error;
  }
  progress?.complete({ detail: dryRun ? "preview" : "completed" });
  printSummary("Setup complete", interactiveSetup ? compactSummary : detailedSummary, { progress });
}
