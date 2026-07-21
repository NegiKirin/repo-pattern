import fs from "node:fs/promises";
import path from "node:path";
import { auditProject, printAudit } from "./audit.mjs";
import { cleanupProject } from "./cleanup.mjs";
import { generateMcp, withoutPersistedMcpValues } from "./mcp.mjs";
import { setupEcc } from "./ecc.mjs";
import { doctorProject } from "./doctor.mjs";
import { applyEccRules } from "./rules.mjs";
import { appendGitignoreLine, backupPaths, copyRecursive, ensureDir, ensureRepoPatternGitignore, isTracked, readJson, removePath, repoConfigPath, repoLockPath, writeJson, writeIfMissing, writePrivateJson } from "./fs-utils.mjs";
import { printSummary, style } from "./prompt.mjs";
import { applyOptionalSkills } from "./skills.mjs";

const TARGET_CLAUDE_MD = "";
const BASIC_GITIGNORE_LINES = [".DS_Store", "Thumbs.db", ".vscode/", ".idea/"];

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

async function repoPatternConfig(sourceRoot, profile) {
  const template = await readJson(path.join(sourceRoot, ".repo-pattern.example.json"), {});
  return {
    ...template,
    mode: "target",
    mcp: {
      ...(template.mcp || {}),
      profile,
      generated: true
    }
  };
}

function lockConfig(profile) {
  return {
    repoPattern: {
      version: "2.0.0",
      lastProvisionRun: new Date().toISOString(),
      lastDoctorRun: null
    },
    ecc: {
      installMode: "plugin",
      status: "not-run",
      rulesSyncedBy: null,
      rulesScope: "project",
      recommendedRules: [],
      appliedRules: [],
      detectedStack: null,
      rulesAppliedAt: null,
      hooks: "plugin-managed",
      syncedAt: null
    },
    mcp: {
      profile,
      generatedAt: null
    }
  };
}

export function applyAttributionSetting(settings, attributionConfig = { mode: "off" }) {
  const next = { ...settings };
  if (attributionConfig.mode === "on") {
    if (!next.attribution) return next;
    const { commit, ...rest } = next.attribution;
    if (Object.keys(rest).length > 0) next.attribution = rest;
    else delete next.attribution;
    return next;
  }

  next.attribution = {
    ...(next.attribution || {}),
    commit: attributionConfig.mode === "custom" ? attributionConfig.commit : ""
  };
  return next;
}

async function writeClaudeSettings({ sourceRoot, target, attributionConfig, dryRun }) {
  const template = await readJson(path.join(sourceRoot, ".claude.example", "settings.example.json"), {});
  await writeJson(path.join(target, ".claude", "settings.json"), applyAttributionSetting(template, attributionConfig), { dryRun });
}

export async function updateClaudeAttribution({ sourceRoot, target, attributionConfig, dryRun }) {
  if (isTracked(target, ".claude/settings.json")) throw new Error(".claude/settings.json is tracked. Untrack it before writing Claude Code settings.");
  const file = path.join(target, ".claude", "settings.json");
  const current = await readJson(file, null);
  const template = await readJson(path.join(sourceRoot, ".claude.example", "settings.example.json"), {});
  await writeJson(file, applyAttributionSetting(current || template, attributionConfig), { dryRun });
  await appendGitignoreLine(target, ".claude/", { dryRun });
}

export function applyLocalSettings(settings, localSettingsEnv) {
  return {
    ...settings,
    env: withoutPersistedMcpValues({
      ...(settings.env || {}),
      ...localSettingsEnv
    })
  };
}

