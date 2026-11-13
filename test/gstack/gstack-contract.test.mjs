import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensureBun, gstackCheckoutPath, gstackSummaryRows, setupGstack } from "../../src/gstack/gstack.mjs";
import { snapshotUpstreamTransaction } from "../../src/gstack/gstack-upstream.mjs";
import { GSTACK_RUNTIME_TIMEOUTS, prepareGstackRuntime, runtimeEnvironment, validateGstackRuntime } from "../../src/gstack/gstack-runtime.mjs";
import { installGstackRuntimeFixture, installGstackSafetyFixture, installGstackUpstreamSetupFixture } from "../../scripts/self-check/fixtures.mjs";

async function makeCheckout(target) {
  const checkout = gstackCheckoutPath(target);
  await fs.mkdir(checkout, { recursive: true });
  await installGstackUpstreamSetupFixture(checkout);
  await installGstackSafetyFixture(checkout);
  await fs.writeFile(path.join(checkout, "SKILL.md"), "Project-local gstack\n");
  await fs.mkdir(path.join(checkout, "review"), { recursive: true });
  await fs.writeFile(path.join(checkout, "review", "SKILL.md"), "Review\n");
  assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: checkout }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: checkout }).status, 0);
  assert.equal(spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"], { cwd: checkout }).status, 0);
  return checkout;
}

test("gstack runtime paths and diagnostics preserve bounded offline contracts", async () => {
  // protects=gstack runtime environment overrides, timeout constants, Bun diagnostics, and runtime directory validation; fails_when=paths leak, deadlines change, or invalid runtime trees are accepted; no_claim=real Bun installation, Chromium availability, or live upstream access.
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-runtime-"));
  try {
    assert.equal(GSTACK_RUNTIME_TIMEOUTS.install, 600000);
    assert.equal(GSTACK_RUNTIME_TIMEOUTS.probe, 30000);
    const inherited = { PATH: "/fixture/bin", BUN_INSTALL: "/inherited/bun", GSTACK_HOME: "/inherited/state" };
    const originalEnvironment = { ...inherited };
    assert.deepEqual(runtimeEnvironment(target, inherited), {
      ...inherited,
      BUN_INSTALL: path.join(target, ".repo-pattern-runtime", "bun"),
      GSTACK_ROOT: target,
      GSTACK_HOME: path.join(target, ".repo-pattern-runtime", "state"),
      PLAYWRIGHT_BROWSERS_PATH: path.join(target, ".repo-pattern-runtime", "chromium"),
      BUN_INSTALL_CACHE_DIR: path.join(target, ".repo-pattern-runtime", "bun-cache"),
      TMPDIR: path.join(target, ".repo-pattern-runtime", "tmp"),
      GSTACK_SETUP_RUNNING: "1",
      GSTACK_SETUP_SKIP_CSO_BUILD: "1"
    });
    assert.deepEqual(inherited, originalEnvironment);
    assert.throws(() => ensureBun({ run: () => "1.4.1\n" }), /Bun v1.4.2\+ is required/);
    assert.equal(ensureBun({ run: () => "1.4.2\n" }), "bun");
    await fs.writeFile(path.join(target, ".repo-pattern-runtime"), "not a directory");
    await assert.rejects(prepareGstackRuntime(target), /Invalid gstack runtime directory/);
    await fs.rm(path.join(target, ".repo-pattern-runtime"));
    await installGstackRuntimeFixture(target);
    await prepareGstackRuntime(target, { browserSkipped: true });
    assert.equal((await validateGstackRuntime(target, { browserSkipped: true })).runtimeValid, true);
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("gstack fixture setup preserves project files and managed status", async () => {
  // protects=offline gstack setup, project-file preservation, managed skill installation, and summary status; fails_when=fixture setup changes user files or reports the wrong state; no_claim=live upstream, Bun, external network, or PTY behavior.
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-setup-"));
  const originalHome = process.env.HOME;
  try {
    process.env.HOME = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-home-"));
    const checkout = await makeCheckout(target);
    const packageJson = JSON.stringify({ private: true, dependencies: { "must-not-install": "file:missing" } });
    await fs.writeFile(path.join(target, "package.json"), packageJson);
    await fs.writeFile(path.join(target, "bun.lock"), "preserve\n");
    const result = await setupGstack({ target, silent: true });
    assert.equal(result.status, "installed", result.error);
    assert.equal(await fs.readFile(path.join(target, "package.json"), "utf8"), packageJson);
    assert.equal(await fs.readFile(path.join(target, "bun.lock"), "utf8"), "preserve\n");
    assert.equal(await fs.readFile(path.join(target, ".claude", "skills", "_gstack-command", "SKILL.md"), "utf8"), "Project-local gstack\n");
    assert.match(gstackSummaryRows(target, false, "skipped")[2][1], /browser skipped/);
    assert.equal(await fs.readFile(path.join(checkout, "SKILL.md"), "utf8"), "Project-local gstack\n");
  } finally {
    process.env.HOME = originalHome;
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("upstream rollback attempts every entry and rejects symlinked snapshots", async () => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-transaction-"));
  try {
    const checkout = path.join(target, "checkout");
    const statePath = path.join(target, "state");
    await fs.mkdir(checkout, { recursive: true });
    await fs.mkdir(statePath, { recursive: true });
    await fs.writeFile(path.join(checkout, "managed.txt"), "checkout before\n");
    await fs.writeFile(path.join(statePath, "managed.txt"), "state before\n");
    const transaction = await snapshotUpstreamTransaction({ target, checkout, statePath, publicationRoots: [] });
    await fs.writeFile(path.join(checkout, "managed.txt"), "checkout changed\n");
    await fs.writeFile(path.join(statePath, "managed.txt"), "state changed\n");
    const outside = path.join(target, "outside.txt");
    await fs.writeFile(outside, "outside\n");
    await fs.rm(checkout, { recursive: true, force: true });
    await fs.symlink(outside, checkout);
    await assert.rejects(() => transaction.rollback(), /gstack target path contains a symlink/);
    assert.equal(await fs.readFile(outside, "utf8"), "outside\n");
    assert.equal(await fs.readFile(path.join(statePath, "managed.txt"), "utf8"), "state before\n");
    await transaction.remove();
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("gstack setup failure leaves the prior managed state intact", async () => {
  // protects=gstack setup failure recovery and user-owned state preservation; fails_when=failed setup removes prior state or leaves partial managed output; no_claim=all upstream rollback stages, external tools, or interactive setup.
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-rollback-"));
  try {
    const checkout = await makeCheckout(target);
    const first = await setupGstack({ target, silent: true });
    assert.equal(first.status, "installed", first.error);
    const prior = await fs.readFile(path.join(target, ".repo-pattern", "gstack", "state.json"), "utf8");
    await fs.writeFile(path.join(target, ".claude", "settings.json"), "{", "utf8");
    const failed = await setupGstack({ target, silent: true });
    assert.equal(failed.status, "failed");
    assert.equal(await fs.readFile(path.join(target, ".repo-pattern", "gstack", "state.json"), "utf8"), prior);
    assert.equal(await fs.readFile(path.join(checkout, "SKILL.md"), "utf8"), "Project-local gstack\n");
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});
