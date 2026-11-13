import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { explainRules, ECC_RULE_PACKS, invalidEccRules, normalizeEccRules, selectEccRules } from "../../src/ecc/ecc-rules.mjs";
import { applyEccRules, buildAgentManifest, clearEccRules, validateAgentManifest } from "../../src/ecc/rules.mjs";
import { ensureEccCache } from "../../src/ecc/ecc-source.mjs";

async function writeGitFixture(target, { rule = "common", agent = "agent.md" } = {}) {
  const cache = path.join(target, ".repo-pattern", "cache", "ECC");
  await fs.mkdir(path.join(cache, "rules", rule), { recursive: true });
  await fs.mkdir(path.join(cache, "agents"), { recursive: true });
  await fs.writeFile(path.join(cache, "rules", rule, "rule.md"), "rule\n");
  await fs.writeFile(path.join(cache, "agents", agent), "agent\n");
  for (const args of [["init"], ["add", "."], ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "fixture"], ["remote", "add", "origin", "https://github.com/affaan-m/ECC.git"]]) {
    assert.equal(spawnSync("git", args, { cwd: cache, stdio: "ignore" }).status, 0);
  }
  return cache;
}

async function writeProvisionFixture(target) {
  await fs.mkdir(path.join(target, ".claude", "rules", "ecc", "old"), { recursive: true });
  await fs.writeFile(path.join(target, ".claude", "rules", "ecc", "old", "rule.md"), "old rule");
  await fs.mkdir(path.join(target, ".claude", "agents"), { recursive: true });
  await fs.writeFile(path.join(target, ".claude", "agents", "old-agent.md"), "old");
  await fs.writeFile(path.join(target, ".claude", "CLAUDE.md"), "old guidance\n");
  await fs.mkdir(path.join(target, ".repo-pattern"), { recursive: true });
  await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.json"), "{\"before\":true}\n");
  await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), "{\"before\":true}\n");
}

