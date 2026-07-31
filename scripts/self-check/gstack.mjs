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
import { applyPlanTuneHooks, bootstrapGstack, ensureBun, GSTACK_REVIEW_SIDECARS, gstackCheckoutPath, gstackEnvironment, gstackStatePath, gstackSummaryRows, isValidGstackCheckout, removeEccPluginSettings, resolveGstackCheckout, setupGstack, validateProjectGstack } from "../lib/gstack.mjs";
import { applyMcpValues, generateMcp, mcpSecretPrompt, persistedMcpValues, readGeneratedMcpValues, validateRelativeMcpPath } from "../lib/mcp.mjs";
import { applyAttributionSetting, applyLocalSettings, applyPermissionSettings, provisionProject, reconcileLocalPluginSettings, setupPipelineScope, updateClaudePermissions } from "../lib/provision.mjs";
import { writePrivateJson } from "../lib/fs-utils.mjs";
import { printSummary, renderLogo, style } from "../lib/prompt.mjs";
import { needsLocalSettingsPrompt, setupProject, setupRetryOptions } from "../lib/setup.mjs";
import { applyEccRules, buildAgentManifest, clearEccRules, formatEccCloneError, hasGitUpstream, validateAgentManifest } from "../lib/rules.mjs";
import { applyOptionalSkills, applyPluginSkillSettings, expectedOptionalSkillDirs, invalidOptionalSkills, normalizeOptionalSkills, OPTIONAL_SKILLS } from "../lib/skills.mjs";
import { runGstackRollbackChecks } from "./gstack-rollback.mjs";
const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const cliPath = path.join(cliDir, "..", "repo-pattern.mjs");
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
assert.equal(ensureBun({ run: () => "1.2.0\n" }), "bun");
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
  assert.equal(migrated.source, "global-migration");
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
  assert.deepEqual(cloneFailureOutput, [cloneFailure.stderr]);

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
  await fs.writeFile(path.join(globalMigrationCheckout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
  await fs.writeFile(path.join(globalMigrationCheckout, "SKILL.md"), "Project-local gstack", "utf8");
  await fs.writeFile(path.join(globalMigrationCheckout, "review", "SKILL.md"), "Review", "utf8");
  for (const sidecar of GSTACK_REVIEW_SIDECARS) {
    await fs.mkdir(path.dirname(path.join(globalMigrationCheckout, sidecar)), { recursive: true });
    await fs.writeFile(path.join(globalMigrationCheckout, sidecar), `Fixture ${sidecar}`, "utf8");
  }
  spawnSync("git", ["init"], { cwd: globalMigrationCheckout, stdio: "ignore" });
  const originalHome = process.env.HOME;
  process.env.HOME = migrationHome;
  try {
    const result = await setupGstack({ target: migrationTarget });
    assert.equal(result.status, "installed");
    assert.equal(result.source, "global-migration");
  } finally {
    process.env.HOME = originalHome;
  }
  assert.equal(await fs.readFile(path.join(globalMigrationCheckout, "SKILL.md"), "utf8"), "Project-local gstack");
  assert.equal(await fs.access(path.join(migrationHome, ".claude", "settings.json")).then(() => true, () => false), false);
  assert.equal(await fs.access(path.join(migrationHome, ".gstack")).then(() => true, () => false), false);
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

const wrapperTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-wrapper-"));
try {
  const checkout = gstackCheckoutPath(wrapperTarget);
  await fs.mkdir(path.join(checkout, "review"), { recursive: true });
  await fs.writeFile(path.join(checkout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
  await fs.writeFile(path.join(checkout, "SKILL.md"), "Root ~/.claude/skills/gstack $HOME/.gstack gstack-config", "utf8");
  await fs.writeFile(path.join(checkout, "review", "SKILL.md"), "Review ~/.claude/skills/gstack $HOME/.claude.json $HOME/.claude/plans ~/.codex/plans ${HOME}/.gstack/projects", "utf8");
  for (const sidecar of GSTACK_REVIEW_SIDECARS) {
    await fs.mkdir(path.dirname(path.join(checkout, sidecar)), { recursive: true });
    await fs.writeFile(path.join(checkout, sidecar), `Fixture ${sidecar}`, "utf8");
  }
  await fs.mkdir(path.join(checkout, "hosts", "claude", "hooks"), { recursive: true });
  for (const hook of ["question-log-hook", "question-preference-hook"]) {
    await fs.writeFile(path.join(checkout, "hosts", "claude", "hooks", hook), "#!/bin/sh\n", { mode: 0o755 });
  }
  await fs.mkdir(path.join(checkout, "setup-gbrain"), { recursive: true });
  await fs.writeFile(path.join(checkout, "setup-gbrain", "SKILL.md"), "GBRAIN_BIN=\"$HOME/.bun/bin/gbrain\"", "utf8");
  await fs.mkdir(path.join(checkout, "codex"), { recursive: true });
  await fs.writeFile(path.join(checkout, "codex", "SKILL.md"), "Unsupported host integration", "utf8");
  await fs.mkdir(path.join(checkout, ".cursor", "skills", "gstack"), { recursive: true });
  await fs.writeFile(path.join(checkout, ".cursor", "skills", "gstack", "SKILL.md"), "Hidden integration", "utf8");
  spawnSync("git", ["init"], { cwd: checkout, stdio: "ignore" });
  const originalPath = process.env.PATH;
  process.env.PATH = `${path.dirname(process.execPath)}:${originalPath}`;
  const result = await setupGstack({ target: wrapperTarget, planTuneHooks: true });
  process.env.PATH = originalPath;
  assert.equal(result.status, "installed");
  const state = await validateProjectGstack(wrapperTarget);
  assert.equal(state.checkoutValid, true);
  assert.equal(state.stateValid, true);
  assert.equal(state.wrappersValid, true);
  assert.deepEqual(state.sidecars, GSTACK_REVIEW_SIDECARS);
  assert.equal(state.sidecarsValid, true);
  for (const sidecar of GSTACK_REVIEW_SIDECARS) {
    assert.equal(await fs.readFile(path.join(wrapperTarget, ".claude", "skills", sidecar), "utf8"), `Fixture ${sidecar}`);
  }
  const outsideState = path.join(wrapperTarget, "outside-state.json");
  const stateFile = path.join(gstackStatePath(wrapperTarget), "state.json");
  await fs.writeFile(outsideState, "outside", "utf8");
  await fs.rm(stateFile);
  await fs.symlink(outsideState, stateFile);
  await assert.rejects(() => bootstrapGstack({ target: wrapperTarget }), /symlink/);
  const symlinkedState = await validateProjectGstack(wrapperTarget);
  assert.equal(symlinkedState.stateValid, false);
  assert.equal(symlinkedState.wrappersValid, false);
  assert.equal(symlinkedState.sidecarsValid, false);
  assert.equal(await fs.readFile(outsideState, "utf8"), "outside");
  await fs.rm(stateFile);
  await fs.writeFile(stateFile, "null", "utf8");
  const malformedState = await validateProjectGstack(wrapperTarget);
  assert.equal(malformedState.stateValid, false);
  assert.equal(malformedState.wrappersValid, false);
  assert.equal(malformedState.sidecarsValid, false);
  await fs.rm(stateFile);
  await fs.writeFile(stateFile, JSON.stringify({
    checkout: "wrong-checkout",
    wrappers: state.wrappers,
    bootstrappedAt: new Date().toISOString()
  }), "utf8");
  const mismatchedCheckoutState = await validateProjectGstack(wrapperTarget);
  assert.equal(mismatchedCheckoutState.stateValid, false);
  assert.equal(mismatchedCheckoutState.wrappersValid, false);
  assert.equal(mismatchedCheckoutState.sidecarsValid, false);
  await fs.writeFile(stateFile, JSON.stringify({
    checkout: path.relative(wrapperTarget, checkout),
    wrappers: state.wrappers,
    sidecars: state.sidecars,
    bootstrappedAt: new Date().toISOString()
  }), "utf8");
  const checklist = path.join(wrapperTarget, ".claude", "skills", "review", "checklist.md");
  const expectedChecklist = await fs.readFile(checklist, "utf8");
  await fs.writeFile(checklist, "drifted", "utf8");
  assert.equal((await validateProjectGstack(wrapperTarget)).sidecarsValid, false);
  await fs.writeFile(checklist, expectedChecklist, "utf8");
  assert(!state.wrappers.some((wrapper) => wrapper.includes(".cursor") || wrapper.includes("codex")));
  assert.equal(await fs.access(path.join(wrapperTarget, ".claude", "skills", ".cursor")).then(() => true, () => false), false);
  assert.equal(await fs.access(path.join(wrapperTarget, ".claude", "skills", "codex")).then(() => true, () => false), false);
  const rootWrapper = path.join(wrapperTarget, ".claude", "skills", "_gstack-command", "SKILL.md");
  const expectedRootWrapper = await fs.readFile(rootWrapper, "utf8");
  await fs.writeFile(rootWrapper, "drifted", "utf8");
  assert.equal((await validateProjectGstack(wrapperTarget)).wrappersValid, false);
  await fs.writeFile(rootWrapper, expectedRootWrapper, "utf8");
  await fs.writeFile(path.join(checkout, "review", "SKILL.md"), `${os.homedir()}/.gstack`, "utf8");
  await assert.rejects(() => bootstrapGstack({ target: wrapperTarget }), /forbidden home-scoped state/);
  await fs.writeFile(path.join(checkout, "review", "SKILL.md"), "Review ~/.claude/skills/gstack", "utf8");
  await fs.mkdir(path.join(checkout, "added"));
  await fs.writeFile(path.join(checkout, "added", "SKILL.md"), "Added skill", "utf8");
  assert.equal((await validateProjectGstack(wrapperTarget)).wrappersValid, false);
  const wrapper = await fs.readFile(path.join(wrapperTarget, ".claude", "skills", "_gstack-command", "SKILL.md"), "utf8");
  const reviewWrapper = await fs.readFile(path.join(wrapperTarget, ".claude", "skills", "review", "SKILL.md"), "utf8");
  for (const wrapperPath of state.wrappers) {
    const generatedWrapper = await fs.readFile(path.join(wrapperTarget, wrapperPath, "SKILL.md"), "utf8");
    assert.doesNotMatch(generatedWrapper, /<!-- Generated by repo-pattern\. Project-local gstack runtime: do not edit\. -->/);
    assert.doesNotMatch(generatedWrapper, /<!-- GSTACK_HOME=.* GSTACK_ROOT=.* -->/);
  }
  const gbrainWrapper = await fs.readFile(path.join(wrapperTarget, ".claude", "skills", "setup-gbrain", "SKILL.md"), "utf8");
  assert.match(wrapper, new RegExp(gstackStatePath(wrapperTarget).replaceAll("/", "\\/")));
  assert.match(reviewWrapper, new RegExp(gstackStatePath(wrapperTarget).replaceAll("/", "\\/")));
  assert.match(gbrainWrapper, new RegExp(path.join(gstackStatePath(wrapperTarget), "bun").replaceAll("/", "\\/")));
  assert.doesNotMatch(wrapper, /~\/\.claude\/skills\/gstack|\$HOME/);
  assert.doesNotMatch(reviewWrapper, /~\/\.codex|\$HOME\/\.claude/);
  assert.doesNotMatch(gbrainWrapper, /\$HOME\/\.bun/);
} finally {
  await fs.rm(wrapperTarget, { recursive: true, force: true });
}

const nestedWrapperTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-nested-wrapper-"));
const nestedWrapperOutside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-nested-wrapper-outside-"));
try {
  const checkout = gstackCheckoutPath(nestedWrapperTarget);
  await fs.mkdir(path.join(checkout, "review"), { recursive: true });
  await fs.writeFile(path.join(checkout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
  await fs.writeFile(path.join(checkout, "review", "SKILL.md"), "Review", "utf8");
  for (const sidecar of GSTACK_REVIEW_SIDECARS) {
    await fs.mkdir(path.dirname(path.join(checkout, sidecar)), { recursive: true });
    await fs.writeFile(path.join(checkout, sidecar), `Fixture ${sidecar}`, "utf8");
  }
  spawnSync("git", ["init"], { cwd: checkout, stdio: "ignore" });
  await fs.symlink(nestedWrapperOutside, path.join(nestedWrapperTarget, ".claude", "skills", "review"), "dir");
  await assert.rejects(() => bootstrapGstack({ target: nestedWrapperTarget }), /symlink/);
  assert.equal(await fs.readdir(nestedWrapperOutside).then((entries) => entries.length), 0);
  assert.equal((await validateProjectGstack(nestedWrapperTarget)).wrappersValid, false);
} finally {
  await fs.rm(nestedWrapperTarget, { recursive: true, force: true });
  await fs.rm(nestedWrapperOutside, { recursive: true, force: true });
}

await runGstackRollbackChecks();
}
