import fs from "node:fs/promises";
import path from "node:path";
import { exists, isTracked, readJson, readRepoConfig, readRepoLock } from "./fs-utils.mjs";
import { printBox, style } from "./prompt.mjs";
import { validateProjectGstack } from "./gstack.mjs";
import { expectedOptionalSkillDirs } from "./skills.mjs";

const HARDCODED_PATH_RE = /"\/home\/|"\/Users\/|"[A-Za-z]:\\\\/;
const GENERATED_ATTRIBUTION_HOOK_SOURCE = "generated-attribution-removal";

function hasManagedGeneratedAttributionHook(settings) {
  return Object.values(settings.hooks || {}).flat().some((entry) => entry?._repo_pattern_source === GENERATED_ATTRIBUTION_HOOK_SOURCE);
}

function hasOnlyGeneratedAttributionHooks(settings) {
  return Object.values(settings.hooks || {}).flat().every((entry) => entry?._repo_pattern_source === GENERATED_ATTRIBUTION_HOOK_SOURCE);
}

async function hasOnlyGeneratedAttributionHookFile(target) {
  const hooksDir = path.join(target, ".claude", "hooks");
  if (!exists(hooksDir)) return true;
  try {
    const entries = await fs.readdir(hooksDir, { withFileTypes: true });
    return entries.length === 1 && entries[0].isFile() && entries[0].name === "remove-generated-attribution.mjs";
  } catch {
    return false;
  }
}

async function fileContains(file, regex) {
  if (!exists(file)) return false;
  const text = await fs.readFile(file, "utf8");
  return regex.test(text);
}

async function isOnlyEccRulesDir(target) {
  const rulesDir = path.join(target, ".claude", "rules");
  if (!exists(rulesDir)) return false;
  try {
    const entries = await fs.readdir(rulesDir, { withFileTypes: true });
    return entries.length === 1 && entries[0].name === "ecc" && entries[0].isDirectory();
  } catch {
    return false;
  }
}

function hasNonEmptyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

