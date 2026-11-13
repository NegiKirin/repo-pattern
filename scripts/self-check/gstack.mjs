import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject, printAudit } from "../../src/audit.mjs";
import { cleanupProject } from "../../src/cleanup.mjs";
import { doctorProject } from "../../src/doctor.mjs";
import { ECC_PLUGIN, applyEccPluginSettings, setupEcc } from "../../src/ecc/ecc.mjs";
import { applyPlanTuneHooks, ensureBun, gstackCheckoutPath, gstackEnvironment, gstackStatePath, gstackSummaryRows, isValidGstackCheckout, removeEccPluginSettings, resolveGstackCheckout, setupGstack } from "../../src/gstack/gstack.mjs";
import { applyMcpValues, generateMcp, mcpSecretPrompt, persistedMcpValues, readGeneratedMcpValues, validateRelativeMcpPath } from "../../src/mcp.mjs";
import { provisionProject, setupPipelineScope } from "../../src/setup/provision.mjs";
import { applyAttributionSetting, applyLocalSettings, applyPermissionSettings, reconcileLocalPluginSettings, updateClaudePermissions } from "../../src/setup/settings.mjs";
import { writePrivateJson } from "../../src/shared/fs-utils.mjs";
import { printSummary, renderLogo, style } from "../../src/ui/prompt.mjs";
import { setupProject, setupRetryOptions } from "../../src/setup/setup.mjs";
import { needsLocalSettingsPrompt } from "../../src/ui/setup-interaction.mjs";
import { applyEccRules, buildAgentManifest, clearEccRules, formatEccCloneError, hasGitUpstream, validateAgentManifest } from "../../src/ecc/rules.mjs";
import { applyOptionalSkills, applyPluginSkillSettings, expectedOptionalSkillDirs, invalidOptionalSkills, normalizeOptionalSkills, OPTIONAL_SKILLS } from "../../src/skills.mjs";
import { runGstackRollbackChecks } from "./gstack-rollback.mjs";
import { commitGstackFixture, installGstackSafetyFixture, installGstackUpstreamSetupFixture } from "./fixtures.mjs";
const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const cliPath = path.join(repoRoot, "bin", "repo-pattern.mjs");
const secretSentinel = "do-not-persist-anthropic-token";

const originalLog = console.log;

export async function runGstackChecks() {
const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
const gitignore = await fs.readFile(path.join(repoRoot, ".gitignore"), "utf8");
const gitignoreLines = gitignore.split(/\r?\n/);
assert(!packageJson.files.includes(".repo-pattern.lock.json"));
assert(!packageJson.files.includes(".repo-pattern.json"));
assert(packageJson.files.includes(".repo-pattern.example.json"));
assert(packageJson.files.includes(".claude.example/CLAUDE.md"));
assert(packageJson.files.includes(".claude.example/settings.example.json"));
assert(packageJson.files.includes(".claude.example/settings.local.example.json"));
assert(!packageJson.files.some((file) => file.startsWith(".claude/")));
assert(gitignoreLines.includes(".repo-pattern/"));
assert(!gitignoreLines.includes(".repo-pattern.json"));
assert(!gitignoreLines.includes(".repo-pattern.lock.json"));
assert(gitignoreLines.includes(".claude/"));

assert.deepEqual(gstackEnvironment("bun", { PATH: "/usr/bin" }), { PATH: "/usr/bin" });
assert.equal(gstackCheckoutPath("/tmp/project"), "/tmp/project/.claude/skills/gstack");
assert.deepEqual(gstackEnvironment("/usr/local/bin/bun", { PATH: "/usr/bin" }), { PATH: `/usr/local/bin${path.delimiter}/usr/bin` });
assert.deepEqual(gstackSummaryRows("/tmp/project"), [
  ["Scope", "project-local .claude/skills/gstack"],
  ["Plan-tune hooks", "not installed"],
  ["Status", "ready"]
]);
assert.deepEqual(gstackSummaryRows("/tmp/project", true), [
  ["Scope", "project-local .claude/skills/gstack"],
  ["Plan-tune hooks", "installed in .claude/settings.json"],
  ["Status", "ready"]
]);
assert.equal(gstackStatePath("/tmp/project"), "/tmp/project/.repo-pattern/gstack");
assert.equal(ensureBun({ run: () => "1.4.2\n" }), "bun");
assert.throws(() => ensureBun({ run: () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } }), /Install Bun manually/);
assert.throws(() => ensureBun({ run: () => "0.9.9\n" }), /Bun validation failed/);

