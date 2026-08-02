import fs from "node:fs/promises";
import path from "node:path";
import { backupPaths, copyRecursive, ensureDir, ensureRepoPatternGitignore, exists, repoConfigPath, repoLockPath, writeJson } from "./fs-utils.mjs";
import { buildAgentManifest, inspectRegularTree } from "./ecc-agent-manifest.mjs";
import { ECC_REPO_URL, assertEccSourceMatchesHead, validateEccAgentSource } from "./ecc-source.mjs";

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

async function assertSafeDirectory(directory, label) {
  try {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink.`);
    if (!stat.isDirectory()) throw new Error(`${label} must be a directory.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function assertDestinationDirectory(destination, label) {
  await assertSafeDirectory(destination, label);
}

async function assertSafeTransactionParents(target, claudeDir, rulesDir) {
  await assertSafeDirectory(target, "Target");
  await assertSafeDirectory(claudeDir, ".claude");
  await assertSafeDirectory(rulesDir, ".claude/rules");
  await assertSafeDirectory(path.join(target, ".repo-pattern"), ".repo-pattern");
  await assertSafeDirectory(path.join(target, ".repo-pattern", "backups"), ".repo-pattern/backups");
}

async function copyAgentTree(source, stage, operations, onProgress = null, { requireNonEmpty = false } = {}) {
  const sourceFiles = await inspectRegularTree(source, { requireNonEmpty });
  await ensureDir(stage);
  let completed = 0;
  for (const file of sourceFiles) {
    const destination = path.join(stage, path.relative(source, file));
    await ensureDir(path.dirname(destination));
    await (operations.copyFile || fs.copyFile)(file, destination);
    onProgress?.(++completed, sourceFiles.length);
  }
  return sourceFiles.length;
}

export async function syncEccRulesAndAgents({ target, eccCache, selectedRules, repoConfig, lock, claudeMd, nextClaudeMd, dryRun = false, operations = {}, progress = null, silent = false }) {
  const claudeDir = path.join(target, ".claude");
  const rulesDir = path.join(claudeDir, "rules");
  const rulesDestination = path.join(rulesDir, "ecc");
  const agentsDestination = path.join(claudeDir, "agents");
  if (dryRun) {
    const operation = progress?.beginOperation?.({ id: "ecc-sync", label: "Staging ECC rules and agents", totalUnits: 1, unitLabel: "items", weight: 3 });
    if (!silent) console.log(`[dry-run] stage and atomically replace ${rulesDestination} and ${agentsDestination} from ${eccCache}`);
    operation?.complete({ detail: "preview" });
    await backupPaths(target, [".claude/rules/ecc"], {
      dryRun,
      progress,
      progressId: "ecc-backup",
      progressLabel: "Backing up ECC rules",
      progressWeight: 1,
      silent
    });
    return { manifest: [], revision: "dry-run" };
  }
  const { agentsRoot, revision } = await validateEccAgentSource(eccCache);
  const ruleSources = await validateRuleSource(path.join(eccCache, "rules"), selectedRules);
  const agentFiles = await inspectRegularTree(agentsRoot, { requireNonEmpty: true });
  const ruleFiles = (await Promise.all(ruleSources.map(async ({ source }) => inspectRegularTree(source)))).flat();
  const totalFiles = agentFiles.length + ruleFiles.length;
  const operation = progress?.beginOperation?.({ id: "ecc-sync", label: "Staging ECC rules and agents", totalUnits: totalFiles + 4, unitLabel: "files", weight: 3 });
  let completed = 0;
  assertEccSourceMatchesHead(eccCache);
  await assertSafeTransactionParents(target, claudeDir, rulesDir);
  await ensureDir(claudeDir);
  await ensureDir(rulesDir);
  await assertSafeTransactionParents(target, claudeDir, rulesDir);
  await assertDestinationDirectory(rulesDestination, ".claude/rules/ecc");
  await assertDestinationDirectory(agentsDestination, ".claude/agents");
  const rulesBackup = path.join(rulesDir, `.ecc-backup-${process.pid}-${Date.now()}`);
  const agentsBackup = path.join(claudeDir, `.agents-backup-${process.pid}-${Date.now()}`);
  const configPath = repoConfigPath(target);
  const lockPath = repoLockPath(target);
  const gitignorePath = path.join(target, ".repo-pattern", ".gitignore");
  const claudeMdPath = path.join(claudeDir, "CLAUDE.md");
  const snapshots = await Promise.all([snapshotFile(configPath), snapshotFile(lockPath), snapshotFile(gitignorePath), snapshotFile(claudeMdPath)]);
  let rulesStage = null;
  let agentsStage = null;
  let movedRules = false;
  let movedAgents = false;
  let promotedRules = false;
  let promotedAgents = false;
  try {
    await ensureRepoPatternGitignore(target, { dryRun, silent });
    rulesStage = await fs.mkdtemp(path.join(rulesDir, ".ecc-stage-"));
    agentsStage = await fs.mkdtemp(path.join(claudeDir, ".agents-stage-"));
    for (const { rule, source } of ruleSources) {
      if (operations.copyRules) {
        await operations.copyRules(source, path.join(rulesStage, rule));
        const files = await inspectRegularTree(source);
        completed += files.length;
        operation?.update({ completedUnits: completed, totalUnits: totalFiles + 4, detail: `${completed}/${totalFiles} files` });
      } else {
        await copyAgentTree(source, path.join(rulesStage, rule), operations, (count, total) => {
          operation?.update({ completedUnits: completed + count, totalUnits: totalFiles + 4, detail: `${completed + count}/${totalFiles} files` });
          if (count === total) completed += total;
        });
      }
    }
    await copyAgentTree(agentsRoot, agentsStage, operations, (count, total) => {
      operation?.update({ completedUnits: completed + count, totalUnits: totalFiles + 4, detail: `${completed + count}/${totalFiles} files` });
      if (count === total) completed += total;
    }, { requireNonEmpty: true });
    const manifest = await buildAgentManifest(agentsStage);
    await backupPaths(target, [".claude/rules/ecc"], {
      dryRun,
      progress,
      progressId: "ecc-backup",
      progressLabel: "Backing up ECC rules",
      progressWeight: 1,
      silent
    });
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
    operation?.update({ completedUnits: ++completed, totalUnits: totalFiles + 4, detail: "Promoting ECC rules" });
    await (operations.rename || fs.rename)(agentsStage, agentsDestination);
    promotedAgents = true;
    operation?.update({ completedUnits: ++completed, totalUnits: totalFiles + 4, detail: "Promoting ECC agents" });
    const nextLock = {
      ...lock,
      ecc: { ...(lock.ecc || {}), agentsSyncedBy: "repo-pattern-auto-cache", agentsSource: ECC_REPO_URL, agentsRevision: revision, appliedAgents: manifest, agentsAppliedAt: new Date().toISOString() }
    };
    if (nextClaudeMd !== claudeMd) await (operations.writeClaudeMd || fs.writeFile)(claudeMdPath, nextClaudeMd, "utf8");
    await (operations.writeConfig || writeJson)(configPath, repoConfig, { dryRun, silent });
    await (operations.writeLock || writeJson)(lockPath, nextLock, { dryRun, silent });
    operation?.update({ completedUnits: ++completed, totalUnits: totalFiles + 4, detail: "Writing ECC metadata" });
    operation?.complete({ detail: "completed" });
    try {
      await Promise.all([movedRules ? (operations.removeBackup || fs.rm)(rulesBackup, { recursive: true, force: true }) : undefined, movedAgents ? (operations.removeBackup || fs.rm)(agentsBackup, { recursive: true, force: true }) : undefined]);
    } catch (cleanupError) {
      if (!silent) console.warn(`WARN: ECC synchronization backup cleanup failed after commit: ${cleanupError.message}`);
    }
    return { manifest, revision, lock: nextLock };
  } catch (error) {
    operation?.fail({ detail: "failed" });
    try {
      if (promotedAgents) await fs.rm(agentsDestination, { recursive: true, force: true });
      if (promotedRules) await fs.rm(rulesDestination, { recursive: true, force: true });
      if (movedAgents && exists(agentsBackup)) await fs.rename(agentsBackup, agentsDestination);
      if (movedRules && exists(rulesBackup)) await fs.rename(rulesBackup, rulesDestination);
      await Promise.all([restoreFile(configPath, snapshots[0]), restoreFile(lockPath, snapshots[1]), restoreFile(gitignorePath, snapshots[2]), restoreFile(claudeMdPath, snapshots[3])]);
    } catch (rollbackError) {
      if (!silent) console.warn(`WARN: ECC synchronization rollback failed: ${rollbackError.message}`);
    }
    throw error;
  } finally {
    await Promise.all([rulesStage ? fs.rm(rulesStage, { recursive: true, force: true }) : undefined, agentsStage ? fs.rm(agentsStage, { recursive: true, force: true }) : undefined, !movedRules ? fs.rm(rulesBackup, { recursive: true, force: true }) : undefined, !movedAgents ? fs.rm(agentsBackup, { recursive: true, force: true }) : undefined]);
  }
}