async function assertRestored(target) {
  assert.equal(await fs.readFile(path.join(target, ".claude", "rules", "ecc", "old", "rule.md"), "utf8"), "old rule");
  assert.equal(await fs.readFile(path.join(target, ".claude", "agents", "old-agent.md"), "utf8"), "old");
  assert.equal(await fs.readFile(path.join(target, ".claude", "CLAUDE.md"), "utf8"), "old guidance\n");
  assert.equal(await fs.readFile(path.join(target, ".repo-pattern", ".repo-pattern.json"), "utf8"), "{\"before\":true}\n");
  assert.equal(await fs.readFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"), "{\"before\":true}\n");
}

test("ECC rule selection and manifest validation preserve deterministic contracts", async () => {
  // protects=ECC rule normalization, selection, explanation, manifest ordering, and path/hash validation; fails_when=rules are selected, explained, ordered, or validated differently; no_claim=live ECC upstream availability or provisioning transactions.
  assert.match(explainRules({}, ["common"]), /Detected stack/);
  assert.match(explainRules({}, ["common"]), /Selected ECC rules/);
  assert.deepEqual(normalizeEccRules(["python", "common", "python", "unknown"]), ["python", "common"]);
  assert.deepEqual(invalidEccRules(["common", "unknown", "unknown"]), ["unknown"]);
  assert.deepEqual(selectEccRules({ languages: ["python", "typescript"], frameworks: ["nuxt"], tools: [], repoType: "fullstack" }), ["common", "nuxt", "python", "typescript", "vue", "web"]);
  assert.equal(ECC_RULE_PACKS[0], "common");
  assert.equal(ECC_RULE_PACKS.at(-1), "web");
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-ecc-manifest-"));
  try {
    await fs.writeFile(path.join(target, "A.md"), "upper");
    await fs.writeFile(path.join(target, "a.md"), "lower");
    const manifest = await buildAgentManifest(target);
    assert.deepEqual(manifest.map((entry) => entry.path), ["A.md", "a.md"]);
    assert.equal(validateAgentManifest(manifest), true);
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
  assert.equal(validateAgentManifest([{ path: "nested/agent.md", sha256: "a".repeat(64) }]), true);
  assert.equal(validateAgentManifest([{ path: "../agent.md", sha256: "a".repeat(64) }]), false);
  assert.equal(validateAgentManifest([{ path: "agent\\\\name.md", sha256: "a".repeat(64) }]), false);
  assert.equal(validateAgentManifest([{ path: "b.md", sha256: "a".repeat(64) }, { path: "a.md", sha256: "a".repeat(64) }]), false);
});

test("ECC cache handling preserves existing-cache and offline fixture behavior", async () => {
  // protects=ECC cache discovery, skipped operations, and deterministic local Git fixture synchronization; fails_when=existing caches are ignored or fixture-backed synchronization changes; no_claim=network access or live upstream repository content.
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-ecc-cache-"));
  try {
    const cache = path.join(target, ".repo-pattern", "cache", "ECC");
    await fs.mkdir(path.join(cache, "rules"), { recursive: true });
    const skipped = [];
    assert.equal(await ensureEccCache(target, { progress: { skipOperation: (id) => skipped.push(id) } }), cache);
    assert.deepEqual(skipped, ["ecc-cache"]);
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("ECC synchronization rolls back files and metadata after injected failures", async () => {
  // protects=ECC synchronization rollback, user-file preservation, and cleanup after failed metadata writes; fails_when=staged rules or agents remain, prior metadata changes, or user files are lost; no_claim=live upstream synchronization or every platform-specific failure mode.
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-ecc-rollback-"));
  try {
    await writeGitFixture(target, { rule: "python" });
    await writeProvisionFixture(target);
    await assert.rejects(() => applyEccRules({ target, ruleMode: "manual", rules: ["python"], operations: { writeLock: async () => { throw new Error("injected lock failure"); } } }), /injected lock failure/);
    await assertRestored(target);
    await assert.rejects(() => fs.access(path.join(target, ".claude", "rules", "ecc", "python")), { code: "ENOENT" });
    await assert.rejects(() => fs.access(path.join(target, ".claude", "agents", "agent.md")), { code: "ENOENT" });
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("ECC clearing removes managed rules while preserving agent inventory", async () => {
  // protects=ECC clear behavior, managed metadata cleanup, and retained synchronized agents; fails_when=managed rules or metadata remain or agents are removed; no_claim=interactive setup and upstream cache synchronization.
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-ecc-clear-"));
  try {
    await writeGitFixture(target, { rule: "python" });
    await fs.mkdir(path.join(target, ".claude", "rules", "ecc"), { recursive: true });
    await fs.writeFile(path.join(target, ".claude", "rules", "ecc", "python.md"), "managed");
    await fs.mkdir(path.join(target, ".claude", "agents"), { recursive: true });
    await fs.writeFile(path.join(target, ".claude", "agents", "agent.md"), "agent");
    await fs.mkdir(path.join(target, ".repo-pattern"), { recursive: true });
    await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.json"), JSON.stringify({ ecc: { rulesSync: "repo-pattern-auto-cache" } }));
    await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), JSON.stringify({ ecc: { rulesSyncedBy: "repo-pattern-auto-cache", appliedRules: ["python"], agentsSyncedBy: "repo-pattern-auto-cache", agentsSource: "https://github.com/affaan-m/ECC.git", agentsRevision: "a".repeat(40), appliedAgents: [{ path: "agent.md", sha256: "a".repeat(64) }] } }));
    await clearEccRules({ target });
    await assert.rejects(() => fs.access(path.join(target, ".claude", "rules", "ecc")), { code: "ENOENT" });
    assert.equal(JSON.parse(await fs.readFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), "utf8")).ecc.appliedRules.length, 0);
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});
