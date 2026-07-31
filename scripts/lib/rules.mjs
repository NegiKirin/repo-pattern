import fs from "node:fs/promises";
import path from "node:path";
import { backupPaths, exists, readRepoConfig, readRepoLock, removePath, repoConfigPath, repoLockPath, writeJson } from "./fs-utils.mjs";
import { detectProject } from "./project-detect.mjs";
import { invalidEccRules, normalizeEccRules, selectEccRules } from "./ecc-rules.mjs";
import { printSummary } from "./prompt.mjs";
import { buildAgentManifest, isValidEccAgentProvenance as validAgentProvenance, validateAgentManifest, verifyAgentInventory } from "./ecc-agent-manifest.mjs";
import { ECC_REPO_URL, ensureEccCache, formatEccCloneError, hasGitUpstream, validateEccAgentSource } from "./ecc-source.mjs";
import { syncEccRulesAndAgents } from "./ecc-sync-transaction.mjs";

const USE_UV_RULES = `<!-- USE UV:Start -->
Python project uses \`uv\`. Do not run \`python\`, \`python3\`, \`pip\`, \`pytest\`, or manually activate \`.venv\` unless explicitly required. Use \`uv run\` so commands execute inside the project environment.

Command replacements:
- \`python script.py\` → \`uv run python script.py\`
- \`python3 script.py\` → \`uv run python script.py\`
- \`python -m module\` → \`uv run python -m module\`
- \`python3 -m module\` → \`uv run python -m module\`
- \`python - <<'PY' ... PY\` → \`uv run python - <<'PY' ... PY\`
- \`python3 - <<'PY' ... PY\` → \`uv run python - <<'PY' ... PY\`
- \`pytest\` → \`uv run pytest\`
- \`pytest tests/...\` → \`uv run pytest tests/...\`
- \`pip install <pkg>\` → \`uv add <pkg>\`
- \`pip install -e .\` → \`uv sync\`
- \`pip install -r requirements.txt\` → \`uv pip install -r requirements.txt\` only for legacy projects without \`pyproject.toml\`
- \`python -m pip ...\` → prefer \`uv add\` / \`uv remove\`; use \`uv pip ...\` only as escape hatch
- \`source .venv/bin/activate && <cmd>\` → \`uv run <cmd>\`

Dependency commands:
- Install/sync deps: \`uv sync\`
- Reproducible install: \`uv sync --locked\`
- Add runtime dep: \`uv add <package>\`
- Add dev dep: \`uv add --dev\`
- Remove dep: \`uv remove\`
- Update lockfile: \`uv lock\`
- Check lockfile: \`uv lock --check\`
- Inspect deps: \`uv tree\`
- Temporary tool: \`uvx <tool>\` or \`uv tool run <tool>\`

Rule: \`uv run\` owns \`.venv\`. Put uv options before the child command: \`uv run --python -- pytest -q\`.
<!-- USE UV:End -->`;

function list(values, fallback = "none detected") {
  return values.length ? values.join(", ") : fallback;
}

function clearAgentMetadata(ecc) {
  const { agentsSyncedBy, agentsSource, agentsRevision, appliedAgents, agentsAppliedAt, ...rest } = ecc;
  return rest;
}

export { ECC_REPO_URL, hasGitUpstream, formatEccCloneError, validateAgentManifest, buildAgentManifest, verifyAgentInventory, validateEccAgentSource };

export function isValidEccAgentProvenance(ecc) {
  return validAgentProvenance(ecc, ECC_REPO_URL);
}

