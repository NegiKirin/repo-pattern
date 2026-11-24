import "../fixtures/offline-guard.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runGstackDoctorChecks } from "./gstack-doctor.mjs";

const sourceRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

test("gstack doctor checks", async () => {
  // protects=doctor diagnostics, browser readiness, opt-out state, and recovery; fails_when=public doctor output loses failure or remediation behavior; no_claim=live browser availability.
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-doctor-test-"));
  try {
    await runGstackDoctorChecks(target, sourceRoot);
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});
