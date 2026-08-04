import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject } from "../lib/audit.mjs";
import { doctorProject } from "../lib/doctor.mjs";
import { GSTACK_REVIEW_SIDECARS, removeEccPluginSettings, setupGstack } from "../lib/gstack.mjs";
import { provisionProject, updateClaudePermissions } from "../lib/provision.mjs";
import { setupProject } from "../lib/setup.mjs";
import { writeEccGitFixture } from "./fixtures.mjs";
import { runInteractiveProvisionChecks } from "./interactive-provision.mjs";

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
  await fs.mkdir(path.join(provisionRollbackTarget, ".claude", "skills", "document-specialist-skill"), { recursive: true });
  await fs.writeFile(path.join(provisionRollbackTarget, ".claude", "skills", "document-specialist-skill", "SKILL.md"), "old skill", "utf8");
  await fs.mkdir(path.join(provisionRollbackTarget, ".repo-pattern", "cache", "skills", "document-specialist"), { recursive: true });
  await fs.writeFile(path.join(provisionRollbackTarget, ".repo-pattern", "cache", "skills", "document-specialist", "cached.txt"), "old cache", "utf8");
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
      profile: "research",
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
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".claude", "skills", "document-specialist-skill", "SKILL.md"), "utf8"), "old skill");
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".repo-pattern", "cache", "skills", "document-specialist", "cached.txt"), "utf8"), "old cache");
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"), provisionConfig);
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"), provisionLock);
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".repo-pattern", ".gitignore"), "utf8"), provisionGitignore);
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".claude", "CLAUDE.md"), "utf8"), provisionClaudeMd);
  assert.equal(await fs.readFile(path.join(provisionRollbackTarget, ".mcp.json"), "utf8"), provisionMcp);
} finally {
  console.log = originalDoctorLog;
  await fs.rm(provisionRollbackTarget, { recursive: true, force: true });
}


const optionalSkillRollbackTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-optional-skill-rollback-"));
console.log = () => {};
try {
  const skillRoot = path.join(optionalSkillRollbackTarget, ".claude", "skills", "document-specialist-skill");
  const cacheRoot = path.join(optionalSkillRollbackTarget, ".repo-pattern", "cache", "skills", "document-specialist");
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), "existing optional skill", "utf8");
  await fs.mkdir(cacheRoot, { recursive: true });
  spawnSync("git", ["init"], { cwd: cacheRoot, stdio: "ignore" });
  await fs.mkdir(path.join(optionalSkillRollbackTarget, ".repo-pattern"), { recursive: true });
  await fs.writeFile(path.join(optionalSkillRollbackTarget, ".repo-pattern", ".repo-pattern.json"), JSON.stringify({
    workflow: "none",
    optionalSkills: [{
      name: "document-specialist",
      source: "https://github.com/SpillwaveSolutions/document-specialist-skill.git",
      revision: "4d50d302b9f40e8eafec72d78a86676cdd9511ac",
      license: "NOASSERTION",
      installedDirs: ["document-specialist-skill"]
    }]
  }), "utf8");
  await fs.writeFile(path.join(optionalSkillRollbackTarget, ".repo-pattern", ".repo-pattern.lock.json"), "{}\n", "utf8");
  await assert.rejects(
    () => provisionProject({
      sourceRoot: repoRoot,
      target: optionalSkillRollbackTarget,
      profile: "research",
      setupPipeline: "none",
      optionalSkills: ["document-specialist"]
    }),
    /fetch|origin|remote|repository/i
  );
  assert.equal(await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8"), "existing optional skill");
  await fs.access(path.join(cacheRoot, ".git"));
} finally {
  console.log = originalLog;
  await fs.rm(optionalSkillRollbackTarget, { recursive: true, force: true });
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
  const originalPath = process.env.PATH;
  process.env.PATH = "";
  const failedGstack = await setupGstack({ target: failedGstackTarget });
  process.env.PATH = originalPath;
  assert.equal(failedGstack.status, "failed");
  assert.match(await fs.readFile(localSettingsPath, "utf8"), /ecc@ecc/);
} finally {
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
  await writeEccGitFixture(failedGstackProvisionTarget);
  const originalPath = process.env.PATH;
  const gitPath = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  process.env.PATH = path.dirname(gitPath);
  try {
    await assert.rejects(
      () => provisionProject({
        sourceRoot: repoRoot,
        target: failedGstackProvisionTarget,
        profile: "research",
        setupPipeline: "both",
        localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: "replacement-token" }
      }),
      /gstack setup failed/
    );
  } finally {
    process.env.PATH = originalPath;
  }
  const failedLock = JSON.parse(await fs.readFile(path.join(failedGstackProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  assert.equal(failedLock.ecc.status, "manual-plugin-install-required");
  assert.equal(failedLock.gstack.status, "failed");
  assert.equal(failedLock.gstack.installMode, "project-local");
  const localSettings = await fs.readFile(localSettingsPath, "utf8");
  assert.match(localSettings, /ecc@ecc/);
  assert.match(localSettings, /replacement-token/);
  await fs.access(path.join(failedGstackProvisionTarget, ".claude", "rules", "ecc", "common"));
  assert.equal((await auditProject(failedGstackProvisionTarget)).state, "PARTIAL");
  await assert.rejects(() => doctorProject(failedGstackProvisionTarget), /Doctor failed/);
} finally {
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
  await assert.rejects(() => removeEccPluginSettings({ target: trackedGstackSettingsTarget }), /settings\.local\.json is tracked/);
  assert.match(await fs.readFile(localSettingsPath, "utf8"), /ecc@ecc/);
} finally {
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

const graphifySnapshotTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-graphify-snapshot-"));
const graphifySnapshotOutside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-graphify-snapshot-outside-"));
try {
  await fs.writeFile(path.join(graphifySnapshotOutside, "preserve.txt"), "outside", "utf8");
  await fs.symlink(graphifySnapshotOutside, path.join(graphifySnapshotTarget, "graphify-out"), "dir");
  await assert.rejects(
    () => provisionProject({ sourceRoot: repoRoot, target: graphifySnapshotTarget, profile: "research", setupPipeline: "none" }),
    /graphify-out must not be a symlink/
  );
  assert.equal(await fs.readFile(path.join(graphifySnapshotOutside, "preserve.txt"), "utf8"), "outside");
  assert.deepEqual(await fs.readdir(graphifySnapshotOutside), ["preserve.txt"]);
} finally {
  await fs.rm(graphifySnapshotTarget, { recursive: true, force: true });
  await fs.rm(graphifySnapshotOutside, { recursive: true, force: true });
}

const symlinkWriteTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-symlink-write-"));
const symlinkWriteOutside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-symlink-write-outside-"));
try {
  const settingsOutside = path.join(symlinkWriteOutside, "settings.json");
  const repoConfigOutside = path.join(symlinkWriteOutside, "repo-config.json");
  await fs.mkdir(path.join(symlinkWriteTarget, ".claude"));
  await fs.writeFile(settingsOutside, "outside settings", "utf8");
  await fs.symlink(settingsOutside, path.join(symlinkWriteTarget, ".claude", "settings.json"));
  await assert.rejects(
    () => updateClaudePermissions({ sourceRoot: repoRoot, target: symlinkWriteTarget, permissionConfig: { bypass: "deny" } }),
    /settings\.json must not be a symlink/
  );
  assert.equal(await fs.readFile(settingsOutside, "utf8"), "outside settings");
  await fs.rm(path.join(symlinkWriteTarget, ".claude", "settings.json"));

  await fs.mkdir(path.join(symlinkWriteTarget, ".repo-pattern"));
  await fs.writeFile(repoConfigOutside, "{}\n", "utf8");
  await fs.symlink(repoConfigOutside, path.join(symlinkWriteTarget, ".repo-pattern", ".repo-pattern.json"));
  await assert.rejects(
    () => provisionProject({ sourceRoot: repoRoot, target: symlinkWriteTarget, profile: "research", setupPipeline: "none" }),
    /repo-pattern\.json must not be a symlink/
  );
  assert.equal(await fs.readFile(repoConfigOutside, "utf8"), "{}\n");
} finally {
  await fs.rm(symlinkWriteTarget, { recursive: true, force: true });
  await fs.rm(symlinkWriteOutside, { recursive: true, force: true });
}

const bothProvisionTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-both-provision-"));
console.log = () => {};
try {
  process.env.REPO_PATTERN_ECC_SETUP_CMD = "true";
  const gstackCheckout = path.join(bothProvisionTarget, ".claude", "skills", "gstack");
  await fs.mkdir(path.join(gstackCheckout, "hosts", "claude", "hooks"), { recursive: true });
  await fs.writeFile(path.join(gstackCheckout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
  await fs.writeFile(path.join(gstackCheckout, "SKILL.md"), "Project-local gstack", "utf8");
  await fs.mkdir(path.join(gstackCheckout, "review"), { recursive: true });
  await fs.writeFile(path.join(gstackCheckout, "review", "SKILL.md"), "Review", "utf8");
  for (const sidecar of GSTACK_REVIEW_SIDECARS) {
    await fs.mkdir(path.dirname(path.join(gstackCheckout, sidecar)), { recursive: true });
    await fs.writeFile(path.join(gstackCheckout, sidecar), `Fixture ${sidecar}`, "utf8");
  }
  for (const hook of ["question-log-hook", "question-preference-hook"]) {
    await fs.writeFile(path.join(gstackCheckout, "hosts", "claude", "hooks", hook), "#!/bin/sh\n", { mode: 0o755 });
  }
  spawnSync("git", ["init"], { cwd: gstackCheckout, stdio: "ignore" });
  await fs.mkdir(path.join(bothProvisionTarget, ".repo-pattern"), { recursive: true });
  await fs.writeFile(path.join(bothProvisionTarget, ".repo-pattern", ".repo-pattern.json"), JSON.stringify({
    workflow: "gstack",
    runtime: { localSkills: false, localCommands: false, localHooks: false, localScripts: false, localRules: false }
  }), "utf8");
  await writeEccGitFixture(bothProvisionTarget);
  await provisionProject({
    sourceRoot: repoRoot,
    target: bothProvisionTarget,
    profile: "research",
    setupPipeline: "both",
    migrate: true,
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
  for (const sidecar of GSTACK_REVIEW_SIDECARS) {
    assert.equal(await fs.readFile(path.join(bothProvisionTarget, ".claude", "skills", sidecar), "utf8"), `Fixture ${sidecar}`);
  }
  assert.equal(localSettings.enabledPlugins["ecc@ecc"], true);
  assert.equal(localSettings.extraKnownMarketplaces.ecc.source.url, "https://github.com/affaan-m/ECC.git");
  assert.equal((await auditProject(bothProvisionTarget)).state, "ECC_GSTACK_MINIMAL");
  await doctorProject(bothProvisionTarget);
} finally {
  delete process.env.REPO_PATTERN_ECC_SETUP_CMD;
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
    profile: "research",
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

await runInteractiveProvisionChecks(repoRoot);

const setupBothDryRunTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-both-dry-run-"));
try {
  result = runCli(["setup", "--target", setupBothDryRunTarget, "--setup-pipeline", "both", "--yes", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Setup pipeline\s+both/);
  assert.match(result.stdout, /Pipeline scope\s+project-scoped ECC \+ project-local gstack at \.claude\/skills\/gstack/);
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
