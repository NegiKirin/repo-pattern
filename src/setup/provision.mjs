import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditProject } from "../audit.mjs";
import { cleanupProject } from "../cleanup.mjs";
import { generateMcp } from "../mcp.mjs";
import { setupEcc } from "../ecc/ecc.mjs";
import { gstackCheckoutPath, gstackStatePath, setupGstack } from "../gstack/gstack.mjs";
import { doctorProject } from "../doctor.mjs";
import { applyEccRules, clearEccRules } from "../ecc/rules.mjs";
import { appendGitignoreLine, backupPaths, copyRecursive, ensureDir, ensureRepoPatternGitignore, exists, isTracked, readJson, readPrivateJson, readRepoConfig, removePath, repoConfigPath, repoLockPath, writeIfMissing, writePrivateJson } from "../shared/fs-utils.mjs";
import { copyGeneratedAttributionHook, rejectClaudeSymlink, writeClaudeSettings, writeLocalSettings } from "./settings.mjs";
import { applyOptionalSkills, OPTIONAL_SKILLS } from "../skills.mjs";
import { installHerdrIntegration } from "../herdr.mjs";

const TARGET_CLAUDE_MD = "";
const BASIC_GITIGNORE_LINES = [
  "# OS",
  ".DS_Store",
  "Thumbs.db",
  "Desktop.ini",
  "",
  "# Environment variables and secrets",
  ".env",
  ".env.*",
  "!.env.example",
  "!.env.*.example",
  "",
  "# Coding agents: generated or project-local configuration",
  ".claude/",
  ".mcp.json",
  "CLAUDE.md",
  "AGENTS.md",
  ".playwright-mcp/",
  ".repo-pattern-runtime/",
  ".gstack/",
  ".impeccable/",
  "",
  "# Local databases",
  "*.sqlite",
  "*.sqlite3",
  "*.db",
  "",
  "# Node.js",
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  ".nuxt/",
  ".vite/",
  ".turbo/",
  "*.tsbuildinfo",
  "",
  "# Python",
  "__pycache__/",
  "*.py[cod]",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  ".venv/",
  "venv/",
  "",
  "# Java / JVM",
  ".gradle/",
  "target/",
  "*.class",
  "",
  "# Go",
  "bin/",
  "*.test",
  "coverage.out",
  "",
  "# Rust",
  "target/"
];

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

async function repoPatternConfig(sourceRoot, setupPipeline) {
  const template = await readJson(path.join(sourceRoot, ".repo-pattern.example.json"), {});
  const { ecc, mcp: templateMcp = {}, ...base } = template;
  const { profile: _profile, ...mcp } = templateMcp;
  return {
    ...base,
    workflow: workflowName(setupPipeline),
    ...(usesEcc(setupPipeline) ? { ecc } : {}),
    mode: "target",
    mcp: {
      ...mcp,
      generated: true
    }
  };
}

