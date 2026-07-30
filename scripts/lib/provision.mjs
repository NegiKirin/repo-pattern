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
import { applyOptionalSkills, reconcilePluginSkillSettings } from "./skills.mjs";

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

async function writeClaudeSettings({ sourceRoot, target, attributionConfig, permissionConfig, dryRun }) {
  const template = await readJson(path.join(sourceRoot, ".claude.example", "settings.example.json"), {});
  const settings = applyPermissionSettings(applyAttributionSetting(template, attributionConfig), permissionConfig);
  await writePrivateJson(path.join(target, ".claude", "settings.json"), settings, {
    dryRun,
    label: ".claude/settings.json",
    parentLabel: ".claude"
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
    path.join(target, ".mcp.json"),
    repoConfigPath(target),
    repoLockPath(target),
    path.join(target, ".repo-pattern", ".gitignore"),
    path.join(target, ".claude", "CLAUDE.md")
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
    { path: path.join(target, ".claude", "rules", "ecc"), snapshot: path.join(snapshotRoot, "ecc-rules") }
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

async function writeLocalSettings({ sourceRoot, target, localSettingsEnv = {}, setupPipeline, optionalSkills, dryRun }) {
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
    label: ".claude/settings.local.json"
  });
  await appendGitignoreLine(target, ".claude/", { dryRun });
}

export async function provisionProject({ sourceRoot, target, profile = "web", setupPipeline = "ecc", planTuneHooks = false, mcpServers = null, mcpValues = {}, dryRun = false, force = false, migrate = false, localSettingsEnv = null, attributionConfig = { mode: "off" }, permissionConfig = { bypass: "deny" }, ruleMode = "auto", rules = null, applyRules = null, optionalSkills = [] }) {
  if (!SETUP_PIPELINES.includes(setupPipeline)) throw new Error(`Unknown setup pipeline: ${setupPipeline}. Available: ${SETUP_PIPELINES.join(", ")}`);
  const shouldApplyRules = applyRules ?? usesEcc(setupPipeline);
  if (planTuneHooks && !usesGstack(setupPipeline)) throw new Error("--with-plan-tune-hooks requires --setup-pipeline gstack or both.");
  printSummary("Provisioning target", [["Target", target]]);
  await rejectClaudeSymlink(target, { dryRun });
  const audit = await auditProject(target);
  printAudit(audit);

  if (audit.state === "LEGACY_VENDOR" && !migrate) {
    throw new Error("Target has legacy/local Claude runtime surfaces. Re-run setup with --migrate, not --force.");
  }
  if (isTracked(target, ".claude/settings.json")) throw new Error(".claude/settings.json is tracked. Untrack it before writing Claude Code settings.");
  if (isTracked(target, ".repo-pattern/.repo-pattern.lock.json") || isTracked(target, ".repo-pattern.lock.json")) throw new Error("repo-pattern lock is tracked. Untrack it before writing local setup state.");

  const provisionSnapshot = await snapshotProvisionState(target, { dryRun });
  const lockPath = repoLockPath(target);
  let eccStatus = null;
  let gstackStatus = null;
  let mcpResult = null;
  try {
    const previousRepoConfig = await readRepoConfig(target, {});

    if (audit.state === "LEGACY_VENDOR") {
      await cleanupProject({
        sourceRoot,
        target,
        dryRun,
        preserveGstack: usesGstack(setupPipeline)
      });
    } else {
      await backupPaths(target, ["CLAUDE.md", ".claude/CLAUDE.md", ".claude/settings.json", ".claude/rules", ".claude/agents", ".claude/skills", ".claude/commands", ".claude/hooks", ".claude/scripts", ".repo-pattern/.repo-pattern.json", ".repo-pattern/.repo-pattern.lock.json"], { dryRun });
    }

    await ensureDir(path.join(target, ".claude"), { dryRun });

    // Target CLAUDE.md is created empty when missing so project-specific instructions can be added later. Existing target CLAUDE.md is preserved.
    await writeIfMissing(path.join(target, "CLAUDE.md"), TARGET_CLAUDE_MD, { dryRun });
    for (const line of BASIC_GITIGNORE_LINES) await appendGitignoreLine(target, line, { dryRun });

    await copyRecursive(
      path.join(sourceRoot, ".claude.example", "CLAUDE.md"),
      path.join(target, ".claude", "CLAUDE.md"),
      { dryRun }
    );

    await writeClaudeSettings({ sourceRoot, target, attributionConfig, permissionConfig, dryRun });
    await appendGitignoreLine(target, ".claude/", { dryRun });
    await writeLocalSettings({ sourceRoot, target, localSettingsEnv, setupPipeline, optionalSkills, dryRun });
    await ensureRepoPatternGitignore(target, { dryRun });
    mcpResult = await generateMcp({ sourceRoot, target, profile, mcpServers, mcpValues, dryRun });
    eccStatus = usesEcc(setupPipeline) ? await setupEcc({ sourceRoot, target, dryRun, configurePlugin: false }) : null;
    await writePrivateJson(repoConfigPath(target), await repoPatternConfig(sourceRoot, profile, setupPipeline), {
      dryRun,
      label: ".repo-pattern/.repo-pattern.json",
      parentLabel: ".repo-pattern"
    });
    if (shouldApplyRules) await applyEccRules({ target, dryRun, ruleMode, rules });
    else await clearEccRules({ target, dryRun });
    await applyOptionalSkills({
      target,
      skills: optionalSkills,
      dryRun,
      reconcile: true,
      previousOptionalSkills: previousRepoConfig.optionalSkills
    });
  } catch (error) {
    try {
      await restoreProvisionState(provisionSnapshot);
    } catch (rollbackError) {
      console.warn(`WARN: Provision rollback failed: ${rollbackError.message}`);
    }
    throw error;
  } finally {
    try {
      await removeProvisionSnapshot(provisionSnapshot);
    } catch (cleanupError) {
      console.warn(`WARN: Provision rollback snapshot cleanup failed: ${cleanupError.message}`);
    }
  }

  if (usesGstack(setupPipeline)) gstackStatus = await setupGstack({ target, dryRun, planTuneHooks });
  const currentLock = await readPrivateJson(lockPath, {}, {
    label: ".repo-pattern/.repo-pattern.lock.json",
    parentLabel: ".repo-pattern"
  });
  await writePrivateJson(lockPath, lockConfig(target, profile, setupPipeline, currentLock, { ecc: eccStatus, gstack: gstackStatus }, planTuneHooks), {
    dryRun,
    label: ".repo-pattern/.repo-pattern.lock.json",
    parentLabel: ".repo-pattern"
  });
  await ensureRepoPatternGitignore(target, { dryRun });

  if (dryRun) console.log("[dry-run] doctor skipped because no files were written.");
  else if (gstackStatus?.status === "failed") console.log("gstack doctor skipped because gstack bootstrap failed.");
  else await doctorProject(target, { updateLock: true, dryRun });

  const pending = [
    ...(eccStatus === "manual-plugin-install-required" ? ["ECC plugin"] : []),
    ...(mcpResult.missingValues.length > 0 ? ["MCP values"] : [])
  ];
  const gstackFailed = gstackStatus?.status === "failed";
  const pendingText = gstackFailed
    ? "gstack setup failed"
    : pending.length
      ? `${pending.join(", ")} pending`
      : style("success", "ready");
  const next = dryRun
    ? "review output, then rerun without --dry-run"
    : gstackFailed
      ? `install Bun v1.0+ or fix gstack, then rerun repo-pattern setup --target ${shellQuote(target)} --setup-pipeline ${setupPipeline} --yes`
      : pending.length
        ? `resolve ${pending.join(" and ")}, then run claude`
        : `cd ${shellQuote(target)} && claude`;
  printSummary("Setup complete", [
    ["Status", dryRun ? `preview only; ${pendingText}` : pendingText],
    ["Target", target],
    ["Setup pipeline", setupPipeline],
    ["Pipeline scope", setupPipelineScope(setupPipeline)],
    ...(usesGstack(setupPipeline) ? [
      ["gstack", gstackFailed ? `FAILED — ${gstackStatus.error}` : "installed at .claude/skills/gstack"],
      ["Plan-tune hooks", !gstackFailed && planTuneHooks ? "installed in .claude/settings.json" : "not installed"]
    ] : []),
    ["Profile", profile],
    [dryRun ? "Would write" : "Written", `CLAUDE.md (if missing), .claude/, .mcp.json, .repo-pattern/.repo-pattern.json, .repo-pattern/.repo-pattern.lock.json${optionalSkills.length ? ", optional skill/plugin config" : ""}`],
    ["Doctor", dryRun ? "skipped (dry-run)" : gstackFailed ? "skipped because gstack failed" : style("success", "passed")],
    ["Next", next]
  ]);
}