async function rejectClaudeSymlink(target, { dryRun = false } = {}) {
  if (dryRun) return;
  let stat;
  try {
    stat = await fs.lstat(path.join(target, ".claude"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(".claude must not be a symlink.");
}

async function writeLocalSettings({ sourceRoot, target, localSettingsEnv, dryRun }) {
  if (!localSettingsEnv) return;
  if (isTracked(target, ".claude/settings.local.json")) throw new Error(".claude/settings.local.json is tracked. Untrack it before writing local provider settings.");
  const claudeDir = path.join(target, ".claude");
  await rejectClaudeSymlink(target, { dryRun });
  const template = await readJson(path.join(sourceRoot, ".claude.example", "settings.local.example.json"), {});
  const file = path.join(claudeDir, "settings.local.json");
  await writePrivateJson(file, applyLocalSettings(template, localSettingsEnv), {
    dryRun,
    label: ".claude/settings.local.json"
  });
  await appendGitignoreLine(target, ".claude/", { dryRun });
}

export async function provisionProject({ sourceRoot, target, profile = "web", mcpServers = null, mcpValues = {}, dryRun = false, force = false, migrate = false, localSettingsEnv = null, attributionConfig = { mode: "off" }, ruleMode = "auto", rules = null, applyRules = false, optionalSkills = [] }) {
  printSummary("Provisioning target", [["Target", target]]);
  await rejectClaudeSymlink(target, { dryRun });
  const audit = await auditProject(target);
  printAudit(audit);

  if (audit.state === "LEGACY_VENDOR" && !migrate) {
    throw new Error("Target has legacy/local Claude runtime surfaces. Re-run setup with --migrate, not --force.");
  }

  if (audit.state === "LEGACY_VENDOR") {
    await cleanupProject({ sourceRoot, target, dryRun });
  } else {
    await backupPaths(target, ["CLAUDE.md", ".claude/CLAUDE.md", ".claude/settings.json", ".claude/rules", ".claude/skills", ".claude/commands", ".claude/hooks", ".claude/scripts", ".repo-pattern.json", ".repo-pattern.lock.json"], { dryRun });
  }

  if (isTracked(target, ".claude/settings.json")) throw new Error(".claude/settings.json is tracked. Untrack it before writing Claude Code settings.");
  await ensureDir(path.join(target, ".claude"), { dryRun });

  // Target CLAUDE.md is created empty when missing so project-specific instructions can be added later. Existing target CLAUDE.md is preserved.
  await writeIfMissing(path.join(target, "CLAUDE.md"), TARGET_CLAUDE_MD, { dryRun });
  for (const line of BASIC_GITIGNORE_LINES) await appendGitignoreLine(target, line, { dryRun });

  await copyRecursive(
    path.join(sourceRoot, ".claude.example", "CLAUDE.md"),
    path.join(target, ".claude", "CLAUDE.md"),
    { dryRun }
  );

  await writeClaudeSettings({ sourceRoot, target, attributionConfig, dryRun });
  await appendGitignoreLine(target, ".claude/", { dryRun });

  await writeLocalSettings({ sourceRoot, target, localSettingsEnv, dryRun });

  await ensureRepoPatternGitignore(target, { dryRun });
  await writeJson(repoConfigPath(target), await repoPatternConfig(sourceRoot, profile), { dryRun });
  const lockPath = repoLockPath(target);
  if (isTracked(target, ".repo-pattern/.repo-pattern.lock.json") || isTracked(target, ".repo-pattern.lock.json")) throw new Error("repo-pattern lock is tracked. Untrack it before writing local setup state.");
  await writeJson(lockPath, lockConfig(profile), { dryRun });
  await ensureRepoPatternGitignore(target, { dryRun });

  const mcpResult = await generateMcp({ sourceRoot, target, profile, mcpServers, mcpValues, dryRun });
  const eccStatus = await setupEcc({ sourceRoot, target, dryRun });
  if (applyRules) await applyEccRules({ target, dryRun, ruleMode, rules });
  if (optionalSkills.length > 0) await applyOptionalSkills({ target, skills: optionalSkills, dryRun });

  if (dryRun) {
    console.log("[dry-run] doctor skipped because no files were written.");
  } else {
    await doctorProject(target, { updateLock: true, dryRun });
  }

  const pending = [
    ...(eccStatus === "manual-plugin-install-required" ? ["ECC plugin"] : []),
    ...(mcpResult.missingValues.length > 0 ? ["MCP values"] : [])
  ];
  const pendingText = pending.length ? `${pending.join(", ")} pending` : style("success", "ready");
  const next = dryRun
    ? "review output, then rerun without --dry-run"
    : pending.length
      ? `resolve ${pending.join(" and ")}, then run claude`
      : `cd ${shellQuote(target)} && claude`;
  printSummary("Setup complete", [
    ["Status", dryRun ? `preview only; ${pendingText}` : pendingText],
    ["Target", target],
    ["Profile", profile],
    [dryRun ? "Would write" : "Written", `CLAUDE.md (if missing), .claude/, .mcp.json, .repo-pattern/.repo-pattern.json, .repo-pattern/.repo-pattern.lock.json${optionalSkills.length ? ", optional skill/plugin config" : ""}`],
    ["Doctor", dryRun ? "skipped (dry-run)" : style("success", "passed")],
    ["Next", next]
  ]);
}