const planTuneSettings = applyPlanTuneHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: "existing" }] }] } }, {
  checkout: "/tmp/project/.claude/skills/gstack",
  statePath: "/tmp/project/.repo-pattern/gstack",
  enabled: true
});
assert.equal(planTuneSettings.hooks.Stop[0].hooks[0].command, "existing");
assert.equal(planTuneSettings.hooks.PreToolUse[0]._gstack_source, "repo-pattern-plan-tune");
assert.match(planTuneSettings.hooks.PreToolUse[0].hooks[0].command, /GSTACK_HOME='\/tmp\/project\/\.repo-pattern\/gstack'/);
assert.match(planTuneSettings.hooks.PreToolUse[0].hooks[0].command, /\.claude\/skills\/gstack/);
assert.doesNotMatch(JSON.stringify(planTuneSettings), /~\/\.claude\/skills\/gstack|\$HOME/);
const quotedHook = applyPlanTuneHooks({}, {
  checkout: "/tmp/$(touch injected)/.claude/skills/gstack",
  statePath: "/tmp/$(touch injected)/.repo-pattern/gstack",
  enabled: true
});
assert.match(quotedHook.hooks.PreToolUse[0].hooks[0].command, /'\/tmp\/\$\(touch injected\)/);
assert.deepEqual(applyPlanTuneHooks(planTuneSettings, {
  checkout: "/tmp/project/.claude/skills/gstack",
  statePath: "/tmp/project/.repo-pattern/gstack",
  enabled: false
}).hooks, { Stop: [{ hooks: [{ type: "command", command: "existing" }] }] });

const checkoutFixture = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-checkout-"));
try {
  await fs.writeFile(path.join(checkoutFixture, "setup"), "#!/bin/sh\n", { mode: 0o755 });
  spawnSync("git", ["init"], { cwd: checkoutFixture, stdio: "ignore" });
  assert.equal(await isValidGstackCheckout(checkoutFixture), true);
  await fs.chmod(path.join(checkoutFixture, "setup"), 0o644);
  assert.equal(await isValidGstackCheckout(checkoutFixture), false);
  const bareCheckout = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-bare-"));
  try {
    await fs.writeFile(path.join(bareCheckout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
    spawnSync("git", ["init", "--bare"], { cwd: bareCheckout, stdio: "ignore" });
    assert.equal(await isValidGstackCheckout(bareCheckout), false);
  } finally {
    await fs.rm(bareCheckout, { recursive: true, force: true });
  }
  const parentCheckout = path.join(checkoutFixture, "nested-checkout");
  await fs.mkdir(parentCheckout);
  await fs.writeFile(path.join(parentCheckout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
  assert.equal(await isValidGstackCheckout(parentCheckout), false);
} finally {
  await fs.rm(checkoutFixture, { recursive: true, force: true });
}

const resolverTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-resolver-"));
const globalCheckout = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-global-"));
try {
  const localCheckout = gstackCheckoutPath(resolverTarget);
  const createCheckout = async (checkout, source = "fixture") => {
    await fs.mkdir(checkout, { recursive: true });
    await fs.writeFile(path.join(checkout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
    await fs.writeFile(path.join(checkout, "source"), source, "utf8");
    spawnSync("git", ["init"], { cwd: checkout, stdio: "ignore" });
  };
  const progressEvents = [];
  const progress = { beginOperation(spec) {
    progressEvents.push({ type: "begin", ...spec });
    return {
      update: (values) => progressEvents.push({ type: "update", id: spec.id, ...values }),
      complete: (values) => progressEvents.push({ type: "complete", id: spec.id, ...values }),
      fail: (values) => progressEvents.push({ type: "fail", id: spec.id, ...values })
    };
  } };
  await createCheckout(localCheckout, "local");
  const reused = await resolveGstackCheckout({
    target: resolverTarget,
    globalCheckout,
    clone: () => { throw new Error("clone should not run"); },
    progress
  });
  assert.equal(reused.source, "local");
  assert.equal(await fs.readFile(path.join(localCheckout, "source"), "utf8"), "local");
  assert.deepEqual(progressEvents, [
    { type: "begin", id: "gstack-checkout", label: "Using gstack checkout", totalUnits: 1, weight: 2 },
    { type: "complete", id: "gstack-checkout", detail: "local checkout ready" }
  ]);

  progressEvents.length = 0;
  await fs.rm(localCheckout, { recursive: true, force: true });
  await createCheckout(globalCheckout, "global");
  const migrated = await resolveGstackCheckout({
    target: resolverTarget,
    globalCheckout,
    clone: () => { throw new Error("clone should not run"); },
    progress
  });
  assert.equal(migrated.source, "global");
  assert.equal(await fs.readFile(path.join(localCheckout, "source"), "utf8"), "global");
  assert.equal(await fs.readFile(path.join(globalCheckout, "source"), "utf8"), "global");
  assert.equal(progressEvents[0].label, "Copying gstack checkout");
  assert.deepEqual(progressEvents.at(-1), { type: "complete", id: "gstack-checkout", detail: "completed" });

  progressEvents.length = 0;
  await fs.rm(localCheckout, { recursive: true, force: true });
  await fs.rm(globalCheckout, { recursive: true, force: true });
  const cloned = await resolveGstackCheckout({
    target: resolverTarget,
    globalCheckout,
    clone: async (destination) => createCheckout(destination, "clone"),
    progress
  });
  assert.equal(cloned.source, "clone");
  assert.equal(await fs.readFile(path.join(localCheckout, "source"), "utf8"), "clone");
  assert.deepEqual(progressEvents, [
    { type: "begin", id: "gstack-checkout", label: "Downloading gstack", totalUnits: 100, weight: 3 },
    { type: "complete", id: "gstack-checkout", detail: "completed" }
  ]);

  progressEvents.length = 0;
  await fs.rm(localCheckout, { recursive: true, force: true });
  const cloneFailure = Object.assign(new Error("clone failed"), { stderr: "fatal: complete clone stderr\nwith every line\n", status: 128 });
  await assert.rejects(() => resolveGstackCheckout({
    target: resolverTarget,
    globalCheckout,
    clone: () => { throw cloneFailure; },
    progress
  }), (error) => error.gstackCloneFailure && error.stderr === cloneFailure.stderr);
  assert.deepEqual(progressEvents, [
    { type: "begin", id: "gstack-checkout", label: "Downloading gstack", totalUnits: 100, weight: 3 },
    { type: "fail", id: "gstack-checkout", detail: "failed" }
  ]);
  assert.equal(await fs.access(localCheckout).then(() => true, () => false), false);

  const originalStderrWrite = process.stderr.write;
  const cloneFailureOutput = [];
  process.stderr.write = (output) => { cloneFailureOutput.push(output); return true; };
  try {
    const failed = await setupGstack({ target: resolverTarget, resolveCheckout: async () => { throw Object.assign(new Error("clone failed"), { gstackCloneFailure: true, stderr: cloneFailure.stderr }); } });
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /gstack output: \[redacted\]/);
  } finally { process.stderr.write = originalStderrWrite; }
  assert.deepEqual(cloneFailureOutput, []);

  await fs.rm(localCheckout, { recursive: true, force: true });
  await assert.rejects(
    () => resolveGstackCheckout({
      target: resolverTarget,
      globalCheckout,
      clone: async (destination) => fs.mkdir(destination, { recursive: true })
    }),
    /invalid/
  );
  assert.equal(await fs.access(localCheckout).then(() => true, () => false), false);
} finally {
  await fs.rm(resolverTarget, { recursive: true, force: true });
  await fs.rm(globalCheckout, { recursive: true, force: true });
}

const migrationTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-migration-"));
const migrationHome = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-migration-home-"));
try {
  const globalMigrationCheckout = path.join(migrationHome, ".claude", "skills", "gstack");
  await fs.mkdir(path.join(globalMigrationCheckout, "review"), { recursive: true });
  await installGstackUpstreamSetupFixture(globalMigrationCheckout);
  await installGstackSafetyFixture(globalMigrationCheckout);
  await fs.mkdir(path.join(globalMigrationCheckout, "bin"), { recursive: true });
  spawnSync("git", ["init"], { cwd: globalMigrationCheckout, stdio: "ignore" });
  await fs.writeFile(path.join(globalMigrationCheckout, "SKILL.md"), "Project-local gstack", "utf8");
  await fs.writeFile(path.join(globalMigrationCheckout, "review", "SKILL.md"), "Review", "utf8");
  commitGstackFixture(globalMigrationCheckout);
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  process.env.HOME = migrationHome;
  process.env.PATH = `${path.join(globalMigrationCheckout, "bin")}${path.delimiter}${originalPath || ""}`;
  try {
    const result = await setupGstack({ target: migrationTarget });
    assert.equal(result.status, "installed", result.error);
    assert.equal(result.source, "global", result.error);
    await (await import("./gstack-doctor.mjs")).runGstackDoctorChecks(migrationTarget, repoRoot);
    await import("./gstack-setup-status.mjs").then(({ runGstackSetupStatusChecks }) => runGstackSetupStatusChecks(migrationTarget));
  } finally {
    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
  }
  assert.equal(await fs.readFile(path.join(globalMigrationCheckout, "SKILL.md"), "utf8"), "Project-local gstack");
  assert.equal(await fs.access(path.join(migrationHome, ".claude", "settings.json")).then(() => true, () => false), false);
} finally {
  await fs.rm(migrationTarget, { recursive: true, force: true });
  await fs.rm(migrationHome, { recursive: true, force: true });
}

const symlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-symlink-"));
const symlinkDestination = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-symlink-destination-"));
try {
  await fs.mkdir(path.join(symlinkTarget, ".claude"));
  await fs.symlink(symlinkDestination, path.join(symlinkTarget, ".claude", "skills"), "dir");
  await assert.rejects(
    () => resolveGstackCheckout({
      target: symlinkTarget,
      globalCheckout: path.join(symlinkTarget, "missing-global"),
      clone: () => { throw new Error("clone should not run"); }
    }),
    /symlink/
  );
} finally {
  await fs.rm(symlinkTarget, { recursive: true, force: true });
  await fs.rm(symlinkDestination, { recursive: true, force: true });
}

const missingBunTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-missing-bun-"));
try {
  const originalPath = process.env.PATH;
  process.env.PATH = "";
  const result = await setupGstack({ target: missingBunTarget });
  assert.equal(result.status, "failed");
  assert.equal(await fs.access(gstackCheckoutPath(missingBunTarget)).then(() => true, () => false), false);
  process.env.PATH = originalPath;
} finally {
  await fs.rm(missingBunTarget, { recursive: true, force: true });
}


await runGstackRollbackChecks();
}
