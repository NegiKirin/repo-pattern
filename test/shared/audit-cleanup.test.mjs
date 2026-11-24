import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { auditProject } from "../../src/audit.mjs";
import { cleanupProject } from "../../src/cleanup.mjs";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);

async function targetFixture() {
  return fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-audit-native-"));
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value)}\n`);
}

async function removeTarget(target) {
  await fs.rm(target, { recursive: true, force: true });
}

test("auditProject classifies empty, minimal, partial, and legacy workspaces", async () => {
  const empty = await targetFixture();
  const minimal = await targetFixture();
  const partial = await targetFixture();
  const legacy = await targetFixture();
  try {
    assert.equal((await auditProject(empty, { silent: true })).state, "EMPTY");

    await writeJson(path.join(minimal, ".repo-pattern", ".repo-pattern.json"), { workflow: "none", mode: "target" });
    await writeJson(path.join(minimal, ".repo-pattern", ".repo-pattern.lock.json"), {});
    await fs.mkdir(path.join(minimal, ".claude"), { recursive: true });
    await writeJson(path.join(minimal, ".claude", "settings.json"), { hooks: {} });
    assert.equal((await auditProject(minimal, { silent: true })).state, "NO_PIPELINE_MINIMAL");

    await fs.mkdir(path.join(partial, ".claude"), { recursive: true });
    await writeJson(path.join(partial, ".claude", "settings.json"), { hooks: {} });
    assert.equal((await auditProject(partial, { silent: true })).state, "PARTIAL");

    await fs.mkdir(path.join(legacy, ".claude", "hooks"), { recursive: true });
    await fs.writeFile(path.join(legacy, ".claude", "hooks", "custom.mjs"), "custom");
    await writeJson(path.join(legacy, ".claude", "settings.json"), { hooks: { PreToolUse: [{ hooks: [{ command: "custom" }] }] } });
    assert.equal((await auditProject(legacy, { silent: true })).state, "LEGACY_VENDOR");
  } finally {
    await Promise.all([removeTarget(empty), removeTarget(minimal), removeTarget(partial), removeTarget(legacy)]);
  }
});

test("auditProject handles malformed settings, managed hooks, optional skills, and hardcoded MCP paths", async () => {
  const target = await targetFixture();
  try {
    await fs.mkdir(path.join(target, ".claude", "hooks"), { recursive: true });
    await fs.writeFile(path.join(target, ".claude", "hooks", "remove-generated-attribution.mjs"), "managed");
    await writeJson(path.join(target, ".claude", "settings.json"), { hooks: { PreToolUse: [{ _repo_pattern_source: "generated-attribution-removal" }] } });
    await writeJson(path.join(target, ".repo-pattern", ".repo-pattern.json"), { workflow: "ecc-native", mode: "target", optionalSkills: ["herdr"] });
    await writeJson(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), { ecc: { appliedRules: ["one"], appliedAgents: ["agent"] } });
    await fs.mkdir(path.join(target, ".claude", "skills", "herdr"), { recursive: true });
    await fs.mkdir(path.join(target, ".claude", "rules", "ecc", "core"), { recursive: true });
    await fs.mkdir(path.join(target, ".claude", "agents", "agent"), { recursive: true });
    await fs.writeFile(path.join(target, ".claude", "agents", "agent", "AGENTS.md"), "agent");
    await writeJson(path.join(target, ".mcp.json"), { mcpServers: { local: { env: { PATH: "/home/user/.cache" } } } });
    const result = await auditProject(target, { silent: true });
    assert.equal(result.hasHardcodedMcpPath, true);
    assert.equal(result.hasManagedGeneratedAttributionHook, true);
    assert.equal(result.hasOnlyGeneratedAttributionHookFile, true);
    assert.equal(result.hasManagedEccRules, true);
    assert.equal(result.hasManagedEccAgents, true);
    assert.deepEqual(result.agentEntries, ["agent"]);
    assert.equal(result.state, "ECC_NATIVE_MINIMAL");

    await fs.writeFile(path.join(target, ".claude", "settings.json"), "{");
    assert.equal((await auditProject(target, { silent: true })).hasManagedGeneratedAttributionHook, false);
  } finally {
    await removeTarget(target);
  }
});

test("auditProject flags unmanaged runtime surfaces and recognizes supported path formats", async () => {
  const target = await targetFixture();
  try {
    await fs.mkdir(path.join(target, ".claude", "commands"), { recursive: true });
    await fs.mkdir(path.join(target, ".claude", "hooks"), { recursive: true });
    await fs.writeFile(path.join(target, ".claude", "hooks", "custom.sh"), "custom");
    await fs.writeFile(path.join(target, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: "custom" }] }] } }));
    await writeJson(path.join(target, ".mcp.json"), { mcpServers: { local: { env: { UNIX_PATH: "/Users/example/project" } } } });
    const result = await auditProject(target, { silent: true });
    assert.equal(result.hasClaudeCommandsDir, true);
    assert.equal(result.hasClaudeHooksDir, true);
    assert.equal(result.hasOnlyGeneratedAttributionHookFile, false);
    assert.equal(result.hasHardcodedMcpPath, true);
    assert.equal(result.state, "LEGACY_VENDOR");
  } finally {
    await removeTarget(target);
  }
});

test("auditProject accepts template source skills without classifying them as legacy", async () => {
  const target = await targetFixture();
  try {
    await fs.mkdir(path.join(target, ".claude", "skills", "source-skill"), { recursive: true });
    await writeJson(path.join(target, ".repo-pattern", ".repo-pattern.json"), { mode: "template", workflow: "none" });
    await writeJson(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), {});
    const result = await auditProject(target, { silent: true });
    assert.equal(result.hasOnlyManagedSkills, false);
    assert.notEqual(result.state, "LEGACY_VENDOR");
  } finally {
    await removeTarget(target);
  }
});

test("auditProject distinguishes managed workflows, skills, rules, and hooks", async () => {
  const root = await targetFixture();
  try {
    const cases = [
      ["ecc-native", "ECC_NATIVE_MINIMAL"],
      ["gstack", "GSTACK_MINIMAL"],
      ["ecc-gstack", "ECC_GSTACK_MINIMAL"],
      ["none", "NO_PIPELINE_MINIMAL"]
    ];
    for (const [workflow, expected] of cases) {
      const target = path.join(root, workflow);
      await fs.mkdir(path.join(target, ".claude", "skills", "herdr"), { recursive: true });
      await writeJson(path.join(target, ".repo-pattern", ".repo-pattern.json"), {
        workflow, mode: "target", optionalSkills: [{
          name: "herdr",
          source: "https://github.com/ogulcancelik/herdr.git",
          revision: "9450b168c727e9e4cbee95e6edf4f11cfe6f2154"
        }],
        runtime: { localSkills: true, localCommands: false, localHooks: false, localScripts: false, localRules: false }
      });
      await writeJson(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), {});
      await writeJson(path.join(target, ".claude", "settings.json"), { hooks: {} });
      const result = await auditProject(target, { silent: true });
      assert.equal(result.state, workflow === "gstack" || workflow === "ecc-gstack" ? "PARTIAL" : expected);
      assert.deepEqual(result.actualSkillDirs, ["herdr"]);
      assert.equal(result.hasOnlyManagedSkills, workflow === "gstack" || workflow === "ecc-gstack" ? false : true);
      assert.equal(result.hasOnlyGeneratedAttributionHooks, true);
    }
  } finally {
    await removeTarget(root);
  }
});

test("auditProject flags unmanaged rules, agents, scripts, and non-generated hooks", async () => {
  const target = await targetFixture();
  try {
    await fs.mkdir(path.join(target, ".claude", "rules", "ecc", "python"), { recursive: true });
    await fs.mkdir(path.join(target, ".claude", "agents", "custom"), { recursive: true });
    await fs.mkdir(path.join(target, ".claude", "scripts"), { recursive: true });
    await fs.mkdir(path.join(target, ".claude", "hooks"), { recursive: true });
    await fs.writeFile(path.join(target, ".claude", "agents", "custom", "AGENTS.md"), "custom");
    await fs.writeFile(path.join(target, ".claude", "hooks", "custom.sh"), "custom");
    await fs.writeFile(path.join(target, ".claude", "scripts", "custom.sh"), "custom");
    await writeJson(path.join(target, ".claude", "settings.json"), { hooks: { Stop: [{ hooks: [{ command: "custom" }] }] } });
    await writeJson(path.join(target, ".repo-pattern", ".repo-pattern.json"), { workflow: "ecc-native", mode: "target" });
    await writeJson(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), { ecc: { appliedRules: ["python"], appliedAgents: ["custom"] } });
    const result = await auditProject(target, { silent: true });
    assert.equal(result.hasClaudeScriptsDir, true);
    assert.equal(result.hasClaudeHooksDir, true);
    assert.equal(result.hasOnlyGeneratedAttributionHookFile, false);
    assert.equal(result.hasManagedEccAgents, true);
    assert.deepEqual(result.agentEntries, ["custom"]);
    assert.equal(result.hasOnlyEccRulesDir, true);
    assert.equal(result.state, "LEGACY_VENDOR");
  } finally {
    await removeTarget(target);
  }
});

test("cleanupProject removes managed workspace files and preserves valid gstack checkout", async () => {
  const target = await targetFixture();
  try {
    await fs.mkdir(path.join(target, ".claude", "commands"), { recursive: true });
    await fs.mkdir(path.join(target, ".claude", "skills", "gstack", "bin"), { recursive: true });
    await fs.writeFile(path.join(target, ".claude", "commands", "old.md"), "old");
    await fs.writeFile(path.join(target, ".claude", "skills", "gstack", "bin", "gstack"), "#!/bin/sh\n");
    await fs.mkdir(path.join(target, ".claude", "skills", "gstack", ".git"), { recursive: true });
    await fs.mkdir(path.join(target, ".repo-pattern"), { recursive: true });
    await writeJson(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), { gstack: { status: "installed" } });

    const dryRunEntries = await fs.readdir(path.join(target, ".claude"));
    await cleanupProject({ sourceRoot: repoRoot, target, dryRun: true, silent: true });
    assert.deepEqual(await fs.readdir(path.join(target, ".claude")), dryRunEntries);

    await cleanupProject({ sourceRoot: repoRoot, target, preserveGstack: false, silent: true });
    await assert.rejects(fs.access(path.join(target, ".claude", "commands")), { code: "ENOENT" });
    assert.equal(JSON.parse(await fs.readFile(path.join(target, ".claude", "settings.json"))).permissions.defaultMode, "default");
  } finally {
    await removeTarget(target);
  }
});

test("cleanupProject rejects a symlinked Claude directory without touching its target", async () => {
  const target = await targetFixture();
  const outside = await targetFixture();
  try {
    await fs.symlink(outside, path.join(target, ".claude"), "dir");
    await assert.rejects(() => cleanupProject({ sourceRoot: repoRoot, target, silent: true }), /\.claude must not be a symlink/);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await Promise.all([removeTarget(target), removeTarget(outside)]);
  }
});
