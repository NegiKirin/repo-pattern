import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { backupPaths, copyRecursive, ensureDir, ensureRepoPatternGitignore, exists, readRepoConfig, readRepoLock, removePath, repoConfigPath, repoLockPath, writeJson } from "./fs-utils.mjs";
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

function errorText(error) {
  return [error?.stderr, error?.stdout, error?.message].filter(Boolean).join("\n").trim();
}

export function formatEccCloneError(error) {
  const detail = errorText(error) || "git clone failed";
  return `Could not sync ECC rules from ${ECC_REPO_URL}. GitHub HTTPS access on github.com:443 may be blocked by your proxy, firewall, or VPN. Check with: git ls-remote ${ECC_REPO_URL}\nOriginal error: ${detail}`;
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
  try {
    if (isInteractive()) {
      await withSpinner("Syncing ECC rules", async () => {
        await runGitAsync(["clone", "--depth", "1", "--quiet", ECC_REPO_URL, eccCache], target);
      });
    } else {
      console.log(`Syncing ECC rules from ${ECC_REPO_URL}`);
      runGit(["clone", "--depth", "1", ECC_REPO_URL, eccCache], target);
    }
  } catch (error) {
    throw new Error(formatEccCloneError(error));
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

  const cacheRoot = path.join(target, ".repo-pattern", "cache");
  const eccCache = await ensureEccCache(target, { dryRun });
  await ensureRepoPatternGitignore(target, { dryRun });
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

  if (dryRun) console.log(`[dry-run] rm -rf ${cacheRoot}`);
  else await removePath(cacheRoot);

  const configPath = repoConfigPath(target);
  const repoConfig = await readRepoConfig(target, {});
  repoConfig.ecc = {
    ...(repoConfig.ecc || {}),
    rulesSync: "repo-pattern-auto-cache",
    rulesProfile: ruleMode,
    rulesScope: "project",
    copyRuntimeSurfaces: false
  };
  await ensureRepoPatternGitignore(target, { dryRun });
  await writeJson(configPath, repoConfig, { dryRun });

  const lockPath = repoLockPath(target);
  const lock = await readRepoLock(target, {});
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
    ["Internal dir", ".repo-pattern/cache/ removed"]
  ]);

  return {
    detection,
    selectedRules,
    destRoot,
    rulesSource: ECC_REPO_URL,
    rulesCache: null
  };
}
