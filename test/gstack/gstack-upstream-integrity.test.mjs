import "../fixtures/offline-guard.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { manifestForPaths, verifyUpstreamManifest, runUpstreamLocalSetup, GSTACK_UPSTREAM_OWNER } from "../../src/gstack/gstack-upstream.mjs";
import { test } from "node:test";

async function runGstackUpstreamIntegrityChecks() {
const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-upstream-integrity-"));
try {
  const malformed = { version: 1, owner: GSTACK_UPSTREAM_OWNER, entries: [null] };
  assert((await verifyUpstreamManifest(target, malformed)).length > 0, "malformed entries must report validation errors");
  const traversal = { ...malformed, entries: [{ root: ".claude/skills/autoplan", path: "../../settings.json", type: "file" }] };
  assert((await verifyUpstreamManifest(target, traversal)).length > 0, "manifest paths must stay inside their publication root");
  const root = path.join(target, ".claude/skills/autoplan");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "SKILL.md"), "Upstream skill\n");
  await fs.symlink(root, path.join(root, "cycle"));
  await assert.rejects(manifestForPaths(target, ["autoplan"]), /cyclic/);
  let observedOptions;
  const environmentKeys = ["ANTHROPIC_AUTH_TOKEN", "CONTEXT7_API_KEY", "TAVILY_API_KEY", "MCP_SECRET", "NODE_OPTIONS", "BUN_INSTALL", "BUN_INSTALL_CACHE_DIR", "TMPDIR"];
  const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of environmentKeys) process.env[key] = `${key}-sentinel`;
    await assert.rejects(runUpstreamLocalSetup({
      target, checkout: path.join(target, ".claude/skills/gstack"),
      statePath: path.join(target, ".repo-pattern/gstack"), publicationRoots: [],
      runCommand: async (_command, _args, options) => {
        observedOptions = options;
        return "warning: could not render claude skills for the install (exit 1); the previous render stays in use";
      }
    }), /render/);
  } finally {
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  }
  for (const key of ["ANTHROPIC_AUTH_TOKEN", "CONTEXT7_API_KEY", "TAVILY_API_KEY", "MCP_SECRET", "NODE_OPTIONS"]) assert.equal(observedOptions.env[key], undefined);
  assert.equal(observedOptions.env.PATH, process.env.PATH || "/usr/bin:/bin");
  assert.equal(observedOptions.env.BUN_INSTALL, path.join(path.join(target, ".claude/skills/gstack"), ".repo-pattern-runtime", "bun"));
  assert.equal(observedOptions.env.BUN_INSTALL_CACHE_DIR, path.join(path.join(target, ".claude/skills/gstack"), ".repo-pattern-runtime", "bun-cache"));
  assert.equal(observedOptions.env.TMPDIR, path.join(path.join(target, ".claude/skills/gstack"), ".repo-pattern-runtime", "tmp"));
  console.log("gstack upstream integrity checks passed");
} finally {
  await fs.rm(target, { recursive: true, force: true });
}
}

test("gstack upstream integrity checks", async () => {
  // protects=manifest validation, traversal rejection, cycle detection, and render failure handling; fails_when=malformed upstream content is accepted; no_claim=live upstream availability.
  await runGstackUpstreamIntegrityChecks();
});
