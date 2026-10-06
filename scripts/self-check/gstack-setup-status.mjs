import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { gstackStatePath, gstackSummaryRows, setupGstack } from "../lib/gstack.mjs";

export async function runGstackSetupStatusChecks(target) {
  // Value: protects=setup returns and persists explicit browser opt-out; fails_when=setup reports ready or omits persisted flag; why_new=runtime skipped state previously had no setup persistence assertion; seam=none
  assert.deepEqual(gstackSummaryRows(target, false, "skipped")[2], ["Status", "runtime ready; browser skipped"]);
  const stateFile = path.join(gstackStatePath(target), "state.json");
  const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
  const originalSkip = process.env.GSTACK_SKIP_PLAYWRIGHT;
  process.env.GSTACK_SKIP_PLAYWRIGHT = "1";
  try {
    const setup = await setupGstack({ target, silent: true });
    assert.equal(setup.browserSkipped, true);
    assert.equal(setup.browserStatus, "skipped");
    const persisted = JSON.parse(await fs.readFile(stateFile, "utf8"));
    assert.equal(persisted.browserSkipped, true);
  } finally {
    if (originalSkip === undefined) delete process.env.GSTACK_SKIP_PLAYWRIGHT;
    else process.env.GSTACK_SKIP_PLAYWRIGHT = originalSkip;
    await fs.writeFile(stateFile, JSON.stringify(state));
  }
}
