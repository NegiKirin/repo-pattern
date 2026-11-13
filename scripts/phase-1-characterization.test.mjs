import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliPath = path.join(repoRoot, "bin", "repo-pattern.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: repoRoot });
}

test("none-pipeline setup preserves generated workspace semantics", async () => {
  // protects=base workspace files and repo-pattern state for a real none-pipeline setup; fails_when=required files, workflow metadata, or lock state is missing or wrong; no_claim=ECC/gstack upstream installation or interactive behavior.
  const target = await mkdtemp(path.join(os.tmpdir(), "repo-pattern-phase1-"));
  try {
    const result = runCli(["setup", "--target", target, "--setup-pipeline", "none", "--yes"]);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(await readFile(path.join(target, "CLAUDE.md"), "utf8"), "");
    assert.equal((await readFile(path.join(target, ".claude", "CLAUDE.md"))).length > 0, true);
    assert.equal((await readFile(path.join(target, ".claude", "settings.json"))).length > 0, true);
    const state = JSON.parse(await readFile(path.join(target, ".repo-pattern", ".repo-pattern.json"), "utf8"));
    const lock = JSON.parse(await readFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
    assert.equal(state.workflow, "none");
    assert.equal(lock.setupPipeline, "none");
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
