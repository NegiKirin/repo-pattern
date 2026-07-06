import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { appendGitignoreLine, backupPaths, copyRecursive, ensureDir, exists, readJson, removePath, writeJson } from "./fs-utils.mjs";
import { detectProject } from "./project-detect.mjs";
import { selectEccRules, normalizeEccRules, invalidEccRules } from "./ecc-rules.mjs";
import { isInteractive, printSummary, withSpinner } from "./prompt.mjs";

const ECC_REPO_URL = "https://github.com/affaan-m/ECC.git";
const execFileAsync = promisify(execFile);

function runGit(args, cwd, { quiet = false } = {}) {
  execFileSync("git", args, {
    cwd,
    stdio: quiet ? "ignore" : "inherit"
  });
}

async function runGitAsync(args, cwd) {
  await execFileAsync("git", args, { cwd });
}

function list(values, fallback = "none detected") {
  return values.length ? values.join(", ") : fallback;
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
  if (isInteractive()) {
    await withSpinner("Syncing ECC rules", async () => {
      await runGitAsync(["clone", "--depth", "1", "--quiet", ECC_REPO_URL, eccCache], target);
    });
  } else {
    console.log(`Syncing ECC rules from ${ECC_REPO_URL}`);
    runGit(["clone", "--depth", "1", ECC_REPO_URL, eccCache], target);
  }
  return eccCache;
}

export async function applyEccRules({ target, dryRun = false, ruleMode = "auto", rules = null }) {
  const detection = await detectProject(target);
  const invalidRules = ruleMode === "manual" ? invalidEccRules(rules) : [];
  if (invalidRules.length > 0) throw new Error(`Unknown ECC rule pack(s): ${invalidRules.join(", ")}`);

  const selectedRules = ruleMode === "manual" ? normalizeEccRules(rules) : selectEccRules(detection);

  printSummary("Detected stack", [
    ["Repo type", detection.repoType],
    ["Languages", list(detection.languages)],
    ["Frameworks", list(detection.frameworks)],
    ["Tools", list(detection.tools)],
    ["Package manager", detection.packageManager || "unknown"],
    ["Monorepo", detection.monorepo ? "yes" : "no"]
  ]);
  printSummary("Selected ECC rules", [["Rules", selectedRules.join(", ")]]);

  const internalRoot = path.join(target, ".repo-pattern");
  const cacheRoot = path.join(internalRoot, "cache");
  const eccCache = await ensureEccCache(target, { dryRun });
  await appendGitignoreLine(target, ".repo-pattern/", { dryRun });
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

  if (dryRun) console.log(`[dry-run] rm -rf ${internalRoot}`);
  else await removePath(internalRoot);

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
    rulesSource: ECC_REPO_URL,
    rulesCache: null,
    rulesAppliedAt: new Date().toISOString()
  };
  await writeJson(lockPath, lock, { dryRun });

  printSummary("Applied ECC rules", [
    ["Path", path.relative(target, destRoot)],
    ["Rules", selectedRules.join(", ")],
    ["Internal dir", ".repo-pattern/ removed"]
  ]);

  return {
    detection,
    selectedRules,
    destRoot,
    rulesSource: ECC_REPO_URL,
    rulesCache: null
  };
}