function lockConfig(target, setupPipeline, lock = {}, pipelineStatus = {}, planTuneHooks = false) {
  const { profile: _profile, ...mcp } = lock.mcp || {};
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
      ...mcp,
      generatedAt: null
    }
  };
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
    let handle;
    try {
      handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (error.code === "ENOENT") return { file, exists: false, content: null };
      if (error.code === "ELOOP") throw new Error(`provision snapshot source must not be a symlink: ${file}`);
      throw error;
    }
    try {
      return { file, exists: true, content: await handle.readFile() };
    } finally {
      await handle.close();
    }
  }));
  const snapshotRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-provision-transaction-"));
  const directories = [
    { path: path.join(target, ".claude", "agents"), snapshot: path.join(snapshotRoot, "agents") },
    { path: path.join(target, ".claude", "rules", "ecc"), snapshot: path.join(snapshotRoot, "ecc-rules") },
    { path: path.join(target, ".claude", "hooks"), snapshot: path.join(snapshotRoot, "hooks") },
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
    if (!entry.exists) {
      await fs.rm(entry.file, { force: true });
      continue;
    }
    await ensureDir(path.dirname(entry.file));
    const temporary = await fs.mkdtemp(path.join(path.dirname(entry.file), `.${path.basename(entry.file)}-rollback-`));
    const temporaryFile = path.join(temporary, path.basename(entry.file));
    try {
      await fs.writeFile(temporaryFile, entry.content, { flag: "wx", mode: 0o600 });
      await fs.rename(temporaryFile, entry.file);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
}

async function removeProvisionSnapshot(snapshot) {
  if (snapshot) await fs.rm(snapshot.snapshotRoot, { recursive: true, force: true });
}

export async function provisionProject({ sourceRoot, target, setupPipeline = "ecc", planTuneHooks = false, mcpServers = [], mcpValues = {}, dryRun = false, force = false, migrate = false, localSettingsEnv = null, effortLevel = "medium", attributionConfig = { mode: "off" }, permissionConfig = { bypass: "deny" }, ruleMode = "auto", rules = null, applyRules = null, optionalSkills = [], interactiveSetup = false, output = null, progressAdapter = null, renderProgress = null, onBeforeSuccessSummary = null, resolveGstackCheckout }) {
  const presentation = output || {};
  const createProgress = progressAdapter?.create || (() => null);
  if (!SETUP_PIPELINES.includes(setupPipeline)) throw new Error(`Unknown setup pipeline: ${setupPipeline}. Available: ${SETUP_PIPELINES.join(", ")}`);
  const shouldApplyRules = applyRules ?? usesEcc(setupPipeline);
  if (planTuneHooks && !usesGstack(setupPipeline)) throw new Error("--with-plan-tune-hooks requires --setup-pipeline gstack or both.");
  if (!interactiveSetup) presentation.summary?.("Provisioning target", [["Target", target]]);
  await rejectClaudeSymlink(target, { dryRun });
  const audit = await auditProject(target);
  if (!interactiveSetup) presentation.audit?.(audit);

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
  const progress = createProgress(progressPlan, {
    interactive: interactiveSetup,
    hasExtendedSkills: localOptionalSkills.length > 0 || hasPluginOnlySkills,
    renderProgress
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
    await copyGeneratedAttributionHook(sourceRoot, target, { dryRun, silent: interactiveSetup });
    advanceWorkspace("Writing Claude settings");
    await appendGitignoreLine(target, ".claude/", { dryRun, silent: interactiveSetup });
    await writeLocalSettings({ sourceRoot, target, localSettingsEnv, effortLevel, setupPipeline, optionalSkills, dryRun, silent: interactiveSetup });
    advanceWorkspace("Writing local settings");
    await ensureRepoPatternGitignore(target, { dryRun, silent: interactiveSetup });
    advanceWorkspace("Writing workspace state");
    mcpResult = await generateMcp({ sourceRoot, target, mcpServers, mcpValues, dryRun, progress, silent: interactiveSetup });
    if (mcpResult.warnings) setupWarnings.push(...mcpResult.warnings);
    workspace?.complete({ detail: dryRun ? "preview" : "completed" });
    eccStatus = usesEcc(setupPipeline) ? await setupEcc({ sourceRoot, target, dryRun, configurePlugin: false, silent: interactiveSetup, output: presentation }) : null;
    await writePrivateJson(repoConfigPath(target), await repoPatternConfig(sourceRoot, setupPipeline), {
      dryRun,
      label: ".repo-pattern/.repo-pattern.json",
      parentLabel: ".repo-pattern",
      silent: interactiveSetup
    });
    const eccRulesResult = shouldApplyRules
      ? await applyEccRules({ target, dryRun, ruleMode, rules, progress, silent: interactiveSetup, output: presentation })
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
    if (!audit.hasRepoPatternJson && audit.state !== "LEGACY_VENDOR" && optionalSkills.includes("herdr")) {
      await installHerdrIntegration({ target, dryRun, silent: interactiveSetup });
    }
    if (hasPluginOnlySkills) progress?.completeGroup?.("skills");
  } catch (error) {
    progress?.fail({ detail: "failed" });
    progress?.flush?.();
    let rollbackResult = "Rollback: completed.";
    try {
      await restoreProvisionState(provisionSnapshot);
    } catch (rollbackError) {
      rollbackResult = `Rollback: failed — ${rollbackError.message}`;
      if (!interactiveSetup) presentation.warn?.(`WARN: Provision rollback failed: ${rollbackError.message}`);
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
      if (!interactiveSetup) presentation.warn?.(`WARN: Provision rollback snapshot cleanup failed: ${cleanupError.message}`);
      else setupWarnings.push(`Provision rollback snapshot cleanup failed: ${cleanupError.message}`);
    }
  }

  if (usesGstack(setupPipeline)) gstackStatus = await setupGstack({ target, dryRun, planTuneHooks, progress, silent: interactiveSetup, ...(resolveGstackCheckout ? { resolveCheckout: resolveGstackCheckout } : {}) });
  const gstackFailed = gstackStatus?.status === "failed";
  if (gstackFailed) {
    progress?.failGroup?.("components", "gstack setup");
    progress?.fail({ detail: "gstack setup failed" });
    progress?.flush?.();
    const gstackError = `gstack setup failed: ${gstackStatus.error}`;
    const recovery = gstackStatus.error.includes("gstack clone failed")
      ? `Recovery: verify Git access and network connectivity, then rerun repo-pattern setup --target ${shellQuote(target)} --setup-pipeline ${setupPipeline} --yes`
      : gstackStatus.error.includes("Failed stage: Bun validation")
        ? `Recovery: install Bun v1.4.2+ or rerun repo-pattern setup --target ${shellQuote(target)} --setup-pipeline ${setupPipeline} --yes`
        : `Recovery: rerun repo-pattern setup --target ${shellQuote(target)} --setup-pipeline ${setupPipeline} --yes and review the safe gstack diagnostic above`;
    const currentLock = await readPrivateJson(lockPath, {}, {
      label: ".repo-pattern/.repo-pattern.lock.json",
      parentLabel: ".repo-pattern"
    });
    await writePrivateJson(lockPath, lockConfig(target, setupPipeline, currentLock, { ecc: eccStatus, gstack: gstackStatus }, planTuneHooks), {
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
  await writePrivateJson(lockPath, lockConfig(target, setupPipeline, currentLock, { ecc: eccStatus, gstack: gstackStatus }, planTuneHooks), {
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
  const compactSummary = warnings.length > 0 ? [["Warnings", warnings.join("; ")]] : [];
  const detailedSummary = [
    ["Status", dryRun ? `preview only; ${pending.length ? `${pending.join(", ")} pending` : presentation.style?.("success", "ready") || "ready"}` : pending.length ? `${pending.join(", ")} pending` : presentation.style?.("success", "ready") || "ready"],
    ["Target", target],
    ["Setup pipeline", setupPipeline],
    ["Pipeline scope", setupPipelineScope(setupPipeline)],
    ...(usesGstack(setupPipeline) ? [["gstack", "installed at .claude/skills/gstack"], ["Plan-tune hooks", planTuneHooks ? "installed in .claude/settings.json" : "not installed"]] : []),
    [dryRun ? "Would write" : "Written", `CLAUDE.md (if missing), .claude/, .mcp.json, .repo-pattern/.repo-pattern.json, .repo-pattern/.repo-pattern.lock.json${optionalSkills.length ? ", optional skill/plugin config" : ""}`],
    ["Doctor", dryRun ? "skipped (dry-run)" : presentation.style?.("success", "passed") || "passed"],
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
  if (interactiveSetup) progress?.complete({ detail: dryRun ? "preview" : "completed", summary: compactSummary.length ? compactSummary : null });
  else {
    progress?.complete({ detail: dryRun ? "preview" : "completed" });
    presentation.summary?.("Setup complete", detailedSummary, { progress });
  }
}
