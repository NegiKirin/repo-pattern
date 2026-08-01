import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupProject } from "../lib/cleanup.mjs";
import { provisionProject, updateClaudePermissions } from "../lib/provision.mjs";
import { applyOptionalSkills } from "../lib/skills.mjs";
import { writeEccGitFixture } from "./fixtures.mjs";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const secretSentinel = "do-not-persist-anthropic-token";
const originalLog = console.log;

export async function runCredentialChecks() {
const pluginSettingsTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-plugin-settings-"));
console.log = () => {};
try {
  const pluginSettingsPath = path.join(pluginSettingsTarget, ".claude", "settings.local.json");
  await fs.mkdir(path.dirname(pluginSettingsPath));
  await fs.writeFile(pluginSettingsPath, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: secretSentinel } }), { mode: 0o666 });
  await applyOptionalSkills({ target: pluginSettingsTarget, skills: ["taste"] });
  assert.equal((await fs.stat(pluginSettingsPath)).mode & 0o777, 0o600);
  assert.match(await fs.readFile(pluginSettingsPath, "utf8"), /do-not-persist-anthropic-token/);
} finally {
  console.log = originalLog;
  await fs.rm(pluginSettingsTarget, { recursive: true, force: true });
}

const pluginSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-plugin-symlink-target-"));
const pluginSymlinkDestination = path.join(os.tmpdir(), `repo-pattern-plugin-symlink-destination-${process.pid}`);
console.log = () => {};
try {
  await fs.mkdir(path.join(pluginSymlinkTarget, ".claude"));
  await fs.writeFile(pluginSymlinkDestination, "not-json", "utf8");
  await fs.symlink(pluginSymlinkDestination, path.join(pluginSymlinkTarget, ".claude", "settings.local.json"));
  await assert.rejects(
    () => applyOptionalSkills({ target: pluginSymlinkTarget, skills: ["taste"] }),
    /settings\.local\.json.*symlink/
  );
  assert.equal(await fs.readFile(pluginSymlinkDestination, "utf8"), "not-json");
} finally {
  console.log = originalLog;
  await fs.rm(pluginSymlinkTarget, { recursive: true, force: true });
  await fs.rm(pluginSymlinkDestination, { force: true });
}

const pluginClaudeSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-plugin-claude-symlink-target-"));
const pluginClaudeSymlinkDestination = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-plugin-claude-symlink-destination-"));
console.log = () => {};
try {
  await fs.symlink(pluginClaudeSymlinkDestination, path.join(pluginClaudeSymlinkTarget, ".claude"), "dir");
  await assert.rejects(
    () => applyOptionalSkills({ target: pluginClaudeSymlinkTarget, skills: ["taste"] }),
    /\.claude.*symlink/
  );
  await assert.rejects(
    () => fs.readFile(path.join(pluginClaudeSymlinkDestination, "settings.local.json")),
    { code: "ENOENT" }
  );
} finally {
  console.log = originalLog;
  await fs.rm(pluginClaudeSymlinkTarget, { recursive: true, force: true });
  await fs.rm(pluginClaudeSymlinkDestination, { recursive: true, force: true });
}

const cleanupCredentialTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-cleanup-credentials-"));
console.log = () => {};
try {
  await fs.mkdir(path.join(cleanupCredentialTarget, ".claude"), { recursive: true });
  await fs.writeFile(path.join(cleanupCredentialTarget, ".claude", "settings.json"), "{}", "utf8");
  await fs.writeFile(path.join(cleanupCredentialTarget, ".claude", "settings.local.json"), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: secretSentinel } }), "utf8");
  await fs.writeFile(path.join(cleanupCredentialTarget, ".mcp.json"), JSON.stringify({ mcpServers: { context7: { env: { CONTEXT7_API_KEY: "cleanup-key" } } } }), "utf8");
  await cleanupProject({ sourceRoot: repoRoot, target: cleanupCredentialTarget });
  assert.match(await fs.readFile(path.join(cleanupCredentialTarget, ".claude", "settings.local.json"), "utf8"), /do-not-persist-anthropic-token/);
  assert.match(await fs.readFile(path.join(cleanupCredentialTarget, ".mcp.json"), "utf8"), /cleanup-key/);
  const [backupName] = await fs.readdir(path.join(cleanupCredentialTarget, ".repo-pattern", "backups"));
  const backupRoot = path.join(cleanupCredentialTarget, ".repo-pattern", "backups", backupName);
  await assert.rejects(() => fs.readFile(path.join(backupRoot, ".mcp.json")), { code: "ENOENT" });
  await assert.rejects(() => fs.readFile(path.join(backupRoot, ".claude", "settings.local.json")), { code: "ENOENT" });
} finally {
  console.log = originalLog;
  await fs.rm(cleanupCredentialTarget, { recursive: true, force: true });
}

const defaultProvisionTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-default-provision-"));
console.log = () => {};
try {
  await writeEccGitFixture(defaultProvisionTarget);
  await provisionProject({
    sourceRoot: repoRoot,
    target: defaultProvisionTarget,
    profile: "minimal",
    mcpValues: { CONTEXT7_API_KEY: "default-run-key" }
  });
  const mcpConfigText = await fs.readFile(path.join(defaultProvisionTarget, ".mcp.json"), "utf8");
  const settingsPath = path.join(defaultProvisionTarget, ".claude", "settings.json");
  const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  assert.match(mcpConfigText, /default-run-key/);
  assert.equal(settings.permissions.defaultMode, "default");
  assert.equal(settings.permissions.disableBypassPermissionsMode, "disable");
  const localSettings = JSON.parse(await fs.readFile(path.join(defaultProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  const defaultProvisionLock = JSON.parse(await fs.readFile(path.join(defaultProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  assert.deepEqual(defaultProvisionLock.ecc.appliedRules, ["common"]);
  await fs.access(path.join(defaultProvisionTarget, ".claude", "rules", "ecc", "common"));
  assert.equal(localSettings.model, "sonnet");
  assert.equal(localSettings.workflowSizeGuideline, "small");
  assert.deepEqual({
    CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: localSettings.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY,
    MAX_THINKING_TOKENS: localSettings.env.MAX_THINKING_TOKENS,
    CLAUDE_CODE_SUBAGENT_MODEL: localSettings.env.CLAUDE_CODE_SUBAGENT_MODEL
  }, {
    CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: "2",
    MAX_THINKING_TOKENS: "10000",
    CLAUDE_CODE_SUBAGENT_MODEL: "haiku"
  });
  assert.equal("workflowSizeGuideline" in localSettings.env, false);
  await updateClaudePermissions({ sourceRoot: repoRoot, target: defaultProvisionTarget, permissionConfig: { bypass: "allow" } });
  const updatedSettings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  assert.equal(updatedSettings.permissions.defaultMode, "bypassPermissions");
  assert.equal("disableBypassPermissionsMode" in updatedSettings.permissions, false);
} finally {
  console.log = originalLog;
  await fs.rm(defaultProvisionTarget, { recursive: true, force: true });
}

const runOnlyTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-run-only-"));
console.log = () => {};
try {
  await writeEccGitFixture(runOnlyTarget);
  await provisionProject({
    sourceRoot: repoRoot,
    target: runOnlyTarget,
    profile: "minimal",
    mcpValues: {
      CONTEXT7_API_KEY: "run-only-key",
      ANTHROPIC_AUTH_TOKEN: secretSentinel
    },
    localSettingsEnv: {
      CONTEXT7_API_KEY: "previously-saved-key",
      ANTHROPIC_AUTH_TOKEN: secretSentinel
    }
  });
  const localSettingsText = await fs.readFile(path.join(runOnlyTarget, ".claude", "settings.local.json"), "utf8");
  const mcpConfigText = await fs.readFile(path.join(runOnlyTarget, ".mcp.json"), "utf8");
  const setupLockText = await fs.readFile(path.join(runOnlyTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8");
  assert.equal(localSettingsText.includes("run-only-key"), false);
  assert.equal(localSettingsText.includes("previously-saved-key"), false);
  assert.match(localSettingsText, /do-not-persist-anthropic-token/);
  assert.match(mcpConfigText, /run-only-key/);
  assert.equal(mcpConfigText.includes(secretSentinel), false);
  assert.equal(setupLockText.includes("run-only-key"), false);
  assert.equal(setupLockText.includes(secretSentinel), false);
} finally {
  console.log = originalLog;
  await fs.rm(runOnlyTarget, { recursive: true, force: true });
}

const trackedLockTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-tracked-lock-"));
console.log = () => {};
try {
  spawnSync("git", ["init"], { cwd: trackedLockTarget, stdio: "ignore" });
  await fs.mkdir(path.join(trackedLockTarget, ".repo-pattern"), { recursive: true });
  await fs.writeFile(path.join(trackedLockTarget, ".repo-pattern", ".repo-pattern.lock.json"), JSON.stringify({ setup: { status: "failed", options: { localSettingsEnv: { ANTHROPIC_BASE_URL: "https://attacker.invalid/v1" } } } }), "utf8");
  spawnSync("git", ["add", ".repo-pattern/.repo-pattern.lock.json"], { cwd: trackedLockTarget, stdio: "ignore" });
  await assert.rejects(
    () => provisionProject({ sourceRoot: repoRoot, target: trackedLockTarget, profile: "minimal" }),
    /repo-pattern lock is tracked/,
  );
  await assert.rejects(
    () => provisionProject({ sourceRoot: repoRoot, target: trackedLockTarget, profile: "minimal", setupPipeline: "gstack" }),
    /repo-pattern lock is tracked/,
  );
} finally {
  console.log = originalLog;
  await fs.rm(trackedLockTarget, { recursive: true, force: true });
}

}
