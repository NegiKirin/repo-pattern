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
import { backupPaths, copyRecursiveWithProgress, scanCopyTree, writePrivateJson } from "../lib/fs-utils.mjs";
import { printSummary, renderLogo, style } from "../lib/prompt.mjs";
import { needsLocalSettingsPrompt, setupProject, setupRetryOptions } from "../lib/setup.mjs";
import { applyEccRules, buildAgentManifest, clearEccRules, formatEccCloneError, hasGitUpstream, validateAgentManifest } from "../lib/rules.mjs";
import { applyOptionalSkills, applyPluginSkillSettings, expectedOptionalSkillDirs, invalidOptionalSkills, normalizeOptionalSkills, OPTIONAL_SKILLS } from "../lib/skills.mjs";
const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const cliPath = path.join(cliDir, "..", "repo-pattern.mjs");
const secretSentinel = "do-not-persist-anthropic-token";

import { writeEccGitFixture } from "./fixtures.mjs";
const originalLog = console.log;

export async function runFilesystemChecks() {
const copyProgressRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-copy-progress-"));
try {
  const source = path.join(copyProgressRoot, "source");
  const destination = path.join(copyProgressRoot, "destination");
  await fs.mkdir(path.join(source, "nested"), { recursive: true });
  await fs.writeFile(path.join(source, "one.txt"), "one", { mode: 0o640 });
  await fs.writeFile(path.join(source, "nested", "zero.txt"), "");
  const tree = await scanCopyTree(source);
  assert.deepEqual({ files: tree.files, bytes: tree.bytes }, { files: 2, bytes: 3 });
  const events = [];
  assert.deepEqual(await copyRecursiveWithProgress(source, destination, {
    onProgress: (event) => events.push(event)
  }), { files: 2, bytes: 3 });
  assert.deepEqual(events.at(0), { completedFiles: 0, totalFiles: 2, completedBytes: 0, totalBytes: 3 });
  assert.deepEqual(events.at(-1), { completedFiles: 2, totalFiles: 2, completedBytes: 3, totalBytes: 3 });
  assert.equal((await fs.stat(path.join(destination, "one.txt"))).mode & 0o777, 0o640);

  const outside = path.join(copyProgressRoot, "outside.txt");
  const symlinkDestination = path.join(copyProgressRoot, "symlink-destination");
  await fs.mkdir(symlinkDestination);
  await fs.writeFile(outside, "unchanged");
  await fs.symlink(outside, path.join(symlinkDestination, "one.txt"));
  await assert.rejects(
    () => copyRecursiveWithProgress(source, symlinkDestination),
    /copy destination must not be a symlink/
  );
  assert.equal(await fs.readFile(outside, "utf8"), "unchanged");

  const backupEvents = [];
  const progress = { beginOperation(spec) {
    backupEvents.push({ type: "begin", ...spec });
    return {
      update: (values) => backupEvents.push({ type: "update", ...values }),
      complete: (values) => backupEvents.push({ type: "complete", ...values }),
      fail: (values) => backupEvents.push({ type: "fail", ...values })
    };
  } };
  await backupPaths(copyProgressRoot, ["source"], { progress, progressId: "fixture-backup" });
  assert.equal(backupEvents[0].id, "fixture-backup");
  assert.equal(backupEvents.at(-1).type, "complete");
  let skipped = false;
  await backupPaths(copyProgressRoot, ["missing"], { progress: { skipOperation: () => { skipped = true; } } });
  assert.equal(skipped, true);
} finally {
  await fs.rm(copyProgressRoot, { recursive: true, force: true });
}

const unrelatedRulesTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-unrelated-rules-"));
console.log = () => {};
try {
  await provisionProject({
    sourceRoot: repoRoot,
    target: unrelatedRulesTarget,
    profile: "backend",
    setupPipeline: "none",
    applyRules: false
  });
  const unrelatedRulePath = path.join(unrelatedRulesTarget, ".claude", "rules", "third-party", "rule.md");
  const unrelatedSkillPath = path.join(unrelatedRulesTarget, ".claude", "skills", "third-party", "SKILL.md");
  await fs.mkdir(path.dirname(unrelatedRulePath), { recursive: true });
  await fs.mkdir(path.dirname(unrelatedSkillPath), { recursive: true });
  await fs.writeFile(unrelatedRulePath, "preserve", "utf8");
  await fs.writeFile(unrelatedSkillPath, "preserve", "utf8");

  await provisionProject({
    sourceRoot: repoRoot,
    target: unrelatedRulesTarget,
    profile: "backend",
    setupPipeline: "none",
    applyRules: false
  });
  assert.equal(await fs.readFile(unrelatedRulePath, "utf8"), "preserve");
  assert.equal(await fs.readFile(unrelatedSkillPath, "utf8"), "preserve");
  assert.equal((await auditProject(unrelatedRulesTarget)).state, "NO_PIPELINE_MINIMAL");
  await doctorProject(unrelatedRulesTarget);
} finally {
  console.log = originalLog;
  await fs.rm(unrelatedRulesTarget, { recursive: true, force: true });
}

const provisionTemplateTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-template-"));
console.log = () => {};
try {
  await writeEccGitFixture(provisionTemplateTarget);
  await provisionProject({
    sourceRoot: repoRoot,
    target: provisionTemplateTarget,
    profile: "backend",
    mcpValues: {
      CONTEXT7_API_KEY: "redacted-key",
      ANTHROPIC_AUTH_TOKEN: secretSentinel,
      OTHER_API_KEY: "other-key"
    },
    localSettingsEnv: {
      ANTHROPIC_BASE_URL: "https://example.com/v1",
      ANTHROPIC_AUTH_TOKEN: secretSentinel,
      CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "7",
      MAX_THINKING_TOKENS: "9000"
    },
    permissionConfig: { bypass: "allow" }
  });
  const localSettingsPath = path.join(provisionTemplateTarget, ".claude", "settings.local.json");
  const localSettingsText = await fs.readFile(localSettingsPath, "utf8");
  const localSettings = JSON.parse(localSettingsText);
  const settings = JSON.parse(await fs.readFile(path.join(provisionTemplateTarget, ".claude", "settings.json"), "utf8"));
  assert.equal((await fs.stat(localSettingsPath)).mode & 0o777, 0o600);
  const setupLockText = await fs.readFile(path.join(provisionTemplateTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8");
  const mcpConfigPath = path.join(provisionTemplateTarget, ".mcp.json");
  const mcpConfigText = await fs.readFile(mcpConfigPath, "utf8");
  assert.equal((await fs.stat(mcpConfigPath)).mode & 0o777, 0o600);
  assert.equal(localSettings.env.ANTHROPIC_AUTH_TOKEN, secretSentinel);
  assert.equal(localSettings.env.ANTHROPIC_BASE_URL, "https://example.com/v1");
  assert.equal(localSettings.model, "sonnet");
  assert.equal(localSettings.workflowSizeGuideline, "small");
  assert.equal(localSettings.env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION, "7");
  assert.equal(localSettings.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY, "2");
  assert.equal(localSettings.env.MAX_THINKING_TOKENS, "9000");
  assert.equal(localSettings.env.CLAUDE_CODE_SUBAGENT_MODEL, "haiku");
  assert.equal("workflowSizeGuideline" in localSettings.env, false);
  assert.equal(settings.permissions.defaultMode, "bypassPermissions");
  assert.equal("disableBypassPermissionsMode" in settings.permissions, false);
  assert.equal("CONTEXT7_API_KEY" in localSettings.env, false);
  assert.equal("TAVILY_API_KEY" in localSettings.env, false);
  assert.match(mcpConfigText, /redacted-key/);
  assert.equal(mcpConfigText.includes(secretSentinel), false);
  assert.equal(setupLockText.includes("redacted-key"), false);
  assert.equal(setupLockText.includes(secretSentinel), false);
  assert.equal("OTHER_API_KEY" in localSettings.env, false);
  const repoConfig = JSON.parse(await fs.readFile(path.join(provisionTemplateTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  assert.equal(repoConfig.mode, "target");
  assert.equal(repoConfig.mcp.profile, "backend");
  assert.equal(repoConfig.mcp.generated, true);
  assert.equal(await fs.readFile(path.join(provisionTemplateTarget, ".claude", "CLAUDE.md"), "utf8"), await fs.readFile(path.join(repoRoot, ".claude.example", "CLAUDE.md"), "utf8"));
  const provisionGitignore = (await fs.readFile(path.join(provisionTemplateTarget, ".gitignore"), "utf8")).split(/\r?\n/);
  for (const line of [".DS_Store", "Thumbs.db", ".vscode/", ".idea/", ".claude/", ".mcp.json"]) {
    assert(provisionGitignore.includes(line));
  }
  const repoPatternGitignore = (await fs.readFile(path.join(provisionTemplateTarget, ".repo-pattern", ".gitignore"), "utf8")).trim();
  assert.equal(repoPatternGitignore, "*");

  await fs.chmod(localSettingsPath, 0o666);
  await fs.chmod(mcpConfigPath, 0o666);
  await writeEccGitFixture(provisionTemplateTarget);
  await provisionProject({
    sourceRoot: repoRoot,
    target: provisionTemplateTarget,
    profile: "backend",
    mcpValues: { CONTEXT7_API_KEY: "replacement-key" },
    localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: "replacement-token" }
  });
  assert.equal((await fs.stat(localSettingsPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(mcpConfigPath)).mode & 0o777, 0o600);
  const [backupName] = await fs.readdir(path.join(provisionTemplateTarget, ".repo-pattern", "backups"));
  const backupRoot = path.join(provisionTemplateTarget, ".repo-pattern", "backups", backupName);
  await assert.rejects(() => fs.readFile(path.join(backupRoot, ".mcp.json")), { code: "ENOENT" });
  await assert.rejects(() => fs.readFile(path.join(backupRoot, ".claude", "settings.local.json")), { code: "ENOENT" });
} finally {
  console.log = originalLog;
  await fs.rm(provisionTemplateTarget, { recursive: true, force: true });
}

const symlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-symlink-target-"));
const symlinkDestination = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-symlink-destination-"));
console.log = () => {};
try {
  await fs.symlink(symlinkDestination, path.join(symlinkTarget, ".claude"), "dir");
  await assert.rejects(
    () => provisionProject({
      sourceRoot: repoRoot,
      target: symlinkTarget,
      profile: "backend",
      localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: secretSentinel }
    }),
    /\.claude.*symlink/
  );
  await assert.rejects(
    () => fs.readFile(path.join(symlinkDestination, "settings.local.json")),
    { code: "ENOENT" }
  );
} finally {
  console.log = originalLog;
  await fs.rm(symlinkTarget, { recursive: true, force: true });
  await fs.rm(symlinkDestination, { recursive: true, force: true });
}

const settingsSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-settings-symlink-target-"));
const settingsSymlinkDestination = path.join(os.tmpdir(), `repo-pattern-settings-symlink-destination-${process.pid}`);
console.log = () => {};
try {
  await fs.mkdir(path.join(settingsSymlinkTarget, ".claude"));
  await fs.mkdir(settingsSymlinkDestination);
  await fs.symlink(settingsSymlinkDestination, path.join(settingsSymlinkTarget, ".claude", "settings.local.json"));
  await assert.rejects(
    () => provisionProject({
      sourceRoot: repoRoot,
      target: settingsSymlinkTarget,
      profile: "backend",
      localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: secretSentinel }
    }),
    /settings\.local\.json.*symlink/
  );
  assert.deepEqual(await fs.readdir(settingsSymlinkDestination), []);
} finally {
  console.log = originalLog;
  await fs.rm(settingsSymlinkTarget, { recursive: true, force: true });
  await fs.rm(settingsSymlinkDestination, { recursive: true, force: true });
}

const doctorLockSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-lock-symlink-target-"));
const doctorLockSymlinkDestination = path.join(os.tmpdir(), `repo-pattern-doctor-lock-symlink-destination-${process.pid}`);
console.log = () => {};
try {
  await fs.mkdir(path.join(doctorLockSymlinkTarget, ".repo-pattern"));
  await fs.writeFile(doctorLockSymlinkDestination, "unchanged", "utf8");
  await fs.symlink(doctorLockSymlinkDestination, path.join(doctorLockSymlinkTarget, ".repo-pattern", ".repo-pattern.lock.json"));
  await assert.rejects(
    () => doctorProject(doctorLockSymlinkTarget, { updateLock: true }),
    /\.repo-pattern\/.repo-pattern\.lock\.json.*symlink/
  );
  assert.equal(await fs.readFile(doctorLockSymlinkDestination, "utf8"), "unchanged");
} finally {
  console.log = originalLog;
  await fs.rm(doctorLockSymlinkTarget, { recursive: true, force: true });
  await fs.rm(doctorLockSymlinkDestination, { force: true });
}

const doctorStateSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-state-symlink-target-"));
const doctorStateSymlinkDestination = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-state-symlink-destination-"));
console.log = () => {};
try {
  await fs.symlink(doctorStateSymlinkDestination, path.join(doctorStateSymlinkTarget, ".repo-pattern"), "dir");
  await assert.rejects(
    () => doctorProject(doctorStateSymlinkTarget, { updateLock: true }),
    /\.repo-pattern.*symlink/
  );
  assert.equal(await fs.readdir(doctorStateSymlinkDestination).then((entries) => entries.length), 0);
} finally {
  console.log = originalLog;
  await fs.rm(doctorStateSymlinkTarget, { recursive: true, force: true });
  await fs.rm(doctorStateSymlinkDestination, { recursive: true, force: true });
}

const eccSettingsTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-ecc-settings-"));
console.log = () => {};
try {
  const eccSettingsPath = path.join(eccSettingsTarget, ".claude", "settings.local.json");
  await fs.mkdir(path.dirname(eccSettingsPath));
  await fs.writeFile(eccSettingsPath, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: secretSentinel } }), { mode: 0o666 });
  await setupEcc({ target: eccSettingsTarget });
  assert.equal((await fs.stat(eccSettingsPath)).mode & 0o777, 0o600);
  assert.match(await fs.readFile(eccSettingsPath, "utf8"), /do-not-persist-anthropic-token/);
} finally {
  console.log = originalLog;
  await fs.rm(eccSettingsTarget, { recursive: true, force: true });
}

const eccSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-ecc-symlink-target-"));
const eccSymlinkDestination = path.join(os.tmpdir(), `repo-pattern-ecc-symlink-destination-${process.pid}`);
console.log = () => {};
try {
  await fs.mkdir(path.join(eccSymlinkTarget, ".claude"));
  await fs.writeFile(eccSymlinkDestination, "not-json", "utf8");
  await fs.symlink(eccSymlinkDestination, path.join(eccSymlinkTarget, ".claude", "settings.local.json"));
  await assert.rejects(
    () => setupEcc({ target: eccSymlinkTarget }),
    /settings\.local\.json.*symlink/
  );
  assert.equal(await fs.readFile(eccSymlinkDestination, "utf8"), "not-json");
} finally {
  console.log = originalLog;
  await fs.rm(eccSymlinkTarget, { recursive: true, force: true });
  await fs.rm(eccSymlinkDestination, { force: true });
}
}
