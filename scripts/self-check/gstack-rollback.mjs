import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bootstrapGstack, GSTACK_REVIEW_SIDECARS, gstackCheckoutPath, gstackStatePath, setupGstack, validateProjectGstack } from "../lib/gstack.mjs";

export async function runGstackRollbackChecks() {
  const hookSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-hook-symlink-"));
  const hookSymlinkOutside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-hook-symlink-outside-"));
  try {
    const checkout = gstackCheckoutPath(hookSymlinkTarget);
    const outsideHooks = path.join(hookSymlinkOutside, "hooks");
    await fs.mkdir(outsideHooks, { recursive: true });
    await fs.mkdir(checkout, { recursive: true });
    await fs.writeFile(path.join(checkout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
    await fs.writeFile(path.join(checkout, "SKILL.md"), "Project-local gstack", "utf8");
    await fs.mkdir(path.join(checkout, "review"), { recursive: true });
    await fs.writeFile(path.join(checkout, "review", "SKILL.md"), "Review", "utf8");
    for (const sidecar of GSTACK_REVIEW_SIDECARS) {
      await fs.mkdir(path.dirname(path.join(checkout, sidecar)), { recursive: true });
      await fs.writeFile(path.join(checkout, sidecar), `Fixture ${sidecar}`, "utf8");
    }
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

  const ancillaryTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-ancillary-"));
  try {
    const checkout = gstackCheckoutPath(ancillaryTarget);
    await fs.mkdir(path.join(checkout, "ship", "sections"), { recursive: true });
    await fs.mkdir(path.join(checkout, "plan-eng-review", "sections"), { recursive: true });
    await fs.mkdir(path.join(checkout, "open-gstack-browser"), { recursive: true });
    await fs.writeFile(path.join(checkout, "ship", "SKILL.md"), "Ship ~/.claude/skills/gstack/ship/sections/tests.md", "utf8");
    await fs.writeFile(path.join(checkout, "ship", "sections", "tests.md"), "Ship section $HOME/.gstack", "utf8");
    await fs.writeFile(path.join(checkout, "plan-eng-review", "SKILL.md"), "Review", "utf8");
    await fs.writeFile(path.join(checkout, "plan-eng-review", "sections", "review-sections.md"), "Review section", "utf8");
    await fs.writeFile(path.join(checkout, "open-gstack-browser", "SKILL.md"), "Browser", "utf8");
    await fs.writeFile(path.join(checkout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
    await fs.symlink("open-gstack-browser", path.join(checkout, "connect-chrome"), "dir");
    spawnSync("git", ["init"], { cwd: checkout, stdio: "ignore" });
    for (const sidecar of GSTACK_REVIEW_SIDECARS) {
      await fs.mkdir(path.dirname(path.join(checkout, sidecar)), { recursive: true });
      await fs.writeFile(path.join(checkout, sidecar), `Fixture ${sidecar}`, "utf8");
    }

    await bootstrapGstack({ target: ancillaryTarget });
    const shipSection = path.join(ancillaryTarget, ".claude", "skills", "ship", "sections", "tests.md");
    assert.equal(await fs.readFile(shipSection, "utf8"), `Ship section ${gstackStatePath(ancillaryTarget)}`);
    assert.equal(await fs.readFile(path.join(ancillaryTarget, ".claude", "skills", "plan-eng-review", "sections", "review-sections.md"), "utf8"), "Review section");
    const aliasWrapper = path.join(ancillaryTarget, ".claude", "skills", "connect-chrome", "SKILL.md");
    assert.equal(await fs.readFile(aliasWrapper, "utf8").then(() => true, () => false), true);
    assert.equal((await fs.lstat(path.dirname(aliasWrapper))).isSymbolicLink(), false);
    let validation = await validateProjectGstack(ancillaryTarget);
    assert.deepEqual(validation.assets, ["plan-eng-review/sections/review-sections.md", "ship/sections/tests.md"]);
    assert.equal(validation.assetsValid, true);
    await fs.writeFile(shipSection, "drifted", "utf8");
    validation = await validateProjectGstack(ancillaryTarget);
    assert.equal(validation.assetsValid, false);
  } finally {
    await fs.rm(ancillaryTarget, { recursive: true, force: true });
  }

  const escapingAliasTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-escaping-alias-"));
  const escapingAliasOutside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-escaping-alias-outside-"));
  try {
    const checkout = gstackCheckoutPath(escapingAliasTarget);
    await fs.mkdir(checkout, { recursive: true });
    await fs.mkdir(path.join(escapingAliasOutside, "outside-skill"), { recursive: true });
    await fs.writeFile(path.join(escapingAliasOutside, "outside-skill", "SKILL.md"), "Outside", "utf8");
    await fs.symlink(path.join(escapingAliasOutside, "outside-skill"), path.join(checkout, "escaping-alias"), "dir");
    for (const sidecar of GSTACK_REVIEW_SIDECARS) {
      await fs.mkdir(path.dirname(path.join(checkout, sidecar)), { recursive: true });
      await fs.writeFile(path.join(checkout, sidecar), `Fixture ${sidecar}`, "utf8");
    }
    await assert.rejects(() => bootstrapGstack({ target: escapingAliasTarget }), /symlink.*escapes|escapes.*symlink/i);
    assert.equal(await fs.access(path.join(escapingAliasTarget, ".claude", "skills", "escaping-alias", "SKILL.md")).then(() => true, () => false), false);
  } finally {
    await fs.rm(escapingAliasTarget, { recursive: true, force: true });
    await fs.rm(escapingAliasOutside, { recursive: true, force: true });
  }

  const cyclicAliasTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-cyclic-alias-"));
  try {
    const checkout = gstackCheckoutPath(cyclicAliasTarget);
    await fs.mkdir(checkout, { recursive: true });
    await fs.symlink("second-alias", path.join(checkout, "first-alias"), "dir");
    await fs.symlink("first-alias", path.join(checkout, "second-alias"), "dir");
    for (const sidecar of GSTACK_REVIEW_SIDECARS) {
      await fs.mkdir(path.dirname(path.join(checkout, sidecar)), { recursive: true });
      await fs.writeFile(path.join(checkout, sidecar), `Fixture ${sidecar}`, "utf8");
    }
    await assert.rejects(() => bootstrapGstack({ target: cyclicAliasTarget }), /symlink|cycle/i);
  } finally {
    await fs.rm(cyclicAliasTarget, { recursive: true, force: true });
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
    const wrapper = path.join(rollbackTarget, ".claude", "skills", "_gstack-command");
    const review = path.join(rollbackTarget, ".claude", "skills", "review");
    const stateFile = path.join(gstackStatePath(rollbackTarget), "state.json");
    await fs.mkdir(path.join(checkout, "review"), { recursive: true });
    await fs.writeFile(path.join(checkout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
    await fs.writeFile(path.join(checkout, "SKILL.md"), "Project-local gstack", "utf8");
    await fs.writeFile(path.join(checkout, "review", "SKILL.md"), "Review", "utf8");
    for (const sidecar of GSTACK_REVIEW_SIDECARS) {
      await fs.mkdir(path.dirname(path.join(checkout, sidecar)), { recursive: true });
      await fs.writeFile(path.join(checkout, sidecar), `Fixture ${sidecar}`, "utf8");
    }
    spawnSync("git", ["init"], { cwd: checkout, stdio: "ignore" });
    await fs.mkdir(wrapper, { recursive: true });
    await fs.writeFile(path.join(wrapper, "SKILL.md"), "existing wrapper", "utf8");
    await fs.mkdir(review, { recursive: true });
    await fs.writeFile(path.join(review, "SKILL.md"), "existing review wrapper", "utf8");
    await fs.writeFile(path.join(review, "checklist.md"), "existing checklist", "utf8");
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile, "existing state", "utf8");
    await fs.writeFile(path.join(rollbackTarget, ".claude", "settings.json"), "{", "utf8");
    const result = await setupGstack({ target: rollbackTarget });
    assert.equal(result.status, "failed");
    assert.equal(await fs.readFile(path.join(wrapper, "SKILL.md"), "utf8"), "existing wrapper");
    assert.equal(await fs.readFile(path.join(review, "SKILL.md"), "utf8"), "existing review wrapper");
    assert.equal(await fs.readFile(path.join(review, "checklist.md"), "utf8"), "existing checklist");
    assert.equal(await fs.readFile(stateFile, "utf8"), "existing state");
    assert.equal(await fs.readFile(path.join(rollbackTarget, ".claude", "settings.json"), "utf8"), "{");
  } finally {
    await fs.rm(rollbackTarget, { recursive: true, force: true });
  }

  const rollbackFailureTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-rollback-failure-"));
  try {
    const checkout = gstackCheckoutPath(rollbackFailureTarget);
    await fs.mkdir(checkout, { recursive: true });
    await fs.writeFile(path.join(checkout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
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
  } finally {
    await fs.rm(rollbackFailureTarget, { recursive: true, force: true });
  }
}
