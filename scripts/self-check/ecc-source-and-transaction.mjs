import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject, printAudit } from "../lib/audit.mjs";
import { cleanupProject } from "../lib/cleanup.mjs";
import { doctorProject } from "../lib/doctor.mjs";
import { ECC_PLUGIN, applyEccPluginSettings, setupEcc } from "../lib/ecc.mjs";
import { applyMcpValues, generateMcp, mcpSecretPrompt, persistedMcpValues, readGeneratedMcpValues, validateRelativeMcpPath } from "../lib/mcp.mjs";
import { applyAttributionSetting, applyLocalSettings, applyPermissionSettings, provisionProject, reconcileLocalPluginSettings, setupPipelineScope, updateClaudePermissions } from "../lib/provision.mjs";
import { writePrivateJson } from "../lib/fs-utils.mjs";
import { printSummary, renderLogo, style } from "../lib/prompt.mjs";
import { needsLocalSettingsPrompt, setupProject, setupRetryOptions } from "../lib/setup.mjs";
import { ensureEccCache } from "../lib/ecc-source.mjs";
import { applyEccRules, buildAgentManifest, clearEccRules, formatEccCloneError, hasGitUpstream, validateAgentManifest } from "../lib/rules.mjs";
import { applyOptionalSkills, applyPluginSkillSettings, expectedOptionalSkillDirs, invalidOptionalSkills, normalizeOptionalSkills, OPTIONAL_SKILLS } from "../lib/skills.mjs";
const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const cliPath = path.join(cliDir, "..", "repo-pattern.mjs");
const secretSentinel = "do-not-persist-anthropic-token";

import { writeEccGitFixture } from "./fixtures.mjs";
const originalDoctorLog = console.log;

