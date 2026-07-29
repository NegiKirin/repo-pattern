import fs from "node:fs/promises";
import path from "node:path";
import { exists, isTracked, readJson, readRepoConfig, readRepoLock } from "./fs-utils.mjs";
import { printBox, style } from "./prompt.mjs";
import { expectedOptionalSkillDirs } from "./skills.mjs";

const HARDCODED_PATH_RE = /"\/home\/|"\/Users\/|"[A-Za-z]:\\\\/;

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

  const actualSkillDirs = await listDirNames(path.join(target, ".claude", "skills"));
  const expectedSkillDirs = expectedOptionalSkillDirs(repoPattern?.optionalSkills || []);
  const hasOnlyManagedSkills = JSON.stringify(actualSkillDirs) === JSON.stringify(expectedSkillDirs);
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
    hasClaudeSkillsDir: exists(path.join(target, ".claude", "skills")),
    actualSkillDirs,
    expectedSkillDirs,
    hasOnlyManagedSkills,
    hasClaudeCommandsDir: exists(path.join(target, ".claude", "commands")),
    hasClaudeHooksDir: exists(path.join(target, ".claude", "hooks")),
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
    repoPattern
  };

  const allowSourceSkills = repoPattern?.mode === "template";
  const workflow = repoPattern?.workflow;
  const usesEcc = workflow === "ecc-native" || workflow === "ecc-gstack";
  const usesGstack = workflow === "gstack" || workflow === "ecc-gstack";
  const legacy = (
    result.hasSettingsHooks ||
    (result.hasClaudeSkillsDir && !repoPattern && !allowSourceSkills) ||
    result.hasClaudeCommandsDir ||
    result.hasClaudeHooksDir ||
    result.hasClaudeScriptsDir ||
    (result.hasClaudeRulesDir && (repoPattern
      ? (result.hasClaudeEccRulesDir && !result.hasManagedEccRules)
      : !result.hasOnlyEccRulesDir))
  );

  const setupComplete = !usesGstack || lock.gstack?.status === "installed";
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
    [audit.hasSettingsHooks, ".claude/settings.json hooks not empty"],
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
