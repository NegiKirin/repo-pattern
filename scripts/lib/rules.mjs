import path from "node:path";
import { execFileSync } from "node:child_process";
import { appendGitignoreLine, backupPaths, copyRecursive, ensureDir, exists, readJson, removePath, writeJson } from "./fs-utils.mjs";
import { detectProject } from "./project-detect.mjs";
import { selectEccRules, explainRules, normalizeEccRules, invalidEccRules } from "./ecc-rules.mjs";

const ECC_REPO_URL = "https://github.com/affaan-m/ECC.git";

function runGit(args, cwd) {
  execFileSync("git", args, {
    cwd,
    stdio: "inherit"
  });
}

async function ensureEccCache(target, { dryRun = false } = {}) {
  const cacheRoot = path.join(target, ".repo-pattern", "cache");
  const eccCache = path.join(cacheRoot, "ECC");
  const rulesDir = path.join(eccCache, "rules");

  if (exists(rulesDir)) {
    if (!dryRun && exists(path.join(eccCache, ".git"))) {
      try {
        runGit(["pull", "--ff-only", "--quiet"], eccCache);
      } catch {
        console.warn("WARN: ECC cache exists but git pull failed. Using existing cache.");
      }
    }
    return eccCache;
  }

  if (dryRun) {
    console.log(`[dry-run] git clone --depth 1 ${ECC_REPO_URL} ${eccCache}`);
    return eccCache;
  }

  await ensureDir(cacheRoot);
  console.log(`Cloning ECC rules cache: ${ECC_REPO_URL}`);
  runGit(["clone", "--depth", "1", ECC_REPO_URL, eccCache], target);
  return eccCache;
}

export async function applyEccRules({ target, dryRun = false, ruleMode = "auto", rules = null }) {
  const detection = await detectProject(target);
  const invalidRules = ruleMode === "manual" ? invalidEccRules(rules) : [];
  if (invalidRules.length > 0) throw new Error(`Unknown ECC rule pack(s): ${invalidRules.join(", ")}`);

  const selectedRules = ruleMode === "manual" ? normalizeEccRules(rules) : selectEccRules(detection);

  console.log(explainRules(detection, selectedRules));
  console.log("");

  const eccCache = await ensureEccCache(target, { dryRun });
  await appendGitignoreLine(target, ".repo-pattern/cache/", { dryRun });
  const sourceRulesRoot = path.join(eccCache, "rules");
  const destRoot = path.join(target, ".claude", "rules", "ecc");

  await backupPaths(target, [".claude/rules/ecc"], { dryRun });
  await removePath(destRoot, { dryRun });
  await ensureDir(destRoot, { dryRun });

  for (const rule of selectedRules) {
    const src = path.join(sourceRulesRoot, rule);
    const dest = path.join(destRoot, rule);

    if (!dryRun && !exists(src)) {
      throw new Error(`ECC rule pack not found in cache: ${rule}`);
    }

    await copyRecursive(src, dest, { dryRun });
  }

  const repoConfigPath = path.join(target, ".repo-pattern.json");
  const repoConfig = await readJson(repoConfigPath, {});
  repoConfig.ecc = {
    ...(repoConfig.ecc || {}),
    rulesSync: "repo-pattern-auto-cache",
    rulesProfile: ruleMode,
    rulesScope: "project",
    copyRuntimeSurfaces: false
  };
  await writeJson(repoConfigPath, repoConfig, { dryRun });

  const lockPath = path.join(target, ".repo-pattern.lock.json");
  const lock = await readJson(lockPath, {});
  lock.ecc = {
    ...(lock.ecc || {}),
    rulesSyncedBy: "repo-pattern-auto-cache",
    rulesProfile: ruleMode,
    rulesScope: "project",
    recommendedRules: selectedRules,
    appliedRules: selectedRules,
    detectedStack: detection,
    rulesCache: path.relative(target, eccCache),
    rulesAppliedAt: new Date().toISOString()
  };
  await writeJson(lockPath, lock, { dryRun });

  console.log(`Applied ECC rules to: ${path.relative(target, destRoot)}`);
  console.log(`Rules: ${selectedRules.join(", ")}`);

  return {
    detection,
    selectedRules,
    destRoot,
    eccCache
  };
}
