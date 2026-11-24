import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { gstackStatePath, resolveGstackCheckout, setupGstack } from "../../src/gstack/gstack.mjs";

export async function runGstackSetupStatusChecks(target, resolveCheckout) {
  const fixtureResolver = resolveCheckout || ((options) => resolveGstackCheckout({ ...options, expectedCommit: null, globalCheckout: path.join(path.dirname(target), "missing-global"), clone: () => { throw new Error("gstack fixture clone escape"); } }));
  // Value: protects=setup returns and persists explicit browser opt-out; fails_when=setup reports ready or omits persisted flag; why_new=runtime skipped state previously had no setup persistence assertion; seam=none
  const stateFile = path.join(gstackStatePath(target), "state.json");
  const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
  const originalSkip = process.env.GSTACK_SKIP_PLAYWRIGHT;
  process.env.GSTACK_SKIP_PLAYWRIGHT = "1";
  try {
    const setup = await setupGstack({ target, silent: true, resolveCheckout: fixtureResolver, expectedCommit: null });
    assert.equal(setup.browserSkipped, true);
    assert.equal(setup.browserStatus, "skipped");
    const persisted = JSON.parse(await fs.readFile(stateFile, "utf8"));
    assert.equal(persisted.browserSkipped, true);
    // Value: protects=rerunning setup without opt-out enables browser and replaces persisted skip; fails_when=old skip survives setup; why_new=doctor state edits do not exercise the setup transition; seam=none
    delete process.env.GSTACK_SKIP_PLAYWRIGHT;
    const enabled = await setupGstack({ target, silent: true, resolveCheckout: fixtureResolver, expectedCommit: null });
    assert.equal(enabled.status, "installed", enabled.error);
    assert.equal(enabled.browserSkipped, false);
    assert.equal(enabled.browserStatus, "ready");
    assert.equal(JSON.parse(await fs.readFile(stateFile, "utf8")).browserSkipped, false);
  } finally {
    if (originalSkip === undefined) delete process.env.GSTACK_SKIP_PLAYWRIGHT;
    else process.env.GSTACK_SKIP_PLAYWRIGHT = originalSkip;
    await fs.writeFile(stateFile, JSON.stringify(state));
  }
}
