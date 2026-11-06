import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { commitGstackFixture, installGstackSafetyFixture, installGstackUpstreamSetupFixture } from "./fixtures.mjs";
import { gstackCheckoutPath, setupGstack } from "../lib/gstack.mjs";

export async function runGstackRollbackChecks() {
  const hookSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-hook-symlink-"));
  const hookSymlinkOutside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-hook-symlink-outside-"));
  try {
    const checkout = gstackCheckoutPath(hookSymlinkTarget);
    const outsideHooks = path.join(hookSymlinkOutside, "hooks");
    await fs.mkdir(outsideHooks, { recursive: true });
    await fs.mkdir(checkout, { recursive: true });
    await installGstackUpstreamSetupFixture(checkout, { failOnHookSymlink: true });
    await installGstackSafetyFixture(checkout);
    await fs.writeFile(path.join(checkout, "SKILL.md"), "Project-local gstack", "utf8");
    await fs.mkdir(path.join(checkout, "review"), { recursive: true });
    await fs.writeFile(path.join(checkout, "review", "SKILL.md"), "Review", "utf8");
    for (const hook of ["question-log-hook", "question-preference-hook"]) {
      await fs.writeFile(path.join(outsideHooks, hook), "#!/bin/sh\n", { mode: 0o755 });
    }
    await fs.mkdir(path.join(checkout, "hosts", "claude"), { recursive: true });
    await fs.symlink(outsideHooks, path.join(checkout, "hosts", "claude", "hooks"), "dir");
    spawnSync("git", ["init"], { cwd: checkout, stdio: "ignore" });
    const originalPath = process.env.PATH;
    process.env.PATH = `${path.dirname(process.execPath)}:${originalPath}`;
    const result = await setupGstack({ target: hookSymlinkTarget, planTuneHooks: true });
    process.env.PATH = originalPath;
    assert.equal(result.status, "failed");
    assert.equal(await fs.access(path.join(hookSymlinkTarget, ".claude", "skills", "_gstack-command", "SKILL.md")).then(() => true, () => false), false);
    assert.equal(await fs.access(path.join(hookSymlinkTarget, ".repo-pattern", "gstack", "state.json")).then(() => true, () => false), false);
  } finally {
    await fs.rm(hookSymlinkTarget, { recursive: true, force: true });
    await fs.rm(hookSymlinkOutside, { recursive: true, force: true });
  }

  const checkoutRollbackTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-checkout-rollback-"));
  const checkoutRollbackHome = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-checkout-rollback-home-"));
  const checkoutRollbackOutside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-checkout-rollback-outside-"));
  try {
    const previousCheckout = gstackCheckoutPath(checkoutRollbackTarget);
    const globalCheckout = path.join(checkoutRollbackHome, ".claude", "skills", "gstack");
    const globalHooks = path.join(globalCheckout, "hosts", "claude", "hooks");
    await fs.mkdir(previousCheckout, { recursive: true });
    await fs.writeFile(path.join(previousCheckout, "source"), "previous invalid checkout", "utf8");
    await fs.mkdir(globalCheckout, { recursive: true });
    await fs.writeFile(path.join(globalCheckout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
    await installGstackSafetyFixture(globalCheckout);
    await fs.writeFile(path.join(globalCheckout, "SKILL.md"), "Project-local gstack", "utf8");
    await fs.mkdir(path.dirname(globalHooks), { recursive: true });
    await fs.symlink(checkoutRollbackOutside, globalHooks, "dir");
    for (const hook of ["question-log-hook", "question-preference-hook"]) {
      await fs.writeFile(path.join(checkoutRollbackOutside, hook), "#!/bin/sh\n", { mode: 0o755 });
    }
    spawnSync("git", ["init"], { cwd: globalCheckout, stdio: "ignore" });
    const originalHome = process.env.HOME;
    process.env.HOME = checkoutRollbackHome;
    const result = await setupGstack({ target: checkoutRollbackTarget, planTuneHooks: true });
    process.env.HOME = originalHome;
    assert.equal(result.status, "failed");
    assert.equal(await fs.readFile(path.join(previousCheckout, "source"), "utf8"), "previous invalid checkout");
  } finally {
    await fs.rm(checkoutRollbackTarget, { recursive: true, force: true });
    await fs.rm(checkoutRollbackHome, { recursive: true, force: true });
    await fs.rm(checkoutRollbackOutside, { recursive: true, force: true });
  }

  const rollbackTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-rollback-"));
  try {
    const checkout = gstackCheckoutPath(rollbackTarget);
    const stateFile = path.join(rollbackTarget, ".repo-pattern", "gstack", "state.json");
    await fs.mkdir(checkout, { recursive: true });
    await installGstackUpstreamSetupFixture(checkout);
    await installGstackSafetyFixture(checkout);
    await fs.writeFile(path.join(checkout, "SKILL.md"), "Project-local gstack", "utf8");
    await fs.mkdir(path.join(checkout, "review"), { recursive: true });
    await fs.writeFile(path.join(checkout, "review", "SKILL.md"), "Review", "utf8");
    spawnSync("git", ["init"], { cwd: checkout, stdio: "ignore" });
    commitGstackFixture(checkout);
    await setupGstack({ target: rollbackTarget });
    const priorState = await fs.readFile(stateFile, "utf8");
    await fs.writeFile(path.join(rollbackTarget, ".claude", "settings.json"), "{", "utf8");
    const result = await setupGstack({ target: rollbackTarget });
    assert.equal(result.status, "failed");
    assert.equal(await fs.readFile(stateFile, "utf8"), priorState);
    assert.equal(await fs.readFile(path.join(rollbackTarget, ".claude", "settings.json"), "utf8"), "{");
  } finally {
    await fs.rm(rollbackTarget, { recursive: true, force: true });
  }

  const artifactRollbackTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-artifact-rollback-"));
  const artifactRollbackOutside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-artifact-rollback-outside-"));
  try {
    const checkout = gstackCheckoutPath(artifactRollbackTarget);
    await fs.mkdir(checkout, { recursive: true });
    await installGstackUpstreamSetupFixture(checkout);
    await installGstackSafetyFixture(checkout);
    await fs.writeFile(path.join(checkout, "SKILL.md"), "Project-local gstack", "utf8");
    await fs.mkdir(path.join(checkout, "review"), { recursive: true });
    await fs.writeFile(path.join(checkout, "review", "SKILL.md"), "Review", "utf8");
    spawnSync("git", ["init"], { cwd: checkout, stdio: "ignore" });
    commitGstackFixture(checkout);
    await setupGstack({ target: artifactRollbackTarget });
    const outsideSentinel = path.join(artifactRollbackOutside, "sentinel.txt");
    await fs.writeFile(outsideSentinel, "outside", "utf8");
    await installGstackUpstreamSetupFixture(checkout, { failAfterPublish: true });
    const result = await setupGstack({ target: artifactRollbackTarget, silent: true });
    assert.equal(result.status, "failed");
    assert.equal(await fs.readFile(outsideSentinel, "utf8"), "outside");
    assert.equal(result.rollbackErrors.length, 0);
    assert.equal(result.recoverySnapshot, undefined);
  } finally {
    await fs.rm(artifactRollbackTarget, { recursive: true, force: true });
    await fs.rm(artifactRollbackOutside, { recursive: true, force: true });
  }

  const rollbackFailureTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-rollback-failure-"));
  try {
    const checkout = gstackCheckoutPath(rollbackFailureTarget);
    await fs.mkdir(checkout, { recursive: true });
    await installGstackUpstreamSetupFixture(checkout, { failAfterPublish: true });
    spawnSync("git", ["init"], { cwd: checkout, stdio: "ignore" });
    const result = await setupGstack({
      target: rollbackFailureTarget,
      resolveCheckout: async () => ({
        checkout,
        source: "fixture",
        async commit() {},
        async rollback() { throw new Error("injected checkout rollback failure"); }
      }),
      silent: true
    });
    assert.equal(result.status, "failed");
    assert.deepEqual(result.rollbackErrors, ["gstack checkout rollback failed: injected checkout rollback failure"]);
    assert.equal(typeof result.recoverySnapshot, "string");
    assert.equal((await fs.stat(result.recoverySnapshot)).isDirectory(), true);
  } finally {
    await fs.rm(rollbackFailureTarget, { recursive: true, force: true });
  }
}
