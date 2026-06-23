import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { exists, readJson } from "./fs-utils.mjs";

const SPEC_RE = /Spec Kit|speckit/i;
const HARDCODED_PATH_RE = /"\/home\/|"\/Users\/|"[A-Za-z]:\\\\/;

async function fileContains(file, regex) {
  if (!exists(file)) return false;
  const text = await fs.readFile(file, "utf8");
  return regex.test(text);
}

async function scanForSpecRefs(root) {
  const candidates = [
    "README.md",
    "CLAUDE.md",
    ".claude/CLAUDE.md",
    "docs"
  ];

  async function scan(p) {
    if (!exists(p)) return false;
    const stat = await fs.stat(p);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(p);
      for (const entry of entries) {
        if (entry === ".git" || entry === ".repo-pattern" || entry === "node_modules") continue;
        if (await scan(path.join(p, entry))) return true;
      }
      return false;
    }

    if (!/\.(md|txt|json|yml|yaml)$/i.test(p)) return false;
    return fileContains(p, SPEC_RE);
  }

  for (const rel of candidates) {
    if (await scan(path.join(root, rel))) return true;
  }
  return false;
}

function isTracked(root, relPath) {
  try {
    const output = execFileSync("git", ["ls-files", relPath], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}


async function isOnlyEccRulesDir(target) {
  const rulesDir = path.join(target, ".claude", "rules");
  if (!exists(rulesDir)) return false;
  try {
    const entries = await fs.readdir(rulesDir);
    return entries.length === 1 && entries[0] === "ecc";
  } catch {
    return false;
  }
}

function hasNonEmptyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

export async function auditProject(target) {
  const settings = await readJson(path.join(target, ".claude", "settings.json"), {});
  const repoPattern = await readJson(path.join(target, ".repo-pattern.json"), null);

  const hasMcpJson = exists(path.join(target, ".mcp.json"));
  const hasHardcodedMcpPath = hasMcpJson
    ? await fileContains(path.join(target, ".mcp.json"), HARDCODED_PATH_RE)
    : false;

  const result = {
    target,
    hasClaudeDir: exists(path.join(target, ".claude")),
    hasMcpJson,
    hasHardcodedMcpPath,
    hasSpecify: exists(path.join(target, ".specify")),
    hasSpecKitReferences: await scanForSpecRefs(target),
    hasSettingsLocalTracked: isTracked(target, ".claude/settings.local.json"),
    hasSettingsHooks: hasNonEmptyObject(settings.hooks),
    hasClaudeSkillsDir: exists(path.join(target, ".claude", "skills")),
    hasClaudeCommandsDir: exists(path.join(target, ".claude", "commands")),
    hasClaudeHooksDir: exists(path.join(target, ".claude", "hooks")),
    hasClaudeScriptsDir: exists(path.join(target, ".claude", "scripts")),
    hasClaudeRulesDir: exists(path.join(target, ".claude", "rules")),
    hasOnlyEccRulesDir: await isOnlyEccRulesDir(target),
    hasRepoPatternJson: !!repoPattern,
    repoPattern
  };

  const legacy = (
    result.hasSpecify ||
    result.hasSpecKitReferences ||
    result.hasSettingsHooks ||
    result.hasClaudeSkillsDir ||
    result.hasClaudeCommandsDir ||
    result.hasClaudeHooksDir ||
    result.hasClaudeScriptsDir ||
    result.hasClaudeRulesDir
  );

  if (!result.hasClaudeDir && !result.hasMcpJson && !result.hasRepoPatternJson) {
    result.state = "EMPTY";
  } else if (
    result.hasRepoPatternJson &&
    result.repoPattern?.workflow === "ecc-native" &&
    !legacy
  ) {
    result.state = "ECC_NATIVE_MINIMAL";
  } else if (legacy) {
    result.state = "LEGACY_VENDOR";
  } else {
    result.state = "PARTIAL";
  }

  return result;
}

export function printAudit(audit) {
  const present = (ok) => ok ? "✓" : "·";
  const clean = (bad) => bad ? "⚠" : "✓";

  console.log(`Repo Pattern Audit`);
  console.log(`Target: ${audit.target}`);
  console.log(`State: ${audit.state}\n`);

  console.log(`${present(audit.hasClaudeDir)} .claude present`);
  console.log(`${present(audit.hasMcpJson)} .mcp.json present`);
  console.log(`${clean(audit.hasHardcodedMcpPath)} no hardcoded machine path in .mcp.json`);
  console.log(`${clean(audit.hasSpecify)} .specify absent`);
  console.log(`${clean(audit.hasSpecKitReferences)} Spec Kit references absent`);
  console.log(`${clean(audit.hasSettingsLocalTracked)} .claude/settings.local.json not tracked`);
  console.log(`${clean(audit.hasSettingsHooks)} .claude/settings.json hooks empty`);
  console.log(`${clean(audit.hasClaudeSkillsDir)} .claude/skills absent`);
  console.log(`${clean(audit.hasClaudeCommandsDir)} .claude/commands absent`);
  console.log(`${clean(audit.hasClaudeHooksDir)} .claude/hooks absent`);
  console.log(`${clean(audit.hasClaudeScriptsDir)} .claude/scripts absent`);
  console.log(`${clean(audit.hasClaudeRulesDir && !audit.hasOnlyEccRulesDir)} no non-ECC .claude/rules`);
  console.log(`${present(audit.hasRepoPatternJson)} .repo-pattern.json present`);
}
