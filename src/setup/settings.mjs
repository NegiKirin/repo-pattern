import fs from "node:fs/promises";
import path from "node:path";
import { withoutPersistedMcpValues } from "../mcp.mjs";
import { ECC_PLUGIN, applyEccPluginSettings } from "../ecc/ecc.mjs";
import { appendGitignoreLine, copyRecursive, isTracked, readJson, readPrivateJson, writePrivateJson } from "../shared/fs-utils.mjs";
import { reconcilePluginSkillSettings } from "../skills.mjs";

const GENERATED_ATTRIBUTION_HOOK_SOURCE = "generated-attribution-removal";

function generatedAttributionHook(attributionConfig = { mode: "off" }) {
  return {
    _repo_pattern_source: GENERATED_ATTRIBUTION_HOOK_SOURCE,
    _repo_pattern_attribution_mode: attributionConfig.mode,
    matcher: "^Bash$",
    hooks: [{ type: "command", command: "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/remove-generated-attribution.mjs\"", timeout: 5 }]
  };
}

export function applyGeneratedAttributionHook(settings = {}, attributionConfig = { mode: "off" }) {
  const hooks = Object.fromEntries(Object.entries(settings.hooks || {}).map(([event, entries]) => [
    event,
    (entries || []).filter((entry) => entry?._repo_pattern_source !== GENERATED_ATTRIBUTION_HOOK_SOURCE)
  ]).filter(([, entries]) => entries.length > 0));
  hooks.PreToolUse = [...(hooks.PreToolUse || []), generatedAttributionHook(attributionConfig)];
  return { ...settings, hooks };
}

export async function copyGeneratedAttributionHook(sourceRoot, target, { dryRun, silent = false }) {
  await copyRecursive(
    path.join(sourceRoot, ".claude.example", "hooks", "remove-generated-attribution.mjs"),
    path.join(target, ".claude", "hooks", "remove-generated-attribution.mjs"),
    { dryRun, silent }
  );
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
  if (permissionConfig.bypass === "preserve") return { ...settings, permissions };
  if (permissionConfig.bypass === "user") {
    delete permissions.defaultMode;
    delete permissions.disableBypassPermissionsMode;
    return { ...settings, permissions };
  }
  if (permissionConfig.bypass === "allow") {
    permissions.defaultMode = "bypassPermissions";
    delete permissions.disableBypassPermissionsMode;
  } else {
    permissions.defaultMode = "default";
    permissions.disableBypassPermissionsMode = "disable";
  }
  return { ...settings, permissions };
}

export async function writeClaudeSettings({ sourceRoot, target, attributionConfig, permissionConfig, dryRun, silent = false }) {
  const template = await readJson(path.join(sourceRoot, ".claude.example", "settings.example.json"), {});
  let current;
  try {
    current = await readPrivateJson(path.join(target, ".claude", "settings.json"), {}, { label: ".claude/settings.json", parentLabel: ".claude" });
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(".claude/settings.json is malformed. Fix it before running setup.");
  }
  const settings = applyGeneratedAttributionHook(applyPermissionSettings(applyAttributionSetting({ ...template, ...current, hooks: current.hooks || template.hooks }, attributionConfig), permissionConfig), attributionConfig);
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
  await writePrivateJson(file, applyGeneratedAttributionHook(applyAttributionSetting(current || template, attributionConfig), attributionConfig), {
    dryRun,
    label: ".claude/settings.json",
    parentLabel: ".claude"
  });
  await copyGeneratedAttributionHook(sourceRoot, target, { dryRun });
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

export async function rejectClaudeSymlink(target, { dryRun = false } = {}) {
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
      if ((await fs.lstat(path.join(target, relativePath))).isSymbolicLink()) throw new Error(`${label} must not be a symlink.`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export async function writeLocalSettings({ sourceRoot, target, localSettingsEnv = {}, effortLevel = "medium", setupPipeline, optionalSkills, dryRun, silent = false }) {
  if (isTracked(target, ".claude/settings.local.json")) throw new Error(".claude/settings.local.json is tracked. Untrack it before writing local provider settings.");
  const claudeDir = path.join(target, ".claude");
  await rejectClaudeSymlink(target, { dryRun });
  const template = await readJson(path.join(sourceRoot, ".claude.example", "settings.local.example.json"), {});
  const file = path.join(claudeDir, "settings.local.json");
  await writePrivateJson(file, (current) => ({
    ...reconcileLocalPluginSettings(applyLocalSettings({
      ...template,
      ...current,
      env: { ...(template.env || {}), ...(current.env || {}) }
    }, localSettingsEnv), { setupPipeline, optionalSkills }),
    effortLevel
  }), {
    dryRun,
    label: ".claude/settings.local.json",
    silent
  });
  await appendGitignoreLine(target, ".claude/", { dryRun, silent });
}
