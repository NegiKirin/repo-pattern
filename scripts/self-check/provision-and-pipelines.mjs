import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject } from "../lib/audit.mjs";
import { doctorProject } from "../lib/doctor.mjs";
import { removeEccPluginSettings, setupGstack } from "../lib/gstack.mjs";
import { provisionProject } from "../lib/provision.mjs";
import { setupProject } from "../lib/setup.mjs";
import { writeEccGitFixture } from "./fixtures.mjs";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const cliPath = path.join(cliDir, "..", "repo-pattern.mjs");
const secretSentinel = "do-not-persist-anthropic-token";
const originalDoctorLog = console.log;
const originalLog = console.log;

function runCli(args, cwd = repoRoot) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8" });
}

export async function runProvisionAndPipelineChecks() {
const originalGstackSetupCommand = process.env.REPO_PATTERN_GSTACK_SETUP_CMD;
let result;
const provisionRollbackTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-provision-rollback-"));
console.log = () => {};
try {
  const provisionRollbackCache = await writeEccGitFixture(provisionRollbackTarget);
  await fs.mkdir(path.join(provisionRollbackCache, "rules", "common"), { recursive: true });
  await fs.mkdir(path.join(provisionRollbackTarget, ".claude", "rules", "ecc", "old"), { recursive: true });
  await fs.writeFile(path.join(provisionRollbackTarget, ".claude", "rules", "ecc", "old", "rule.md"), "old rule", "utf8");
  await fs.mkdir(path.join(provisionRollbackTarget, ".claude", "agents"), { recursive: true });
  await fs.writeFile(path.join(provisionRollbackTarget, ".claude", "agents", "old-agent.md"), "old", "utf8");
  await fs.mkdir(path.join(provisionRollbackTarget, ".repo-pattern"), { recursive: true });
  const provisionConfig = "{\"workflow\":\"none\"}\n";
  const provisionLock = "{\"ecc\":{\"rulesSyncedBy\":\"repo-pattern-auto-cache\",\"agentsSyncedBy\":\"repo-pattern-auto-cache\"}}\n";
  const provisionMcp = "{\"before\":true}\n";
  const provisionGitignore = "old ignore\n";
  const provisionClaudeMd = "old generated guidance\n";
  await fs.writeFile(path.join(provisionRollbackTarget, ".claude", "CLAUDE.md"), provisionClaudeMd, "utf8");
  await fs.writeFile(path.join(provisionRollbackTarget, ".repo-pattern", ".repo-pattern.json"), provisionConfig, "utf8");
  await fs.writeFile(path.join(provisionRollbackTarget, ".repo-pattern", ".repo-pattern.lock.json"), provisionLock, "utf8");
  await fs.writeFile(path.join(provisionRollbackTarget, ".repo-pattern", ".gitignore"), provisionGitignore, "utf8");
  await fs.writeFile(path.join(provisionRollbackTarget, ".mcp.json"), provisionMcp, "utf8");
  await assert.rejects(
    () => provisionProject({
      sourceRoot: repoRoot,
      target: provisionRollbackTarget,
      profile: "minimal",
      setupPipeline: "none",
      applyRules: true,
      ruleMode: "manual",
      rules: ["common"],
      optionalSkills: ["nope"]
    }),
    /Unknown optional skill\(s\): nope/
  );
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".claude", "rules", "ecc", "old", "rule.md"), "utf8"), "old rule");
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".claude", "agents", "old-agent.md"), "utf8"), "old");
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"), provisionConfig);
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"), provisionLock);
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".repo-pattern", ".gitignore"), "utf8"), provisionGitignore);
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".claude", "CLAUDE.md"), "utf8"), provisionClaudeMd);
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".mcp.json"), "utf8"), provisionMcp);
} finally {
  console.log = originalDoctorLog;
  await fs.rm(provisionRollbackTarget, { recursive: true, force: true });
}


const failedGstackTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-failed-"));
console.log = () => {};
try {
  const localSettingsPath = path.join(failedGstackTarget, ".claude", "settings.local.json");
  await fs.mkdir(path.dirname(localSettingsPath));
  await fs.writeFile(localSettingsPath, JSON.stringify({
    env: { ANTHROPIC_AUTH_TOKEN: secretSentinel },
    enabledPlugins: { "ecc@ecc": true }
  }), { mode: 0o600 });
  process.env.REPO_PATTERN_GSTACK_SETUP_CMD = "false";
  await assert.rejects(() => setupGstack({ target: failedGstackTarget }), /Command failed/);
  assert.match(await fs.readFile(localSettingsPath, "utf8"), /ecc@ecc/);
} finally {
  if (originalGstackSetupCommand === undefined) delete process.env.REPO_PATTERN_GSTACK_SETUP_CMD;
  else process.env.REPO_PATTERN_GSTACK_SETUP_CMD = originalGstackSetupCommand;
  console.log = originalLog;
  await fs.rm(failedGstackTarget, { recursive: true, force: true });
}

const failedGstackProvisionTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-failed-provision-"));
console.log = () => {};
try {
  const localSettingsPath = path.join(failedGstackProvisionTarget, ".claude", "settings.local.json");
  await fs.mkdir(path.dirname(localSettingsPath));
  await fs.writeFile(localSettingsPath, JSON.stringify({
    env: { ANTHROPIC_AUTH_TOKEN: "existing-token" },
    enabledPlugins: { "ecc@ecc": true }
  }), { mode: 0o600 });
  const existingRulePath = path.join(failedGstackProvisionTarget, ".claude", "rules", "ecc", "existing.md");
  await fs.mkdir(path.dirname(existingRulePath), { recursive: true });
  await fs.writeFile(existingRulePath, "existing rule\n", "utf8");
  await fs.mkdir(path.join(failedGstackProvisionTarget, ".claude", "commands"));
  process.env.REPO_PATTERN_GSTACK_SETUP_CMD = "false";
  await assert.rejects(() => provisionProject({
    sourceRoot: repoRoot,
    target: failedGstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "gstack",
    localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: "replacement-token" },
    migrate: true
  }), /Command failed/);
  const localSettings = await fs.readFile(localSettingsPath, "utf8");
  assert.match(localSettings, /ecc@ecc/);
  assert.match(localSettings, /existing-token/);
  assert.equal(await fs.readFile(existingRulePath, "utf8"), "existing rule\n");
  process.env.REPO_PATTERN_GSTACK_SETUP_CMD = "true";
  await provisionProject({
    sourceRoot: repoRoot,
    target: failedGstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "gstack",
    localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: "replacement-token" },
    migrate: true
  });
  assert.equal((await auditProject(failedGstackProvisionTarget)).state, "GSTACK_MINIMAL");
  assert.match(await fs.readFile(localSettingsPath, "utf8"), /replacement-token/);
} finally {
  if (originalGstackSetupCommand === undefined) delete process.env.REPO_PATTERN_GSTACK_SETUP_CMD;
  else process.env.REPO_PATTERN_GSTACK_SETUP_CMD = originalGstackSetupCommand;
  console.log = originalLog;
  await fs.rm(failedGstackProvisionTarget, { recursive: true, force: true });
}

const trackedGstackSettingsTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-tracked-settings-"));
console.log = () => {};
try {
  spawnSync("git", ["init"], { cwd: trackedGstackSettingsTarget, stdio: "ignore" });
  await fs.mkdir(path.join(trackedGstackSettingsTarget, ".claude"));
  const localSettingsPath = path.join(trackedGstackSettingsTarget, ".claude", "settings.local.json");
  await fs.writeFile(localSettingsPath, JSON.stringify({ enabledPlugins: { "ecc@ecc": true } }), { mode: 0o600 });
  spawnSync("git", ["add", ".claude/settings.local.json"], { cwd: trackedGstackSettingsTarget, stdio: "ignore" });
  process.env.REPO_PATTERN_GSTACK_SETUP_CMD = "true";
  await assert.rejects(() => setupGstack({ target: trackedGstackSettingsTarget }), /settings\.local\.json is tracked/);
  await assert.rejects(() => removeEccPluginSettings({ target: trackedGstackSettingsTarget }), /settings\.local\.json is tracked/);
  assert.match(await fs.readFile(localSettingsPath, "utf8"), /ecc@ecc/);
} finally {
  if (originalGstackSetupCommand === undefined) delete process.env.REPO_PATTERN_GSTACK_SETUP_CMD;
  else process.env.REPO_PATTERN_GSTACK_SETUP_CMD = originalGstackSetupCommand;
  console.log = originalLog;
  await fs.rm(trackedGstackSettingsTarget, { recursive: true, force: true });
}

const incompleteGstackTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-incomplete-"));
console.log = () => {};
try {
  await fs.mkdir(path.join(incompleteGstackTarget, ".claude"));
  await fs.mkdir(path.join(incompleteGstackTarget, ".repo-pattern"));
  await fs.writeFile(path.join(incompleteGstackTarget, ".repo-pattern", ".repo-pattern.json"), JSON.stringify({
    workflow: "gstack",
    runtime: { localSkills: false, localCommands: false, localHooks: false, localScripts: false, localRules: false }
  }));
  await fs.writeFile(path.join(incompleteGstackTarget, ".repo-pattern", ".repo-pattern.lock.json"), JSON.stringify({
    gstack: { status: "not-run" }
  }));
  assert.equal((await auditProject(incompleteGstackTarget)).state, "PARTIAL");
  await assert.rejects(() => doctorProject(incompleteGstackTarget), /Doctor failed/);
} finally {
  console.log = originalLog;
  await fs.rm(incompleteGstackTarget, { recursive: true, force: true });
}