export async function clearEccRules({ target, dryRun = false }) {
  const destRoot = path.join(target, ".claude", "rules", "ecc");
  await backupPaths(target, [".claude/rules/ecc"], { dryRun });
  await removePath(destRoot, { dryRun });
  if (!dryRun) {
    try {
      await fs.rmdir(path.join(target, ".claude", "rules"));
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
    }
  }
  const repoConfig = await readRepoConfig(target, {});
  if (repoConfig.ecc) {
    const { rulesSync, rulesProfile, rulesScope, copyRuntimeSurfaces, ...ecc } = repoConfig.ecc;
    repoConfig.ecc = ecc;
    await writeJson(repoConfigPath(target), repoConfig, { dryRun });
  }
  const lock = await readRepoLock(target, {});
  if (lock.ecc) {
    const { rulesSyncedBy, rulesProfile, rulesScope, recommendedRules, appliedRules, detectedStack, rulesSource, rulesCache, rulesAppliedAt, ...ecc } = clearAgentMetadata(lock.ecc);
    lock.ecc = { ...ecc, rulesSyncedBy: null, rulesScope: "project", recommendedRules: [], appliedRules: [] };
    await writeJson(repoLockPath(target), lock, { dryRun });
  }
}

export async function applyEccRules({ target, dryRun = false, ruleMode = "auto", rules = null, operations = {}, progress = null }) {
  const detection = await detectProject(target);
  const invalidRules = ruleMode === "manual" ? invalidEccRules(rules) : [];
  if (invalidRules.length > 0) throw new Error(`Unknown ECC rule pack(s): ${invalidRules.join(", ")}`);
  const selectedRules = ruleMode === "manual" ? normalizeEccRules(rules) : selectEccRules(detection);
  printSummary("Detected stack", [["Repo type", detection.repoType], ["Languages", list(detection.languages)], ["Frameworks", list(detection.frameworks)], ["Tools", list(detection.tools)], ["Package manager", detection.packageManager || "unknown"], ["Monorepo", detection.monorepo ? "yes" : "no"]]);
  printSummary("Selected ECC rules", [["Rules", selectedRules.join(", ")]]);
  const cacheRoot = path.join(target, ".repo-pattern", "cache");
  const eccCache = await ensureEccCache(target, { dryRun, progress });
  const destRoot = path.join(target, ".claude", "rules", "ecc");
  const claudeMdPath = path.join(target, ".claude", "CLAUDE.md");
  const claudeMd = exists(claudeMdPath) ? await fs.readFile(claudeMdPath, "utf8") : "";
  const nextClaudeMd = selectedRules.includes("python") && !claudeMd.includes("<!-- USE UV:Start -->")
    ? `${claudeMd}${claudeMd ? (claudeMd.endsWith("\n") ? "\n" : "\n\n") : ""}${USE_UV_RULES}\n`
    : claudeMd;
  if (dryRun && nextClaudeMd !== claudeMd) console.log(`[dry-run] append uv rules to ${claudeMdPath}`);
  const repoConfig = await readRepoConfig(target, {});
  const nextRepoConfig = { ...repoConfig, ecc: { ...(repoConfig.ecc || {}), rulesSync: "repo-pattern-auto-cache", rulesProfile: ruleMode, rulesScope: "project", copyRuntimeSurfaces: false } };
  const lock = await readRepoLock(target, {});
  const nextLock = {
    ...lock,
    ecc: { ...(lock.ecc || {}), rulesSyncedBy: "repo-pattern-auto-cache", rulesProfile: ruleMode, rulesScope: "project", recommendedRules: selectedRules, appliedRules: selectedRules, detectedStack: detection, rulesSource: ECC_REPO_URL, rulesCache: null, rulesAppliedAt: new Date().toISOString() }
  };
  const agentResult = await syncEccRulesAndAgents({ target, eccCache, selectedRules, repoConfig: nextRepoConfig, lock: nextLock, claudeMd, nextClaudeMd, dryRun, operations, progress });
  if (!dryRun) {
    try {
      await removePath(cacheRoot);
    } catch (error) {
      console.warn(`WARN: ECC cache cleanup failed after commit: ${error.message}`);
    }
  } else console.log(`[dry-run] rm -rf ${cacheRoot}`);
  printSummary("Applied ECC rules and agents", [["Rules", selectedRules.join(", ")], ["Agents", dryRun ? "staged preview" : `${agentResult.manifest.length} files`], ["Internal dir", ".repo-pattern/cache/ removed after commit"]]);
  return { detection, selectedRules, destRoot, rulesSource: ECC_REPO_URL, rulesCache: null, agentsRevision: agentResult.revision, appliedAgents: agentResult.manifest };
}