async function listDirNames(dir) {
  if (!exists(dir)) return [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

export async function auditProject(target) {
  const settings = await readJson(path.join(target, ".claude", "settings.json"), {});
  const repoPattern = await readRepoConfig(target, null);
  const lock = await readRepoLock(target, {});

  const workflow = repoPattern?.workflow;
  const usesGstack = workflow === "gstack" || workflow === "ecc-gstack";
  const gstack = usesGstack ? await validateProjectGstack(target) : null;
  const skillsRoot = path.join(target, ".claude", "skills");
  const actualSkillDirs = await listDirNames(skillsRoot);
  const expectedSkillDirs = [
    ...expectedOptionalSkillDirs(repoPattern?.optionalSkills || []),
    ...(gstack?.wrappers || []).map((wrapper) => path.relative(skillsRoot, path.join(target, wrapper)).split(path.sep)[0]),
    ...(usesGstack ? ["gstack"] : [])
  ].sort();
  const hasOnlyManagedSkills = JSON.stringify(actualSkillDirs) === JSON.stringify([...new Set(expectedSkillDirs)].sort());
  const eccRulesDir = path.join(target, ".claude", "rules", "ecc");
  const hasClaudeEccRulesDir = exists(eccRulesDir);
  const eccRulePackDirs = await listDirNames(eccRulesDir);
  const agentsDir = path.join(target, ".claude", "agents");
  const hasClaudeAgentsDir = exists(agentsDir);
  const agentEntries = await listDirNames(agentsDir);
  const hasMcpJson = exists(path.join(target, ".mcp.json"));
  const hasHardcodedMcpPath = hasMcpJson
    ? await fileContains(path.join(target, ".mcp.json"), HARDCODED_PATH_RE)
    : false;

  const result = {
    target,
    hasClaudeDir: exists(path.join(target, ".claude")),
    hasMcpJson,
    hasHardcodedMcpPath,
    hasSettingsLocalTracked: isTracked(target, ".claude/settings.local.json"),
    hasSettingsHooks: hasNonEmptyObject(settings.hooks),
    hasManagedGeneratedAttributionHook: hasManagedGeneratedAttributionHook(settings),
    hasOnlyGeneratedAttributionHooks: hasOnlyGeneratedAttributionHooks(settings),
    hasClaudeSkillsDir: exists(path.join(target, ".claude", "skills")),
    actualSkillDirs,
    expectedSkillDirs,
    hasOnlyManagedSkills,
    hasClaudeCommandsDir: exists(path.join(target, ".claude", "commands")),
    hasClaudeHooksDir: exists(path.join(target, ".claude", "hooks")),
    hasOnlyGeneratedAttributionHookFile: await hasOnlyGeneratedAttributionHookFile(target),
    hasClaudeScriptsDir: exists(path.join(target, ".claude", "scripts")),
    hasClaudeRulesDir: exists(path.join(target, ".claude", "rules")),
    hasClaudeAgentsDir,
    agentEntries,
    hasManagedEccAgents: lock.ecc?.agentsSyncedBy === "repo-pattern-auto-cache" || (lock.ecc?.appliedAgents || []).length > 0,
    hasOnlyEccRulesDir: await isOnlyEccRulesDir(target),
    hasManagedEccRules: lock.ecc?.rulesSyncedBy === "repo-pattern-auto-cache" || (lock.ecc?.appliedRules || []).length > 0,
    hasClaudeEccRulesDir,
    eccRulePackDirs,
    hasRepoPatternJson: !!repoPattern,
    repoPattern,
    lock,
    gstack
  };

  const allowSourceSkills = repoPattern?.mode === "template";
  const usesEcc = workflow === "ecc-native" || workflow === "ecc-gstack";
  const legacy = (
    (result.hasSettingsHooks && !usesGstack && !result.hasOnlyGeneratedAttributionHooks && !result.hasRepoPatternJson) ||
    (result.hasClaudeSkillsDir && !repoPattern && !allowSourceSkills) ||
    result.hasClaudeCommandsDir ||
    (result.hasClaudeHooksDir && !result.hasOnlyGeneratedAttributionHookFile) ||
    result.hasClaudeScriptsDir ||
    (result.hasClaudeRulesDir && (repoPattern
      ? (result.hasClaudeEccRulesDir && !result.hasManagedEccRules)
      : !result.hasOnlyEccRulesDir))
  );

  const setupComplete = !usesGstack || (
    lock.gstack?.status === "installed" &&
    lock.gstack.installMode === "project-local" &&
    lock.gstack.path === ".claude/skills/gstack" &&
    lock.gstack.statePath === ".repo-pattern/gstack" &&
    gstack.checkoutValid &&
    gstack.stateValid &&
    gstack.wrappersValid &&
    gstack.assetsValid &&
    gstack.sidecarsValid
  );
  if (!result.hasClaudeDir && !result.hasMcpJson && !result.hasRepoPatternJson) {
    result.state = "EMPTY";
  } else if (
    result.hasRepoPatternJson &&
    ["ecc-native", "gstack", "ecc-gstack", "none"].includes(result.repoPattern?.workflow) &&
    setupComplete &&
    !legacy
  ) {
    result.state = {
      "ecc-native": "ECC_NATIVE_MINIMAL",
      gstack: "GSTACK_MINIMAL",
      "ecc-gstack": "ECC_GSTACK_MINIMAL",
      none: "NO_PIPELINE_MINIMAL"
    }[result.repoPattern.workflow];
  } else if (legacy) {
    result.state = "LEGACY_VENDOR";
  } else {
    result.state = "PARTIAL";
  }

  return result;
}

export function printAudit(audit) {
  const warning = style("error", "⚠");
  const rows = [
    `Target  ${audit.target}`,
    `State   ${audit.state}`
  ];
  const needsSetup = audit.state !== "EMPTY";
  const issues = [
    [needsSetup && !audit.hasClaudeDir, ".claude missing"],
    [needsSetup && !audit.hasMcpJson, ".mcp.json missing"],
    [needsSetup && !audit.hasRepoPatternJson, ".repo-pattern/.repo-pattern.json missing"],
    [audit.hasHardcodedMcpPath, "hardcoded machine path in .mcp.json"],
    [audit.hasSettingsLocalTracked, ".claude/settings.local.json tracked"],
    [audit.hasSettingsHooks && audit.repoPattern?.workflow !== "gstack" && audit.repoPattern?.workflow !== "ecc-gstack", ".claude/settings.json hooks not empty"],
    [audit.gstack && !audit.gstack.checkoutValid, "project-local gstack checkout is missing or invalid"],
    [audit.gstack && !audit.gstack.stateValid, "project-local gstack state is missing"],
    [audit.gstack && !audit.gstack.wrappersValid, "project-local gstack wrappers have drifted"],
    [audit.gstack && !audit.gstack.assetsValid, "project-local gstack workflow assets have drifted"],
    [audit.gstack && !audit.gstack.sidecarsValid, "project-local gstack review sidecars have drifted"],
    [audit.lock?.gstack?.status === "failed", "project-local gstack bootstrap failed"],
    [audit.repoPattern?.runtime?.localSkills === true && !audit.hasOnlyManagedSkills, ".claude/skills does not match managed optional skills"],
    [audit.hasClaudeSkillsDir && !audit.hasOnlyManagedSkills, ".claude/skills contains unmanaged entries"],
    [audit.hasClaudeCommandsDir, ".claude/commands present"],
    [audit.hasClaudeHooksDir, ".claude/hooks present"],
    [audit.hasClaudeScriptsDir, ".claude/scripts present"],
    [audit.hasClaudeRulesDir && !audit.hasOnlyEccRulesDir, "non-ECC .claude/rules present"],
    [audit.hasClaudeEccRulesDir && !audit.hasManagedEccRules, ".claude/rules/ecc is not repo-pattern-managed"],
    [audit.hasManagedEccAgents && !audit.hasClaudeAgentsDir, ".claude/agents is missing for repo-pattern-managed ECC agents"],
    [audit.hasClaudeAgentsDir && !audit.hasManagedEccAgents, ".claude/agents is not repo-pattern-managed"]
  ].filter(([bad]) => bad);

  if (issues.length > 0) {
    rows.push("", ...issues.map(([, message]) => `${warning} ${message}`));
  }

  printBox("Audit", rows);
}
