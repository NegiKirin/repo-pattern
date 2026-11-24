import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyOptionalSkills, expectedOptionalSkillDirs, invalidOptionalSkills, normalizeOptionalSkills, reconcilePluginSkillSettings, selectedPluginSkills } from "../../src/skills.mjs";
import { printAudit, renderDoctor } from "../../src/ui/reports.mjs";

test("optional skill selection and dry-run migration preserve local and plugin contracts", async () => {
  assert.deepEqual(normalizeOptionalSkills(["herdr", "herdr", ""]), ["herdr"]);
  assert.deepEqual(invalidOptionalSkills(["herdr", "unknown", "unknown"]), ["unknown"]);
  assert.deepEqual(selectedPluginSkills(["taste", "herdr"]).map((skill) => skill.value), ["taste"]);
  assert.deepEqual(expectedOptionalSkillDirs([{ name: "herdr", source: "https://github.com/ogulcancelik/herdr.git", revision: "9450b168c727e9e4cbee95e6edf4f11cfe6f2154", installedDirs: ["herdr"] }]), ["herdr"]);
  assert.deepEqual(expectedOptionalSkillDirs([{ name: "herdr", source: "wrong", revision: "wrong", installedDirs: ["herdr"] }]), []);
  assert.deepEqual(reconcilePluginSkillSettings({ enabledPlugins: { "taste-skill@taste-skill": true } }, ["taste"]).enabledPlugins, { "taste-skill@taste-skill": true });

  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-skills-dry-run-"));
  try {
    const log = [];
    const result = await applyOptionalSkills({
      target,
      skills: ["herdr", "taste"],
      dryRun: true,
      output: { log: (line) => log.push(line) },
      silent: false
    });
    assert.deepEqual(result.selectedSkills, ["herdr", "taste"]);
    assert.deepEqual(result.appliedSkills.map((skill) => skill.name), ["herdr", "taste"]);
    assert(log.some((line) => String(line).includes("git clone")));
    assert.deepEqual(await fs.readdir(target), []);
    await assert.rejects(() => applyOptionalSkills({ target, skills: ["missing"], dryRun: true }), /Unknown optional skill/);
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("doctor and audit reports preserve grouped warnings, repairs, and safe target text", () => {
  const lines = [];
  const previousLog = console.log;
  console.log = (line = "") => lines.push(String(line));
  try {
    renderDoctor({
      target: "/tmp/doctor\nunsafe",
      setupPipeline: "ecc",
      checks: [
        { ok: false, label: ".mcp.json is not tracked", group: "Settings & MCP", reason: "tracked" },
        { ok: true, label: ".claude exists", group: "Workspace" }
      ],
      infoRows: ["browser skipped by persisted GSTACK_SKIP_PLAYWRIGHT=1", "setup pipeline: ecc"],
      verbose: true
    });
    printAudit({ target: "/tmp/audit", state: "PARTIAL", hasClaudeDir: false, hasMcpJson: false, hasRepoPatternJson: false, hasHardcodedMcpPath: true, hasSettingsLocalTracked: false, hasSettingsHooks: true, repoPattern: { workflow: "none" }, gstack: null, lock: {}, hasClaudeSkillsDir: false, hasOnlyManagedSkills: true, hasClaudeCommandsDir: false, hasClaudeHooksDir: false, hasClaudeScriptsDir: false, hasClaudeRulesDir: false, hasOnlyEccRulesDir: true, hasClaudeEccRulesDir: false, hasManagedEccRules: false, hasManagedEccAgents: false, hasClaudeAgentsDir: false });
  } finally {
    console.log = previousLog;
  }
  const output = lines.join("\n");
  assert.match(output, /Warnings/);
  assert.match(output, /Detailed checks/);
  assert.match(output, /hardcoded machine path/);
  assert.doesNotMatch(output, /\u0000/);
});
