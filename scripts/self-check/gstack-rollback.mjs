import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bootstrapGstack, GSTACK_REVIEW_SIDECARS, gstackCheckoutPath, gstackStatePath, setupGstack, validateProjectGstack } from "../lib/gstack.mjs";
import { installGstackSafetyFixture } from "./fixtures.mjs";

export async function runGstackRollbackChecks() {
  const hookSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-hook-symlink-"));
  const hookSymlinkOutside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-hook-symlink-outside-"));
  try {
    const checkout = gstackCheckoutPath(hookSymlinkTarget);
    const outsideHooks = path.join(hookSymlinkOutside, "hooks");
    await fs.mkdir(outsideHooks, { recursive: true });
    await fs.mkdir(checkout, { recursive: true });
    await fs.writeFile(path.join(checkout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
    await installGstackSafetyFixture(checkout);
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
    await installGstackSafetyFixture(checkout);
    await fs.writeFile(path.join(checkout, "ship", "SKILL.md"), "Ship ~/.claude/skills/gstack/ship/sections/tests.md", "utf8");
    await fs.writeFile(path.join(checkout, "ship", "sections", "tests.md"), "Ship section $HOME/.gstack", "utf8");
    await fs.writeFile(path.join(checkout, "ship", "sections", "review-army.md"), "Read ~/.claude/skills/gstack/review/checklist.md and $HOME/.claude/skills/gstack/plan-eng-review/sections/review-sections.md; dispatch ${HOME}/.claude/skills/gstack/document-release/SKILL.md and ${HOME}/.claude/skills/gstack/document-release/sections/audit-scope.md", "utf8");
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
    const shipWrapper = await fs.readFile(path.join(ancillaryTarget, ".claude", "skills", "ship", "SKILL.md"), "utf8");
    assert.equal(shipWrapper, `Ship ${path.join(ancillaryTarget, ".claude", "skills", "ship", "sections", "tests.md")}`);
    const shipSection = path.join(ancillaryTarget, ".claude", "skills", "ship", "sections", "tests.md");
    assert.equal(await fs.readFile(shipSection, "utf8"), `Ship section ${gstackStatePath(ancillaryTarget)}`);
    const reviewSection = await fs.readFile(path.join(ancillaryTarget, ".claude", "skills", "ship", "sections", "review-army.md"), "utf8");
    assert.equal(reviewSection, `Read ${path.join(checkout, "review", "checklist.md")} and ${path.join(ancillaryTarget, ".claude", "skills", "plan-eng-review", "sections", "review-sections.md")}; dispatch ${path.join(checkout, "document-release", "SKILL.md")} and ${path.join(ancillaryTarget, ".claude", "skills", "document-release", "sections", "audit-scope.md")}`);
    assert.equal(await fs.readFile(path.join(checkout, "ship", "SKILL.md"), "utf8"), "Ship ~/.claude/skills/gstack/ship/sections/tests.md");
    assert.equal(await fs.readFile(path.join(ancillaryTarget, ".claude", "skills", "plan-eng-review", "sections", "review-sections.md"), "utf8"), "Review section");
    const aliasWrapper = path.join(ancillaryTarget, ".claude", "skills", "connect-chrome", "SKILL.md");
    assert.equal(await fs.readFile(aliasWrapper, "utf8").then(() => true, () => false), true);
    assert.equal((await fs.lstat(path.dirname(aliasWrapper))).isSymbolicLink(), false);
    let validation = await validateProjectGstack(ancillaryTarget);
    assert.deepEqual(validation.assets, ["plan-eng-review/sections/review-sections.md", "ship/sections/review-army.md", "ship/sections/tests.md"]);
    assert.equal(validation.assetsValid, true);
    assert.equal(validation.runtimeValid, false, "instruction-only checkout must not report runtime ready");
    assert.equal(validation.browserStatus, "missing", "no persisted opt-out must not report browser skipped");
    await fs.writeFile(shipSection, "drifted", "utf8");
    validation = await validateProjectGstack(ancillaryTarget);
    assert.equal(validation.assetsValid, false);
  } finally {
    await fs.rm(ancillaryTarget, { recursive: true, force: true });
  }

  const templateOnlyTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-template-only-"));
  const templateOnlyOutside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-template-only-outside-"));
  try {
    const checkout = gstackCheckoutPath(templateOnlyTarget);
    const skill = path.join(checkout, "template-skill");
    await fs.mkdir(path.join(skill, "templates"), { recursive: true });
    await fs.mkdir(path.join(skill, "references"), { recursive: true });
    await fs.mkdir(path.join(templateOnlyOutside, "templates"), { recursive: true });
    await installGstackSafetyFixture(checkout);
    await fs.writeFile(path.join(checkout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
    await fs.writeFile(path.join(checkout, "SKILL.md"), "Project-local gstack", "utf8");
    await fs.writeFile(path.join(skill, "SKILL.md"), "Template skill", "utf8");
    await fs.writeFile(path.join(skill, "templates", "qa.md"), "QA template", "utf8");
    await fs.writeFile(path.join(skill, "references", "guide.md"), "Reference guide", "utf8");
    await fs.writeFile(path.join(templateOnlyOutside, "templates", "qa.md"), "Foreign template", "utf8");
    spawnSync("git", ["init"], { cwd: checkout, stdio: "ignore" });
    for (const sidecar of GSTACK_REVIEW_SIDECARS) {
      await fs.mkdir(path.dirname(path.join(checkout, sidecar)), { recursive: true });
      await fs.writeFile(path.join(checkout, sidecar), `Fixture ${sidecar}`, "utf8");
    }

    const template = path.join(templateOnlyTarget, ".claude", "skills", "template-skill", "templates", "qa.md");
    const reference = path.join(templateOnlyTarget, ".claude", "skills", "template-skill", "references", "guide.md");
    await bootstrapGstack({ target: templateOnlyTarget });
    assert.equal(await fs.readFile(template, "utf8"), "QA template");
    assert.equal(await fs.readFile(reference, "utf8"), "Reference guide");
    assert.deepEqual((await validateProjectGstack(templateOnlyTarget)).assets, ["template-skill/references/guide.md", "template-skill/templates/qa.md"]);
    // Value: protects=regular-file ancillary roots reject before overwriting installed artifacts; fails_when=file root accepted or prior state changes; why_new=ancillary checks cover absent and symlink roots only; seam=none
    const priorState = await fs.readFile(path.join(gstackStatePath(templateOnlyTarget), "state.json"), "utf8");
    for (const root of ["sections", "templates", "references"]) {
      const source = path.join(skill, root);
      const saved = path.join(templateOnlyOutside, `saved-${root}`);
      const existed = await fs.lstat(source).then(() => true, () => false);
      if (existed) await fs.rename(source, saved);
      await fs.writeFile(source, "not a directory");
      await assert.rejects(() => bootstrapGstack({ target: templateOnlyTarget }), new RegExp(`skill ${root} are invalid`));
      assert.equal(await fs.readFile(template, "utf8"), "QA template");
      assert.equal(await fs.readFile(reference, "utf8"), "Reference guide");
      assert.equal(await fs.readFile(path.join(gstackStatePath(templateOnlyTarget), "state.json"), "utf8"), priorState);
      await fs.rm(source);
      if (existed) await fs.rename(saved, source);
    }
    await fs.rm(path.join(skill, "templates"), { recursive: true });
    await bootstrapGstack({ target: templateOnlyTarget });
    assert.equal((await validateProjectGstack(templateOnlyTarget)).assetsValid, true);
    await fs.symlink(path.join(templateOnlyOutside, "templates"), path.join(skill, "templates"), "dir");
    await assert.rejects(() => bootstrapGstack({ target: templateOnlyTarget }), /symlink/);
    await fs.rm(path.join(skill, "templates"), { force: true });
    const foreignTemplate = path.join(templateOnlyTarget, ".claude", "skills", "template-skill", "templates", "qa.md");
    await fs.mkdir(path.join(skill, "templates"), { recursive: true });
    await fs.writeFile(path.join(skill, "templates", "qa.md"), "QA template", "utf8");
    await fs.mkdir(path.dirname(foreignTemplate), { recursive: true });
    await fs.writeFile(foreignTemplate, "Foreign template", "utf8");
    await assert.rejects(() => bootstrapGstack({ target: templateOnlyTarget }), /gstack safety skill ownership conflict/);
    assert.equal(await fs.readFile(foreignTemplate, "utf8"), "Foreign template");
  } finally {
    await fs.rm(templateOnlyTarget, { recursive: true, force: true });
    await fs.rm(templateOnlyOutside, { recursive: true, force: true });
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
    const wrapper = path.join(rollbackTarget, ".claude", "skills", "_gstack-command");
    const review = path.join(rollbackTarget, ".claude", "skills", "review");
    const stateFile = path.join(gstackStatePath(rollbackTarget), "state.json");
    const checklist = path.join(review, "checklist.md");
    await fs.mkdir(path.join(checkout, "review"), { recursive: true });
    await fs.writeFile(path.join(checkout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
    await installGstackSafetyFixture(checkout);
    await fs.writeFile(path.join(checkout, "SKILL.md"), "Project-local gstack", "utf8");
    await fs.writeFile(path.join(checkout, "review", "SKILL.md"), "Review", "utf8");
    for (const sidecar of GSTACK_REVIEW_SIDECARS) {
      await fs.mkdir(path.dirname(path.join(checkout, sidecar)), { recursive: true });
      await fs.writeFile(path.join(checkout, sidecar), `Fixture ${sidecar}`, "utf8");
    }
    spawnSync("git", ["init"], { cwd: checkout, stdio: "ignore" });
    await bootstrapGstack({ target: rollbackTarget });
    const priorWrapper = await fs.readFile(path.join(wrapper, "SKILL.md"), "utf8");
    const priorReview = await fs.readFile(path.join(review, "SKILL.md"), "utf8");
    const priorChecklist = await fs.readFile(checklist, "utf8");
    const priorState = await fs.readFile(stateFile, "utf8");
    await fs.writeFile(path.join(rollbackTarget, ".claude", "settings.json"), "{", "utf8");
    const result = await setupGstack({ target: rollbackTarget });
    assert.equal(result.status, "failed");
    assert.equal(await fs.readFile(path.join(wrapper, "SKILL.md"), "utf8"), priorWrapper);
    assert.equal(await fs.readFile(path.join(review, "SKILL.md"), "utf8"), priorReview);
    assert.equal(await fs.readFile(checklist, "utf8"), priorChecklist);
    assert.equal(await fs.readFile(stateFile, "utf8"), priorState);
    assert.equal(await fs.readFile(path.join(rollbackTarget, ".claude", "settings.json"), "utf8"), "{");
  } finally {
    await fs.rm(rollbackTarget, { recursive: true, force: true });
  }

  const artifactRollbackTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-artifact-rollback-"));
  const artifactRollbackOutside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-artifact-rollback-outside-"));
  try {
    const checkout = gstackCheckoutPath(artifactRollbackTarget);
    await fs.mkdir(path.join(checkout, "review"), { recursive: true });
    await fs.writeFile(path.join(checkout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
    await installGstackSafetyFixture(checkout);
    await fs.writeFile(path.join(checkout, "SKILL.md"), "Project-local gstack", "utf8");
    await fs.writeFile(path.join(checkout, "review", "SKILL.md"), "Review", "utf8");
    for (const sidecar of GSTACK_REVIEW_SIDECARS) {
      await fs.mkdir(path.dirname(path.join(checkout, sidecar)), { recursive: true });
      await fs.writeFile(path.join(checkout, sidecar), `Fixture ${sidecar}`, "utf8");
    }
    spawnSync("git", ["init"], { cwd: checkout, stdio: "ignore" });
    await bootstrapGstack({ target: artifactRollbackTarget });
    const priorWrapper = await fs.readFile(path.join(artifactRollbackTarget, ".claude", "skills", "_gstack-command", "SKILL.md"), "utf8");
    const settingsFile = path.join(artifactRollbackTarget, ".claude", "settings.json");
    const outsideSettings = path.join(artifactRollbackOutside, "settings.json");
    await fs.writeFile(outsideSettings, "outside", "utf8");
    let injected = false;
    const progress = { beginOperation(spec) {
      return {
        update: async () => {
          if (spec.id === "gstack-bootstrap" && !injected) {
            injected = true;
            await fs.symlink(outsideSettings, settingsFile);
          }
        },
        complete() {},
        fail() {}
      };
    } };
    const result = await setupGstack({ target: artifactRollbackTarget, progress, silent: true });
    assert.equal(result.status, "failed");
    assert.deepEqual(result.rollbackErrors, ["gstack artifact rollback failed: gstack target path contains a symlink: " + settingsFile]);
    assert.equal(await fs.readFile(path.join(result.recoverySnapshot, "0"), "utf8"), priorWrapper);
    assert.equal(await fs.readFile(outsideSettings, "utf8"), "outside");
  } finally {
    await fs.rm(artifactRollbackTarget, { recursive: true, force: true });
    await fs.rm(artifactRollbackOutside, { recursive: true, force: true });
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