await assert.rejects(
  () => setupProject({ sourceRoot: repoRoot, target: os.tmpdir(), setupPipeline: "invalid", yes: true }),
  /Unknown setup pipeline: invalid/
);
await assert.rejects(
  () => provisionProject({ sourceRoot: repoRoot, target: os.tmpdir(), setupPipeline: "invalid", dryRun: true }),
  /Unknown setup pipeline: invalid/
);
await assert.rejects(
  () => provisionProject({ sourceRoot: repoRoot, target: os.tmpdir(), setupPipeline: "ecc", planTuneHooks: true, dryRun: true }),
  /--with-plan-tune-hooks requires --setup-pipeline gstack or both/
);

const bothProvisionTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-both-provision-"));
console.log = () => {};
try {
  process.env.REPO_PATTERN_ECC_SETUP_CMD = "true";
  process.env.REPO_PATTERN_GSTACK_SETUP_CMD = "true";
  await writeEccGitFixture(bothProvisionTarget);
  await provisionProject({
    sourceRoot: repoRoot,
    target: bothProvisionTarget,
    profile: "minimal",
    setupPipeline: "both",
    planTuneHooks: true,
    localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: secretSentinel }
  });
  const repoConfig = JSON.parse(await fs.readFile(path.join(bothProvisionTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  const lock = JSON.parse(await fs.readFile(path.join(bothProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  const localSettings = JSON.parse(await fs.readFile(path.join(bothProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  assert.equal(repoConfig.workflow, "ecc-gstack");
  assert.equal(lock.setupPipeline, "both");
  assert.equal(lock.ecc.status, "installed");
  assert.equal(lock.gstack.status, "installed");
  assert.equal(lock.gstack.planTuneHooks, true);
  assert.equal(localSettings.enabledPlugins["ecc@ecc"], true);
  assert.equal(localSettings.extraKnownMarketplaces.ecc.source.url, "https://github.com/affaan-m/ECC.git");
  assert.equal((await auditProject(bothProvisionTarget)).state, "ECC_GSTACK_MINIMAL");
  await doctorProject(bothProvisionTarget);
} finally {
  delete process.env.REPO_PATTERN_ECC_SETUP_CMD;
  if (originalGstackSetupCommand === undefined) delete process.env.REPO_PATTERN_GSTACK_SETUP_CMD;
  else process.env.REPO_PATTERN_GSTACK_SETUP_CMD = originalGstackSetupCommand;
  console.log = originalLog;
  await fs.rm(bothProvisionTarget, { recursive: true, force: true });
}

const noPipelineProvisionTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-none-provision-"));
console.log = () => {};
try {
  await writeEccGitFixture(noPipelineProvisionTarget);
  await provisionProject({
    sourceRoot: repoRoot,
    target: noPipelineProvisionTarget,
    profile: "minimal",
    setupPipeline: "none",
    localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: secretSentinel },
    applyRules: true
  });
  const repoConfig = JSON.parse(await fs.readFile(path.join(noPipelineProvisionTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  const lock = JSON.parse(await fs.readFile(path.join(noPipelineProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  const localSettings = JSON.parse(await fs.readFile(path.join(noPipelineProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  assert.equal(repoConfig.workflow, "none");
  assert.equal(lock.setupPipeline, "none");
  assert.deepEqual(lock.ecc.appliedRules, ["common"]);
  assert.equal("gstack" in lock, false);
  assert.equal(localSettings.enabledPlugins["ecc@ecc"], undefined);
  assert.equal((await auditProject(noPipelineProvisionTarget)).state, "NO_PIPELINE_MINIMAL");
  await doctorProject(noPipelineProvisionTarget);
} finally {
  console.log = originalLog;
  await fs.rm(noPipelineProvisionTarget, { recursive: true, force: true });
}

const setupBothDryRunTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-both-dry-run-"));
try {
  result = runCli(["setup", "--target", setupBothDryRunTarget, "--setup-pipeline", "both", "--yes", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Setup pipeline\s+both/);
  assert.match(result.stdout, /Pipeline scope\s+project-scoped ECC \+ user-scoped\/global gstack at\s+~\/\.claude\/skills\/gstack/);
} finally {
  await fs.rm(setupBothDryRunTarget, { recursive: true, force: true });
}

for (const setupPipeline of ["none", "gstack"]) {
  const setupRulesDryRunTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-rules-dry-run-"));
  try {
    result = runCli(["setup", "--target", setupRulesDryRunTarget, "--setup-pipeline", setupPipeline, "--with-rules", "--yes", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Selected ECC rules/);
    assert.match(result.stdout, /Applied ECC rules/);
  } finally {
    await fs.rm(setupRulesDryRunTarget, { recursive: true, force: true });
  }
}

}
