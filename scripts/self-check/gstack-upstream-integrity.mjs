import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { manifestForPaths, verifyUpstreamManifest, runUpstreamLocalSetup, GSTACK_UPSTREAM_OWNER } from "../lib/gstack-upstream.mjs";

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
  await assert.rejects(runUpstreamLocalSetup({
    target, checkout: path.join(target, ".claude/skills/gstack"),
    statePath: path.join(target, ".repo-pattern/gstack"), publicationRoots: [],
    runCommand: async () => "warning: could not render claude skills for the install (exit 1); the previous render stays in use"
  }), /render/);
  console.log("gstack upstream integrity checks passed");
} finally {
  await fs.rm(target, { recursive: true, force: true });
}
