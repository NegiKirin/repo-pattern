import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { backupPaths, copyRecursive, ensureDir, ensureRepoPatternGitignore, exists, readRepoConfig, readRepoLock, removePath, repoConfigPath, repoLockPath, writeJson } from "./fs-utils.mjs";
import { detectProject } from "./project-detect.mjs";
import { selectEccRules, normalizeEccRules, invalidEccRules } from "./ecc-rules.mjs";
import { isInteractive, printSummary, withSpinner } from "./prompt.mjs";

export const ECC_REPO_URL = "https://github.com/affaan-m/ECC.git";
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
const execFileAsync = promisify(execFile);
const SHA256_RE = /^[a-f0-9]{64}$/;
const REVISION_RE = /^[a-f0-9]{40}$/;

function runGit(args, cwd, { quiet = false } = {}) {
  execFileSync("git", args, { cwd, stdio: quiet ? "ignore" : "inherit" });
}

async function runGitAsync(args, cwd) {
  await execFileAsync("git", args, { cwd });
}

function gitOutput(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function hasGitUpstream(cwd) {
  try {
    gitOutput(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd);
    return true;
  } catch {
    return false;
  }
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
  if (exists(path.join(eccCache, "rules")) || exists(path.join(eccCache, "agents"))) {
    if (!dryRun && exists(path.join(eccCache, ".git")) && hasGitUpstream(eccCache)) {
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
      await withSpinner("Syncing ECC rules and agents", async () => {
        await runGitAsync(["clone", "--depth", "1", "--quiet", ECC_REPO_URL, eccCache], target);
      });
    } else {
      console.log(`Syncing ECC rules and agents from ${ECC_REPO_URL}`);
      runGit(["clone", "--depth", "1", ECC_REPO_URL, eccCache], target);
    }
  } catch (error) {
    throw new Error(formatEccCloneError(error));
  }
  return eccCache;
}

function posixRelative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

async function inspectRegularTree(root, { requireNonEmpty = false, label = "ECC agents source" } = {}) {
  let rootStat;
  try {
    rootStat = await fs.lstat(root);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${label} not found: ${root}`);
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`${label} must be a directory: ${root}`);
  const files = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const current = path.join(directory, entry.name);
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`${label} must not contain symlinks: ${posixRelative(root, current)}`);
      if (stat.isDirectory()) await visit(current);
      else if (stat.isFile()) files.push(current);
      else throw new Error(`${label} contains unsupported entry: ${posixRelative(root, current)}`);
    }
  }
  await visit(root);
  if (requireNonEmpty && files.length === 0) throw new Error(`${label} is empty.`);
  return files.sort((left, right) => compareAgentPaths(posixRelative(root, left), posixRelative(root, right)));
}

function compareAgentPaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function sha256(file) {
  const content = await fs.readFile(file);
  return createHash("sha256").update(content).digest("hex");
}

export function validateAgentManifest(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0) return false;
  let previous = null;
  for (const entry of manifest) {
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string" || typeof entry.sha256 !== "string") return false;
    if (!entry.path || entry.path.startsWith("/") || entry.path.includes("\\") || entry.path.split("/").some((part) => !part || part === "." || part === "..") || !SHA256_RE.test(entry.sha256)) return false;
    if (previous !== null && compareAgentPaths(previous, entry.path) >= 0) return false;
    previous = entry.path;
  }
  return true;
}

export async function buildAgentManifest(root) {
  const files = await inspectRegularTree(root, { requireNonEmpty: true });
  return await Promise.all(files.map(async (file) => ({ path: posixRelative(root, file), sha256: await sha256(file) })));
}

export async function verifyAgentInventory(root, manifest) {
  if (!validateAgentManifest(manifest)) return false;
  let actual;
  try {
    actual = await buildAgentManifest(root);
  } catch {
    return false;
  }
  return JSON.stringify(actual) === JSON.stringify(manifest);
}

export function isValidEccAgentProvenance(ecc) {
  return ecc?.agentsSyncedBy === "repo-pattern-auto-cache" &&
    ecc?.agentsSource === ECC_REPO_URL &&
    REVISION_RE.test(ecc?.agentsRevision || "") &&
    validateAgentManifest(ecc?.appliedAgents);
}

export async function validateEccAgentSource(eccCache) {
  const gitDir = path.join(eccCache, ".git");
  if (!exists(gitDir)) throw new Error("ECC cache is not a Git repository.");
  let revision;
  let source;
  try {
    revision = gitOutput(["rev-parse", "--verify", "HEAD^{commit}"], eccCache);
    source = gitOutput(["remote", "get-url", "origin"], eccCache);
  } catch {
    throw new Error("ECC cache must have an origin remote and a HEAD resolved to a commit.");
  }
  if (source !== ECC_REPO_URL) throw new Error(`ECC cache origin must be ${ECC_REPO_URL}.`);
  if (!REVISION_RE.test(revision)) throw new Error("ECC cache HEAD is not a full Git commit revision.");
  const agentsRoot = path.join(eccCache, "agents");
  await inspectRegularTree(agentsRoot, { requireNonEmpty: true });
  return { agentsRoot, revision };
}

function assertEccSourceMatchesHead(eccCache) {
  if (gitOutput(["status", "--porcelain", "--untracked-files=all", "--", "rules", "agents"], eccCache)) {
    throw new Error("ECC cache rules and agents must match Git HEAD.");
  }
}

async function snapshotFile(file) {
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Transaction metadata must be a regular file: ${file}`);
    return { exists: true, content: await fs.readFile(file) };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, content: null };
    throw error;
  }
}