export async function runEccSourceAndTransactionChecks() {
const existingCacheTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-existing-ecc-cache-"));
try {
  const cache = path.join(existingCacheTarget, ".repo-pattern", "cache", "ECC");
  await fs.mkdir(path.join(cache, "rules"), { recursive: true });
  const skipped = [];
  const resolved = await ensureEccCache(existingCacheTarget, {
    progress: { skipOperation: (id) => skipped.push(id) }
  });
  assert.equal(resolved, cache);
  assert.deepEqual(skipped, ["ecc-cache"]);
} finally {
  await fs.rm(existingCacheTarget, { recursive: true, force: true });
}

const rollbackAgentsTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-agent-rollback-"));
console.log = () => {};
try {
  const rollbackCache = path.join(rollbackAgentsTarget, ".repo-pattern", "cache", "ECC");
  await fs.mkdir(path.join(rollbackCache, "rules", "python"), { recursive: true });
  await fs.writeFile(path.join(rollbackCache, "rules", "python", "rule.md"), "new rule", "utf8");
  await fs.mkdir(path.join(rollbackCache, "agents"), { recursive: true });
  await fs.writeFile(path.join(rollbackCache, "agents", "new-agent.md"), "new", "utf8");
  spawnSync("git", ["init"], { cwd: rollbackCache, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: rollbackCache, stdio: "ignore" });
  spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "fixture"], { cwd: rollbackCache, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/affaan-m/ECC.git"], { cwd: rollbackCache, stdio: "ignore" });
  await fs.mkdir(path.join(rollbackAgentsTarget, ".claude", "rules", "ecc", "old"), { recursive: true });
  await fs.writeFile(path.join(rollbackAgentsTarget, ".claude", "rules", "ecc", "old", "rule.md"), "old rule", "utf8");
  await fs.mkdir(path.join(rollbackAgentsTarget, ".claude", "agents"), { recursive: true });
  await fs.writeFile(path.join(rollbackAgentsTarget, ".claude", "agents", "old-agent.md"), "old", "utf8");
  await fs.writeFile(path.join(rollbackAgentsTarget, ".claude", "CLAUDE.md"), "old guidance\n", "utf8");
  await fs.mkdir(path.join(rollbackAgentsTarget, ".repo-pattern"), { recursive: true });
  const rollbackConfig = "{\"before\":true}\n";
  const rollbackLock = "{\"before\":true}\n";
  await fs.writeFile(path.join(rollbackAgentsTarget, ".repo-pattern", ".repo-pattern.json"), rollbackConfig, "utf8");
  await fs.writeFile(path.join(rollbackAgentsTarget, ".repo-pattern", ".repo-pattern.lock.json"), rollbackLock, "utf8");
  await assert.rejects(
    () => applyEccRules({
      target: rollbackAgentsTarget,
      ruleMode: "manual",
      rules: ["python"],
      operations: { writeLock: async () => { throw new Error("injected lock failure"); } }
    }),
    /injected lock failure/
  );
  assert.equal(await fs.readFile(path.join(rollbackAgentsTarget, ".claude", "rules", "ecc", "old", "rule.md"), "utf8"), "old rule");
  await assert.rejects(() => fs.access(path.join(rollbackAgentsTarget, ".claude", "rules", "ecc", "python")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(rollbackAgentsTarget, ".claude", "agents", "old-agent.md"), "utf8"), "old");
  await assert.rejects(() => fs.access(path.join(rollbackAgentsTarget, ".claude", "agents", "new-agent.md")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(rollbackAgentsTarget, ".claude", "CLAUDE.md"), "utf8"), "old guidance\n");
  assert.equal(await fs.readFile(path.join(rollbackAgentsTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"), rollbackConfig);
  assert.equal(await fs.readFile(path.join(rollbackAgentsTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"), rollbackLock);
} finally {
  console.log = originalDoctorLog;
  await fs.rm(rollbackAgentsTarget, { recursive: true, force: true });
}

const backupCleanupTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-backup-cleanup-"));
const backupCleanupWarnings = [];
const originalWarn = console.warn;
console.log = () => {};
console.warn = (message) => backupCleanupWarnings.push(String(message));
try {
  const backupCleanupCache = path.join(backupCleanupTarget, ".repo-pattern", "cache", "ECC");
  await fs.mkdir(path.join(backupCleanupCache, "rules", "common"), { recursive: true });
  await fs.writeFile(path.join(backupCleanupCache, "rules", "common", "rule.md"), "new rule", "utf8");
  await fs.mkdir(path.join(backupCleanupCache, "agents"), { recursive: true });
  await fs.writeFile(path.join(backupCleanupCache, "agents", "new-agent.md"), "new", "utf8");
  spawnSync("git", ["init"], { cwd: backupCleanupCache, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: backupCleanupCache, stdio: "ignore" });
  spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "fixture"], { cwd: backupCleanupCache, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/affaan-m/ECC.git"], { cwd: backupCleanupCache, stdio: "ignore" });
  await fs.mkdir(path.join(backupCleanupTarget, ".claude", "rules", "ecc", "old"), { recursive: true });
  await fs.writeFile(path.join(backupCleanupTarget, ".claude", "rules", "ecc", "old", "rule.md"), "old rule", "utf8");
  await fs.mkdir(path.join(backupCleanupTarget, ".claude", "agents"), { recursive: true });
  await fs.writeFile(path.join(backupCleanupTarget, ".claude", "agents", "old-agent.md"), "old", "utf8");
  await applyEccRules({
    target: backupCleanupTarget,
    ruleMode: "manual",
    rules: ["common"],
    operations: { removeBackup: async () => { throw new Error("injected backup cleanup failure"); } }
  });
  assert.equal(await fs.readFile(path.join(backupCleanupTarget, ".claude", "rules", "ecc", "common", "rule.md"), "utf8"), "new rule");
  assert.equal(await fs.readFile(path.join(backupCleanupTarget, ".claude", "agents", "new-agent.md"), "utf8"), "new");
  assert(backupCleanupWarnings.some((message) => message.includes("ECC synchronization backup cleanup failed")));
} finally {
  console.log = originalDoctorLog;
  console.warn = originalWarn;
  await fs.rm(backupCleanupTarget, { recursive: true, force: true });
}

for (const failure of ["rule staging", "agent staging", "rule promotion", "agent promotion", "UV guidance", "config write"]) {
  const transactionFailureTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-transaction-failure-"));
  console.log = () => {};
  try {
    const transactionFailureCache = path.join(transactionFailureTarget, ".repo-pattern", "cache", "ECC");
    await fs.mkdir(path.join(transactionFailureCache, "rules", "python"), { recursive: true });
    await fs.writeFile(path.join(transactionFailureCache, "rules", "python", "rule.md"), "new rule", "utf8");
    await fs.mkdir(path.join(transactionFailureCache, "agents"), { recursive: true });
    await fs.writeFile(path.join(transactionFailureCache, "agents", "new-agent.md"), "new", "utf8");
    spawnSync("git", ["init"], { cwd: transactionFailureCache, stdio: "ignore" });
    spawnSync("git", ["add", "."], { cwd: transactionFailureCache, stdio: "ignore" });
    spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "fixture"], { cwd: transactionFailureCache, stdio: "ignore" });
    spawnSync("git", ["remote", "add", "origin", "https://github.com/affaan-m/ECC.git"], { cwd: transactionFailureCache, stdio: "ignore" });
    await fs.mkdir(path.join(transactionFailureTarget, ".claude", "rules", "ecc", "old"), { recursive: true });
    await fs.writeFile(path.join(transactionFailureTarget, ".claude", "rules", "ecc", "old", "rule.md"), "old rule", "utf8");
    await fs.mkdir(path.join(transactionFailureTarget, ".claude", "agents"), { recursive: true });
    await fs.writeFile(path.join(transactionFailureTarget, ".claude", "agents", "old-agent.md"), "old", "utf8");
    await fs.writeFile(path.join(transactionFailureTarget, ".claude", "CLAUDE.md"), "old guidance\n", "utf8");
    await fs.mkdir(path.join(transactionFailureTarget, ".repo-pattern"), { recursive: true });
    const transactionConfig = "{\"before\":true}\n";
    const transactionLock = "{\"before\":true}\n";
    await fs.writeFile(path.join(transactionFailureTarget, ".repo-pattern", ".repo-pattern.json"), transactionConfig, "utf8");
    await fs.writeFile(path.join(transactionFailureTarget, ".repo-pattern", ".repo-pattern.lock.json"), transactionLock, "utf8");
    const operations = {
      ...(failure === "rule staging" ? { copyRules: async () => { throw new Error("injected rule staging failure"); } } : {}),
      ...(failure === "agent staging" ? { copyFile: async () => { throw new Error("injected agent staging failure"); } } : {}),
      ...(failure === "rule promotion" ? { rename: async (source, destination) => {
        if (source.includes(".ecc-stage-")) throw new Error("injected rule promotion failure");
        await fs.rename(source, destination);
      } } : {}),
      ...(failure === "agent promotion" ? { rename: async (source, destination) => {
        if (source.includes(".agents-stage-")) throw new Error("injected agent promotion failure");
        await fs.rename(source, destination);
      } } : {}),
      ...(failure === "UV guidance" ? { writeClaudeMd: async () => { throw new Error("injected UV guidance failure"); } } : {}),
      ...(failure === "config write" ? { writeConfig: async () => { throw new Error("injected config write failure"); } } : {})
    };
    await assert.rejects(
      () => applyEccRules({ target: transactionFailureTarget, ruleMode: "manual", rules: ["python"], operations }),
      /injected/
    );
    assert.equal(await fs.readFile(path.join(transactionFailureTarget, ".claude", "rules", "ecc", "old", "rule.md"), "utf8"), "old rule");
    assert.equal(await fs.readFile(path.join(transactionFailureTarget, ".claude", "agents", "old-agent.md"), "utf8"), "old");
    assert.equal(await fs.readFile(path.join(transactionFailureTarget, ".claude", "CLAUDE.md"), "utf8"), "old guidance\n");
    assert.equal(await fs.readFile(path.join(transactionFailureTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"), transactionConfig);
    assert.equal(await fs.readFile(path.join(transactionFailureTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"), transactionLock);
  } finally {
    console.log = originalDoctorLog;
    await fs.rm(transactionFailureTarget, { recursive: true, force: true });
  }
}

const metadataSnapshotFailureTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-metadata-snapshot-failure-"));
console.log = () => {};
try {
  const metadataSnapshotFailureCache = await writeEccGitFixture(metadataSnapshotFailureTarget);
  await fs.mkdir(path.join(metadataSnapshotFailureTarget, ".claude"), { recursive: true });
  await fs.writeFile(path.join(metadataSnapshotFailureTarget, ".claude", "CLAUDE.md"), "guidance\n", "utf8");
  await fs.mkdir(path.join(metadataSnapshotFailureTarget, ".repo-pattern"), { recursive: true });
  await fs.symlink(".repo-pattern.json", path.join(metadataSnapshotFailureTarget, ".repo-pattern", ".repo-pattern.lock.json"));
  await assert.rejects(
    () => applyEccRules({ target: metadataSnapshotFailureTarget, ruleMode: "manual", rules: ["common"] }),
    /Transaction metadata must be a regular file/
  );
  const claudeEntries = await fs.readdir(path.join(metadataSnapshotFailureTarget, ".claude"));
  assert(!claudeEntries.some((entry) => entry.startsWith(".agents-stage-")));
  const rulesEntries = await fs.readdir(path.join(metadataSnapshotFailureTarget, ".claude", "rules"));
  assert(!rulesEntries.some((entry) => entry.startsWith(".ecc-stage-")));
} finally {
  console.log = originalDoctorLog;
  await fs.rm(metadataSnapshotFailureTarget, { recursive: true, force: true });
}

const absentMetadataRollbackTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-absent-metadata-"));
console.log = () => {};
try {
  const absentMetadataCache = path.join(absentMetadataRollbackTarget, ".repo-pattern", "cache", "ECC");
  await fs.mkdir(path.join(absentMetadataCache, "rules", "python"), { recursive: true });
  await fs.writeFile(path.join(absentMetadataCache, "rules", "python", "rule.md"), "new rule", "utf8");
  await fs.mkdir(path.join(absentMetadataCache, "agents"), { recursive: true });
  await fs.writeFile(path.join(absentMetadataCache, "agents", "new-agent.md"), "new", "utf8");
  spawnSync("git", ["init"], { cwd: absentMetadataCache, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: absentMetadataCache, stdio: "ignore" });
  spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "fixture"], { cwd: absentMetadataCache, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/affaan-m/ECC.git"], { cwd: absentMetadataCache, stdio: "ignore" });
  await assert.rejects(
    () => applyEccRules({
      target: absentMetadataRollbackTarget,
      ruleMode: "manual",
      rules: ["python"],
      operations: { writeLock: async () => { throw new Error("injected absent metadata lock failure"); } }
    }),
    /injected absent metadata lock failure/
  );
  await assert.rejects(() => fs.access(path.join(absentMetadataRollbackTarget, ".claude", "CLAUDE.md")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(path.join(absentMetadataRollbackTarget, ".repo-pattern", ".repo-pattern.json")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(path.join(absentMetadataRollbackTarget, ".repo-pattern", ".repo-pattern.lock.json")), { code: "ENOENT" });
} finally {
  console.log = originalDoctorLog;
  await fs.rm(absentMetadataRollbackTarget, { recursive: true, force: true });
}

async function assertInvalidEccSourcePreservesLiveState(name, configureCache, expectedError) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), `repo-pattern-invalid-${name}-`));
  console.log = () => {};
  try {
    const cache = await writeEccGitFixture(target);
    await configureCache(cache);
    await fs.mkdir(path.join(target, ".claude", "rules", "ecc", "old"), { recursive: true });
    await fs.writeFile(path.join(target, ".claude", "rules", "ecc", "old", "rule.md"), "old rule", "utf8");
    await fs.mkdir(path.join(target, ".claude", "agents"), { recursive: true });
    await fs.writeFile(path.join(target, ".claude", "agents", "old-agent.md"), "old", "utf8");
    await fs.writeFile(path.join(target, ".claude", "CLAUDE.md"), "old guidance\n", "utf8");
    await fs.mkdir(path.join(target, ".repo-pattern"), { recursive: true });
    await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.json"), "{\"before\":true}\n", "utf8");
    await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), "{\"before\":true}\n", "utf8");
    await assert.rejects(() => applyEccRules({ target, ruleMode: "manual", rules: ["common"] }), expectedError);
    assert.equal(await fs.readFile(path.join(target, ".claude", "rules", "ecc", "old", "rule.md"), "utf8"), "old rule");
    assert.equal(await fs.readFile(path.join(target, ".claude", "agents", "old-agent.md"), "utf8"), "old");
    assert.equal(await fs.readFile(path.join(target, ".claude", "CLAUDE.md"), "utf8"), "old guidance\n");
    assert.equal(await fs.readFile(path.join(target, ".repo-pattern", ".repo-pattern.json"), "utf8"), "{\"before\":true}\n");
    assert.equal(await fs.readFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"), "{\"before\":true}\n");
    await assert.rejects(() => fs.access(path.join(target, ".repo-pattern", ".gitignore")), { code: "ENOENT" });
  } finally {
    console.log = originalDoctorLog;
    await fs.rm(target, { recursive: true, force: true });
  }
}

const invalidCacheRollbackTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-invalid-cache-"));
console.log = () => {};
try {
  const invalidCache = path.join(invalidCacheRollbackTarget, ".repo-pattern", "cache", "ECC");
  await fs.mkdir(path.join(invalidCache, "rules", "common"), { recursive: true });
  await fs.writeFile(path.join(invalidCache, "rules", "common", "rule.md"), "new rule", "utf8");
  await fs.mkdir(path.join(invalidCacheRollbackTarget, ".claude", "rules", "ecc", "old"), { recursive: true });
  await fs.writeFile(path.join(invalidCacheRollbackTarget, ".claude", "rules", "ecc", "old", "rule.md"), "old rule", "utf8");
  await assert.rejects(
    () => applyEccRules({ target: invalidCacheRollbackTarget, ruleMode: "manual", rules: ["common"] }),
    /ECC cache is not a Git repository/
  );
  assert.equal(await fs.readFile(path.join(invalidCacheRollbackTarget, ".claude", "rules", "ecc", "old", "rule.md"), "utf8"), "old rule");
  await assert.rejects(() => fs.access(path.join(invalidCacheRollbackTarget, ".claude", "rules", "ecc", "common")), { code: "ENOENT" });
} finally {
  console.log = originalDoctorLog;
  await fs.rm(invalidCacheRollbackTarget, { recursive: true, force: true });
}

await assertInvalidEccSourcePreservesLiveState("origin", async (cache) => {
  spawnSync("git", ["remote", "set-url", "origin", "https://example.com/ECC.git"], { cwd: cache, stdio: "ignore" });
}, /ECC cache origin must be/);
await assertInvalidEccSourcePreservesLiveState("head", async (cache) => {
  await fs.rm(path.join(cache, ".git", "HEAD"));
}, /origin remote and a HEAD resolved to a commit/);
await assertInvalidEccSourcePreservesLiveState("missing-agents", async (cache) => {
  await fs.rm(path.join(cache, "agents"), { recursive: true, force: true });
}, /ECC agents source not found/);
await assertInvalidEccSourcePreservesLiveState("empty-agents", async (cache) => {
  await fs.rm(path.join(cache, "agents", "new-agent.md"));
}, /ECC agents source is empty/);
await assertInvalidEccSourcePreservesLiveState("dirty-agents", async (cache) => {
  await fs.writeFile(path.join(cache, "agents", "new-agent.md"), "tampered", "utf8");
}, /ECC cache rules and agents must match Git HEAD/);
await assertInvalidEccSourcePreservesLiveState("untracked-rules", async (cache) => {
  await fs.writeFile(path.join(cache, "rules", "common", "untracked.md"), "tampered", "utf8");
}, /ECC cache rules and agents must match Git HEAD/);
await assertInvalidEccSourcePreservesLiveState("rule-symlink", async (cache) => {
  await fs.rm(path.join(cache, "rules", "common", "rule.md"));
  await fs.symlink("../../agents/new-agent.md", path.join(cache, "rules", "common", "rule.md"));
}, /ECC rule pack common must not contain symlinks/);
if (process.platform !== "win32") {
  await assertInvalidEccSourcePreservesLiveState("rule-unsupported", async (cache) => {
    await fs.rm(path.join(cache, "rules", "common", "rule.md"));
    assert.equal(spawnSync("mkfifo", [path.join(cache, "rules", "common", "rule.pipe")]).status, 0);
  }, /ECC rule pack common contains unsupported entry/);
}
await assertInvalidEccSourcePreservesLiveState("agent-symlink", async (cache) => {
  await fs.rm(path.join(cache, "agents", "new-agent.md"));
  await fs.symlink("../rules/common/rule.md", path.join(cache, "agents", "agent.md"));
}, /ECC agents source must not contain symlinks/);

for (const { name, prepare } of [
  {
    name: "rules parent",
    prepare: async (target, outside) => {
      await fs.mkdir(path.join(target, ".claude"), { recursive: true });
      await fs.mkdir(outside, { recursive: true });
      await fs.symlink(outside, path.join(target, ".claude", "rules"), "dir");
    }
  },
  {
    name: "metadata parent",
    prepare: async (target, outside) => {
      await fs.mkdir(path.join(outside, "cache"), { recursive: true });
      await fs.rename(path.join(target, ".repo-pattern", "cache"), path.join(outside, "cache"));
      await fs.rm(path.join(target, ".repo-pattern"), { recursive: true, force: true });
      await fs.symlink(outside, path.join(target, ".repo-pattern"), "dir");
    }
  },
  {
    name: "backup parent",
    prepare: async (target, outside) => {
      await fs.mkdir(path.join(target, ".repo-pattern"), { recursive: true });
      await fs.symlink(outside, path.join(target, ".repo-pattern", "backups"), "dir");
    }
  }
]) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), `repo-pattern-${name.replace(" ", "-")}-symlink-`));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-symlink-outside-"));
  console.log = () => {};
  try {
    await writeEccGitFixture(target);
    await prepare(target, outside);
    await assert.rejects(
      () => applyEccRules({ target, ruleMode: "manual", rules: ["common"] }),
      /must not be a symlink/
    );
    await assert.deepEqual(await fs.readdir(outside), name === "metadata parent" ? ["cache"] : []);
  } finally {
    console.log = originalDoctorLog;
    await fs.rm(target, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
}

if (process.platform !== "win32") {
  await assertInvalidEccSourcePreservesLiveState("agent-unsupported", async (cache) => {
    await fs.rm(path.join(cache, "agents", "new-agent.md"));
    assert.equal(spawnSync("mkfifo", [path.join(cache, "agents", "agent.pipe")]).status, 0);
  }, /ECC agents source contains unsupported entry/);
}

const manifestOrderTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-agent-manifest-order-"));
try {
  await fs.writeFile(path.join(manifestOrderTarget, "A.md"), "upper", "utf8");
  await fs.writeFile(path.join(manifestOrderTarget, "a.md"), "lower", "utf8");
  const manifest = await buildAgentManifest(manifestOrderTarget);
  assert.deepEqual(manifest.map((entry) => entry.path), ["A.md", "a.md"]);
  assert.equal(validateAgentManifest(manifest), true);
} finally {
  await fs.rm(manifestOrderTarget, { recursive: true, force: true });
}

assert.equal(validateAgentManifest([{ path: "nested/agent.md", sha256: "a".repeat(64) }]), true);
assert.equal(validateAgentManifest([{ path: "../agent.md", sha256: "a".repeat(64) }]), false);
assert.equal(validateAgentManifest([{ path: "agent\\\\name.md", sha256: "a".repeat(64) }]), false);
assert.equal(validateAgentManifest([{ path: "b.md", sha256: "a".repeat(64) }, { path: "a.md", sha256: "a".repeat(64) }]), false);

}
