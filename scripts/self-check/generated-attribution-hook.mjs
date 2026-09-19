import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { applyGeneratedAttributionHook, provisionProject, updateClaudeAttribution } from "../lib/provision.mjs";

export async function runGeneratedAttributionHookChecks(repoRoot) {
  assert.deepEqual(applyGeneratedAttributionHook({ hooks: {
    PreToolUse: [
      { _repo_pattern_source: "generated-attribution-removal", hooks: [{ command: "stale" }] },
      { _gstack_source: "repo-pattern-plan-tune", hooks: [{ command: "gstack" }] },
      { hooks: [{ command: "third-party" }] }
    ],
    PostToolUse: [{ hooks: [{ command: "post" }] }]
  } }).hooks, {
    PreToolUse: [
      { _gstack_source: "repo-pattern-plan-tune", hooks: [{ command: "gstack" }] },
      { hooks: [{ command: "third-party" }] },
      { _repo_pattern_source: "generated-attribution-removal", _repo_pattern_attribution_mode: "off", matcher: "^Bash$", hooks: [{ type: "command", command: "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/remove-generated-attribution.mjs\"", timeout: 5 }] }
    ],
    PostToolUse: [{ hooks: [{ command: "post" }] }]
  });

  const hookTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-attribution-hook-mode-"));
  const hookSettings = path.join(hookTarget, ".claude", "settings.json");
  await fs.mkdir(path.dirname(hookSettings), { recursive: true });

  function writeHookMode(mode) {
    return fs.writeFile(hookSettings, JSON.stringify({ hooks: { PreToolUse: [{
      _repo_pattern_source: "generated-attribution-removal",
      _repo_pattern_attribution_mode: mode
    }] } }), "utf8");
  }

  function runHook(input) {
    const hookPath = path.join(repoRoot, ".claude.example", "hooks", "remove-generated-attribution.mjs");
    return spawnSync("node", [hookPath], { input, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: hookTarget } });
  }

  try {
    await writeHookMode("off");
    for (const [command, expected] of [
      ["title\n🤖 Generated with Claude Code\nbody", "title\nbody"],
      ["title\r\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>\r\nbody", "title\r\nbody"],
      ["title\\n🤖 Generated with Claude Code\\nbody", "title\\nbody"],
      ["🤖 Generated with Claude Code\n", ""],
      ["title 🤖 Generated with Claude Code", "title 🤖 Generated with Claude Code"],
      ["  🤖 Generated with Claude Code", "  🤖 Generated with Claude Code"],
      ["Co-Authored-By: Custom <custom@example.com>", "Co-Authored-By: Custom <custom@example.com>"],
      ["title\nbody", "title\nbody"]
    ]) {
      const result = runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
      assert.equal(result.status, 0);
      assert.equal(result.stdout, command === expected ? "" : `${JSON.stringify({ permissionDecision: "allow", updatedInput: { command: expected } })}\n`);
    }
    const prBody = path.join(hookTarget, "pr-body.md");
    await fs.writeFile(prBody, "Summary\n\n🤖 Generated with Claude Code\n", "utf8");
    const prCommand = `gh pr create --body-file ${prBody}`;
    assert.deepEqual(JSON.parse(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: prCommand } })).stdout), { permissionDecision: "deny", reason: `Remove generated attribution from PR body file: ${prBody}` });
    await fs.writeFile(prBody, "Summary\n", "utf8");
    assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: prCommand } })).stdout, "");
    await writeHookMode("on");
    const generated = "title\n🤖 Generated with Claude Code\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>";
    assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: generated } })).stdout, "");
    await writeHookMode("custom");
    assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: generated } })).stdout, "");
    assert.equal(runHook("not-json").status, 2);
    assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: {} })).status, 2);
    assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: 1 } })).status, 2);
    assert.equal(runHook(JSON.stringify({ tool_name: "Read", tool_input: {} })).status, 2);
    assert.equal(runHook(JSON.stringify({ tool_name: "Read", tool_input: { command: "unchanged" } })).stdout, "{}\n");
  } finally {
    await fs.rm(hookTarget, { recursive: true, force: true });
  }

  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-attribution-hook-"));
  try {
    await fs.mkdir(path.join(target, ".claude"), { recursive: true });
    await fs.writeFile(path.join(target, ".claude", "settings.json"), JSON.stringify({ hooks: {
      PreToolUse: [{ _gstack_source: "repo-pattern-plan-tune", hooks: [{ command: "gstack" }] }, { hooks: [{ command: "third-party" }] }],
      PostToolUse: [{ hooks: [{ command: "post" }] }]
    } }), "utf8");
    await fs.mkdir(path.join(target, ".repo-pattern"), { recursive: true });
    await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.json"), JSON.stringify({ workflow: "none", runtime: { localSkills: false, localCommands: false, localHooks: false, localScripts: false, localRules: false } }), "utf8");
    await provisionProject({ sourceRoot: repoRoot, target, profile: "backend", setupPipeline: "none", applyRules: false });
    let settings = JSON.parse(await fs.readFile(path.join(target, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.hooks.PreToolUse.filter((entry) => entry._repo_pattern_source === "generated-attribution-removal").length, 1);
    assert.equal(settings.hooks.PreToolUse.find((entry) => entry._repo_pattern_source === "generated-attribution-removal")._repo_pattern_attribution_mode, "off");
    assert.equal(settings.hooks.PreToolUse.length, 3);
    assert.equal(settings.hooks.PostToolUse[0].hooks[0].command, "post");
    await provisionProject({ sourceRoot: repoRoot, target, profile: "backend", setupPipeline: "none", applyRules: false });
    settings = JSON.parse(await fs.readFile(path.join(target, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.hooks.PreToolUse.filter((entry) => entry._repo_pattern_source === "generated-attribution-removal").length, 1);
    settings.hooks.PreToolUse.push({ _repo_pattern_source: "generated-attribution-removal", hooks: [{ command: "duplicate" }] });
    await fs.writeFile(path.join(target, ".claude", "settings.json"), JSON.stringify(settings), "utf8");
    await fs.writeFile(path.join(target, ".claude", "hooks", "remove-generated-attribution.mjs"), "stale", "utf8");
    await updateClaudeAttribution({ sourceRoot: repoRoot, target, attributionConfig: { mode: "custom", commit: "Custom" } });
    settings = JSON.parse(await fs.readFile(path.join(target, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.hooks.PreToolUse.filter((entry) => entry._repo_pattern_source === "generated-attribution-removal").length, 1);
    assert.equal(settings.hooks.PreToolUse.length, 3);
    assert.equal(settings.attribution.commit, "Custom");
    assert.equal(settings.hooks.PreToolUse.find((entry) => entry._repo_pattern_source === "generated-attribution-removal")._repo_pattern_attribution_mode, "custom");
    assert.match(await fs.readFile(path.join(target, ".claude", "hooks", "remove-generated-attribution.mjs"), "utf8"), /Generated with/);
    await updateClaudeAttribution({ sourceRoot: repoRoot, target, attributionConfig: { mode: "off" } });
    settings = JSON.parse(await fs.readFile(path.join(target, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.hooks.PreToolUse.filter((entry) => entry._repo_pattern_source === "generated-attribution-removal").length, 1);
    assert.equal(settings.hooks.PreToolUse.find((entry) => entry._repo_pattern_source === "generated-attribution-removal")._repo_pattern_attribution_mode, "off");
    assert.equal(settings.attribution.commit, "");
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
}