async function restoreFile(file, snapshot) {
  if (snapshot.exists) {
    await ensureDir(path.dirname(file));
    await fs.writeFile(file, snapshot.content);
  } else {
    await fs.rm(file, { force: true });
  }
}

async function validateRuleSource(sourceRulesRoot, selectedRules) {
  const sources = [];
  for (const rule of selectedRules) {
    const source = path.join(sourceRulesRoot, rule);
    let stat;
    try {
      stat = await fs.lstat(source);
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`ECC rule pack not found in cache: ${rule}`);
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`ECC rule pack must be a directory: ${rule}`);
    await inspectRegularTree(source, { label: `ECC rule pack ${rule}` });
    sources.push({ rule, source });
  }
  return sources;
}

async function assertDestinationDirectory(destination, label) {
  try {
    const stat = await fs.lstat(destination);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a directory, not a symlink or file.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function copyAgentTree(source, stage, operations) {
  const sourceFiles = await inspectRegularTree(source, { requireNonEmpty: true });
  for (const file of sourceFiles) {
    const destination = path.join(stage, path.relative(source, file));
    await ensureDir(path.dirname(destination));
    await (operations.copyFile || fs.copyFile)(file, destination);
  }
}

async function syncEccRulesAndAgents({ target, eccCache, selectedRules, repoConfig, lock, claudeMd, nextClaudeMd, dryRun = false, operations = {} }) {
  const claudeDir = path.join(target, ".claude");
  const rulesDir = path.join(claudeDir, "rules");
  const rulesDestination = path.join(rulesDir, "ecc");
  const agentsDestination = path.join(claudeDir, "agents");
  if (dryRun) {
    console.log(`[dry-run] stage and atomically replace ${rulesDestination} and ${agentsDestination} from ${eccCache}`);
    return { manifest: [], revision: "dry-run" };
  }

  const { agentsRoot, revision } = await validateEccAgentSource(eccCache);
  const ruleSources = await validateRuleSource(path.join(eccCache, "rules"), selectedRules);
  assertEccSourceMatchesHead(eccCache);
  try {
    if ((await fs.lstat(claudeDir)).isSymbolicLink()) throw new Error(".claude must not be a symlink.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await ensureDir(claudeDir);
  await ensureDir(rulesDir);
  await assertDestinationDirectory(rulesDestination, ".claude/rules/ecc");
  await assertDestinationDirectory(agentsDestination, ".claude/agents");

  const rulesBackup = path.join(rulesDir, `.ecc-backup-${process.pid}-${Date.now()}`);
  const agentsBackup = path.join(claudeDir, `.agents-backup-${process.pid}-${Date.now()}`);
  const configPath = repoConfigPath(target);
  const lockPath = repoLockPath(target);
  const gitignorePath = path.join(target, ".repo-pattern", ".gitignore");
  const claudeMdPath = path.join(claudeDir, "CLAUDE.md");
  const [configSnapshot, lockSnapshot, gitignoreSnapshot, claudeMdSnapshot] = await Promise.all([
    snapshotFile(configPath),
    snapshotFile(lockPath),
    snapshotFile(gitignorePath),
    snapshotFile(claudeMdPath)
  ]);
  let rulesStage = null;
  let agentsStage = null;
  let movedRules = false;
  let movedAgents = false;
  let promotedRules = false;
  let promotedAgents = false;
  try {
    await ensureRepoPatternGitignore(target, { dryRun });
    rulesStage = await fs.mkdtemp(path.join(rulesDir, ".ecc-stage-"));
    agentsStage = await fs.mkdtemp(path.join(claudeDir, ".agents-stage-"));
    for (const { rule, source } of ruleSources) {
      await (operations.copyRules || copyRecursive)(source, path.join(rulesStage, rule));
    }
    await copyAgentTree(agentsRoot, agentsStage, operations);
    const manifest = await buildAgentManifest(agentsStage);
    await backupPaths(target, [".claude/rules/ecc"], { dryRun });

    if (exists(rulesDestination)) {
      await (operations.rename || fs.rename)(rulesDestination, rulesBackup);
      movedRules = true;
    }
    if (exists(agentsDestination)) {
      await (operations.rename || fs.rename)(agentsDestination, agentsBackup);
      movedAgents = true;
    }
    await (operations.rename || fs.rename)(rulesStage, rulesDestination);
    promotedRules = true;
    await (operations.rename || fs.rename)(agentsStage, agentsDestination);
    promotedAgents = true;

    const nextLock = {
      ...lock,
      ecc: {
        ...(lock.ecc || {}),
        agentsSyncedBy: "repo-pattern-auto-cache",
        agentsSource: ECC_REPO_URL,
        agentsRevision: revision,
        appliedAgents: manifest,
        agentsAppliedAt: new Date().toISOString()
      }
    };
    if (nextClaudeMd !== claudeMd) await (operations.writeClaudeMd || fs.writeFile)(claudeMdPath, nextClaudeMd, "utf8");
    await (operations.writeConfig || writeJson)(configPath, repoConfig, { dryRun });
    await (operations.writeLock || writeJson)(lockPath, nextLock, { dryRun });
    try {
      await Promise.all([
        movedRules ? (operations.removeBackup || fs.rm)(rulesBackup, { recursive: true, force: true }) : undefined,
        movedAgents ? (operations.removeBackup || fs.rm)(agentsBackup, { recursive: true, force: true }) : undefined
      ]);
    } catch (cleanupError) {
      console.warn(`WARN: ECC synchronization backup cleanup failed after commit: ${cleanupError.message}`);
    }
    return { manifest, revision, lock: nextLock };
  } catch (error) {
    try {
      if (promotedAgents) await fs.rm(agentsDestination, { recursive: true, force: true });
      if (promotedRules) await fs.rm(rulesDestination, { recursive: true, force: true });
      if (movedAgents && exists(agentsBackup)) await fs.rename(agentsBackup, agentsDestination);
      if (movedRules && exists(rulesBackup)) await fs.rename(rulesBackup, rulesDestination);
      await Promise.all([
        restoreFile(configPath, configSnapshot),
        restoreFile(lockPath, lockSnapshot),
        restoreFile(gitignorePath, gitignoreSnapshot),
        restoreFile(claudeMdPath, claudeMdSnapshot)
      ]);
    } catch (rollbackError) {
      console.warn(`WARN: ECC synchronization rollback failed: ${rollbackError.message}`);
    }
    throw error;
  } finally {
    await Promise.all([
      rulesStage ? fs.rm(rulesStage, { recursive: true, force: true }) : undefined,
      agentsStage ? fs.rm(agentsStage, { recursive: true, force: true }) : undefined,
      !movedRules ? fs.rm(rulesBackup, { recursive: true, force: true }) : undefined,
      !movedAgents ? fs.rm(agentsBackup, { recursive: true, force: true }) : undefined
    ]);
  }
}

function clearAgentMetadata(ecc) {
  const { agentsSyncedBy, agentsSource, agentsRevision, appliedAgents, agentsAppliedAt, ...rest } = ecc;
  return rest;
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

export async function applyEccRules({ target, dryRun = false, ruleMode = "auto", rules = null, operations = {} }) {
  const detection = await detectProject(target);
  const invalidRules = ruleMode === "manual" ? invalidEccRules(rules) : [];
  if (invalidRules.length > 0) throw new Error(`Unknown ECC rule pack(s): ${invalidRules.join(", ")}`);
  const selectedRules = ruleMode === "manual" ? normalizeEccRules(rules) : selectEccRules(detection);
  printSummary("Detected stack", [["Repo type", detection.repoType], ["Languages", list(detection.languages)], ["Frameworks", list(detection.frameworks)], ["Tools", list(detection.tools)], ["Package manager", detection.packageManager || "unknown"], ["Monorepo", detection.monorepo ? "yes" : "no"]]);
  printSummary("Selected ECC rules", [["Rules", selectedRules.join(", ")]]);

  const cacheRoot = path.join(target, ".repo-pattern", "cache");
  const eccCache = await ensureEccCache(target, { dryRun });
  const destRoot = path.join(target, ".claude", "rules", "ecc");
  const claudeMdPath = path.join(target, ".claude", "CLAUDE.md");
  const claudeMd = exists(claudeMdPath) ? await fs.readFile(claudeMdPath, "utf8") : "";
  const nextClaudeMd = selectedRules.includes("python") && !claudeMd.includes("<!-- USE UV:Start -->")
    ? `${claudeMd}${claudeMd ? (claudeMd.endsWith("\n") ? "\n" : "\n\n") : ""}${USE_UV_RULES}\n`
    : claudeMd;
  if (dryRun && nextClaudeMd !== claudeMd) console.log(`[dry-run] append uv rules to ${claudeMdPath}`);

  const repoConfig = await readRepoConfig(target, {});
  const nextRepoConfig = {
    ...repoConfig,
    ecc: {
      ...(repoConfig.ecc || {}),
      rulesSync: "repo-pattern-auto-cache",
      rulesProfile: ruleMode,
      rulesScope: "project",
      copyRuntimeSurfaces: false
    }
  };
  const lock = await readRepoLock(target, {});
  const nextLock = {
    ...lock,
    ecc: {
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
    }
  };
  const agentResult = await syncEccRulesAndAgents({
    target,
    eccCache,
    selectedRules,
    repoConfig: nextRepoConfig,
    lock: nextLock,
    claudeMd,
    nextClaudeMd,
    dryRun,
    operations
  });
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
