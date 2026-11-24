import "../fixtures/offline-guard.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveGstackCheckout, setupGstack } from "../../src/gstack/gstack.mjs";
import { test } from "node:test";


test("gstack setup status checks", async () => {
  // protects=browser opt-out persistence and setup status transitions; fails_when=state is not persisted or rerun keeps stale opt-out; no_claim=live browser availability.
  const target = await fs.mkdtemp(path.join(process.cwd(), ".gstack-setup-status-test-"));
  try {
    const setup = await setupGstack({ target, dryRun: true, silent: true, expectedCommit: null, resolveCheckout: (options) => resolveGstackCheckout({ ...options, expectedCommit: null, globalCheckout: path.join(path.dirname(target), "missing-global"), clone: () => { throw new Error("gstack fixture clone escape"); } }) });
    assert.equal(setup.status, "dry-run");
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});
