import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DEFAULT_MCP_SERVERS, groupedMcpOptions } from "../../src/ui/setup-interaction.mjs";
import { groupedOptionalSkillOptions, OPTIONAL_SKILLS } from "../../src/skills.mjs";
import { applyMcpValues, generateMcp, listAvailableMcpServers, persistedMcpValues, readMcpConfig } from "../../src/mcp.mjs";
import { applyAttributionSetting, applyGeneratedAttributionHook, applyLocalSettings } from "../../src/setup/settings.mjs";
import { setupOptionsFromLock, setupProject, setupRetryOptions } from "../../src/setup/setup.mjs";

const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const cliPath = path.join(repoRoot, "bin", "repo-pattern.mjs");

test("MCP server selection and persistence preserve offline workspace contracts", async () => {
  // protects=MCP server discovery, grouping, deduplication, validation, generated files, defaults, and lock persistence; fails_when=available servers, selected order, generated settings, or rejected paths change; no_claim=live MCP server execution, credentials, or network access.
  const availableServers = await listAvailableMcpServers(repoRoot);
  assert.deepEqual(availableServers, ["chrome-devtools", "context7", "gitnexus", "playwright", "shadcn", "shadcn-studio", "tavily"]);
  const groupedServers = groupedMcpOptions(availableServers.map((value) => ({ value, hint: value })));
  assert.deepEqual(groupedServers.filter((option) => option.group).map((option) => option.label), ["Core / Must have", "Development tools", "UI / shadcn"]);
  assert.deepEqual(groupedServers.filter((option) => !option.group).map((option) => option.value), ["context7", "tavily", "gitnexus", "chrome-devtools", "playwright", "shadcn", "shadcn-studio"]);
  const groupedWithExtraServer = groupedMcpOptions([...availableServers, "future-server"].map((value) => ({ value, hint: value })));
  assert.deepEqual(groupedWithExtraServer.slice(-2), [{ group: true, label: "Other servers" }, { value: "future-server", hint: "future-server" }]);
  assert.deepEqual(DEFAULT_MCP_SERVERS, ["context7", "tavily", "gitnexus"]);
  const valueServers = { context7: { env: { CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}" } }, unexpected: { env: { ANTHROPIC_AUTH_TOKEN: "${ANTHROPIC_AUTH_TOKEN}" } } };
  assert.deepEqual(applyMcpValues(valueServers, { CONTEXT7_API_KEY: "redacted-key", ANTHROPIC_AUTH_TOKEN: "must-not-apply" }).context7.env, { CONTEXT7_API_KEY: "redacted-key" });
  assert.equal(applyMcpValues(valueServers, { ANTHROPIC_AUTH_TOKEN: "must-not-apply" }).unexpected.env.ANTHROPIC_AUTH_TOKEN, "${ANTHROPIC_AUTH_TOKEN}");
  assert.deepEqual(persistedMcpValues({ CONTEXT7_API_KEY: "context7-key", TAVILY_API_KEY: "tavily-key", ANTHROPIC_AUTH_TOKEN: "must-not-persist", OTHER_API_KEY: "other-key" }), { CONTEXT7_API_KEY: "context7-key", TAVILY_API_KEY: "tavily-key" });
  assert.deepEqual(applyLocalSettings({ env: { EXISTING: "kept", CONTEXT7_API_KEY: "stale" } }, { ANTHROPIC_AUTH_TOKEN: "must-persist-locally", TAVILY_API_KEY: "stale", ANTHROPIC_BASE_URL: "https://example.com/v1" }), { env: { EXISTING: "kept", ANTHROPIC_AUTH_TOKEN: "must-persist-locally", ANTHROPIC_BASE_URL: "https://example.com/v1" } });

  const groupedSkills = groupedOptionalSkillOptions(OPTIONAL_SKILLS);
  assert.deepEqual(groupedSkills.filter((option) => option.group).map((option) => option.label), ["Design and frontend", "Project patterns", "Documentation", "Terminal workflow"]);
  assert.deepEqual(groupedSkills.filter((option) => !option.group).map((option) => option.value), ["taste", "ui-ux-pro-max", "impeccable", "huashu-design", "nextjs-pattern", "fastapi-pattern", "document-specialist", "herdr"]);

  const selected = ["shadcn-studio", "context7", "shadcn-studio"];
  const { enabledServers, mcpServers } = await readMcpConfig({ sourceRoot: repoRoot, mcpServers: selected });
  assert.deepEqual(enabledServers, ["shadcn-studio", "context7"]);
  assert.deepEqual(mcpServers["shadcn-studio"], { command: "npx", args: ["-y", "shadcn-studio-mcp"], description: "shadcn/ui Studio component design and generation" });
  await assert.rejects(() => readMcpConfig({ sourceRoot: repoRoot, mcpServers: ["nope"] }), /Unknown MCP server\(s\): nope\. Available:/);

  const emptyTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-empty-mcp-native-"));
  try {
    await generateMcp({ sourceRoot: repoRoot, target: emptyTarget, mcpServers: [], yes: true, silent: true });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(emptyTarget, ".mcp.json"), "utf8")).mcpServers, {});
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(emptyTarget, ".claude", "settings.json"), "utf8")).enabledMcpjsonServers, []);
  } finally {
    await fs.rm(emptyTarget, { recursive: true, force: true });
  }

  const explicitTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-explicit-mcp-native-"));
  try {
    const result = spawnSync(process.execPath, [cliPath, "mcp", "--target", explicitTarget, "--mcp", "shadcn-studio", "--mcp", "context7", "--mcp", "shadcn-studio", "--yes"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(path.join(explicitTarget, ".mcp.json"), "utf8")).mcpServers), ["shadcn-studio", "context7"]);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(explicitTarget, ".claude", "settings.json"), "utf8")).enabledMcpjsonServers, ["shadcn-studio", "context7"]);
  } finally {
    await fs.rm(explicitTarget, { recursive: true, force: true });
  }

  const defaultsTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-default-mcp-native-"));
  try {
    const result = spawnSync(process.execPath, [cliPath, "mcp", "--target", defaultsTarget, "--yes"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(path.join(defaultsTarget, ".mcp.json"), "utf8")).mcpServers), DEFAULT_MCP_SERVERS);
  } finally {
    await fs.rm(defaultsTarget, { recursive: true, force: true });
  }

  const symlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-mcp-symlink-native-"));
  const outsideSettings = path.join(symlinkTarget, "outside-settings.json");
  try {
    await fs.mkdir(path.join(symlinkTarget, ".claude"), { recursive: true });
    await fs.writeFile(outsideSettings, JSON.stringify({ sentinel: true }));
    await fs.symlink(outsideSettings, path.join(symlinkTarget, ".claude", "settings.json"));
    const result = spawnSync(process.execPath, [cliPath, "mcp", "--target", symlinkTarget, "--yes"], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /settings\.json must not be a symlink/);
    assert.deepEqual(JSON.parse(await fs.readFile(outsideSettings, "utf8")), { sentinel: true });
  } finally {
    await fs.rm(symlinkTarget, { recursive: true, force: true });
  }

  const repoPatternSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-mcp-repo-pattern-symlink-native-"));
  const outsideRepoPattern = path.join(repoPatternSymlinkTarget, "outside-repo-pattern");
  try {
    await fs.mkdir(outsideRepoPattern, { recursive: true });
    await fs.writeFile(path.join(outsideRepoPattern, ".repo-pattern.lock.json"), JSON.stringify({ sentinel: true }));
    await fs.symlink(outsideRepoPattern, path.join(repoPatternSymlinkTarget, ".repo-pattern"), "dir");
    const result = spawnSync(process.execPath, [cliPath, "mcp", "--target", repoPatternSymlinkTarget, "--yes"], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /.repo-pattern must not be a symlink/);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(outsideRepoPattern, ".repo-pattern.lock.json"), "utf8")), { sentinel: true });
  } finally {
    await fs.rm(repoPatternSymlinkTarget, { recursive: true, force: true });
  }

  const lockSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-mcp-lock-symlink-native-"));
  const outsideLock = path.join(lockSymlinkTarget, "outside-lock.json");
  try {
    await fs.mkdir(path.join(lockSymlinkTarget, ".repo-pattern"), { recursive: true });
    await fs.writeFile(outsideLock, JSON.stringify({ sentinel: true }));
    await fs.symlink(outsideLock, path.join(lockSymlinkTarget, ".repo-pattern", ".repo-pattern.lock.json"));
    const result = spawnSync(process.execPath, [cliPath, "mcp", "--target", lockSymlinkTarget, "--yes"], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\.repo-pattern\/\.repo-pattern\.lock\.json must not be a symlink/);
    assert.deepEqual(JSON.parse(await fs.readFile(outsideLock, "utf8")), { sentinel: true });
  } finally {
    await fs.rm(lockSymlinkTarget, { recursive: true, force: true });
  }

  const setupTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-default-setup-native-"));
  try {
    await fs.mkdir(path.join(setupTarget, ".claude"), { recursive: true });
    await fs.writeFile(path.join(setupTarget, ".claude", "settings.json"), JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }));
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(String(message));
    try {
      await setupProject({ sourceRoot: repoRoot, target: setupTarget, setupPipeline: "none", yes: true });
    } finally {
      console.warn = originalWarn;
    }
    assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(path.join(setupTarget, ".mcp.json"), "utf8")).mcpServers), DEFAULT_MCP_SERVERS);
    const settings = JSON.parse(await fs.readFile(path.join(setupTarget, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.permissions.defaultMode, "default");
    assert.equal(settings.permissions.disableBypassPermissionsMode, "disable");
    assert.match(warnings.join("\n"), /Existing project bypass settings are removed during setup; use interactive setup to review them/);
  } finally {
    await fs.rm(setupTarget, { recursive: true, force: true });
  }

  for (const relativePath of ["mcp/profiles/backend.json", "mcp/profiles/full.json", "mcp/profiles/research.json", "mcp/profiles/web.json"]) {
    await assert.rejects(() => fs.access(path.join(repoRoot, relativePath)), { code: "ENOENT" });
  }
});

test("MCP retry options remove transient secrets and reject legacy profiles", () => {
  // protects=retry-state secret filtering and legacy MCP profile rejection; fails_when=transient keys persist or profile locks are accepted; no_claim=interactive setup, filesystem writes, or live credentials.
  const retry = setupRetryOptions({ action: "setup", setupPipeline: "none", mcpConfig: { mcpServers: ["context7"] }, mcpValues: { CONTEXT7_API_KEY: "secret", ANTHROPIC_AUTH_TOKEN: "must-not-persist" }, ruleConfig: { applyRules: false, ruleMode: "auto", rules: [] }, optionalSkills: [], localSettingsEnv: { CONTEXT7_API_KEY: "secret", ANTHROPIC_AUTH_TOKEN: "must-persist-locally", ANTHROPIC_BASE_URL: "https://provider.example/v1" }, attributionConfig: { mode: "off" } });
  assert.deepEqual(retry.mcpValueNames, ["CONTEXT7_API_KEY"]);
  assert.deepEqual(retry.localSettingsEnv, { ANTHROPIC_BASE_URL: "https://provider.example/v1" });
  const options = setupOptionsFromLock({ setup: { status: "failed", options: retry } });
  assert.deepEqual(options.mcpServers, ["context7"]);
  assert.throws(() => setupOptionsFromLock({ setup: { status: "failed", options: { profile: "backend" } } }), /MCP profiles are no longer supported/);
});

test("generated attribution hook executes as an integration boundary", async () => {
  // protects=executable generated-attribution hook input/output and file rewriting; fails_when=the copied hook is not executable, does not remove generated lines, or returns malformed PreToolUse output; no_claim=live Claude Code hook dispatch.
  const hook = path.join(repoRoot, ".claude.example", "hooks", "remove-generated-attribution.mjs");
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-attribution-hook-"));
  const runHook = (input) => spawnSync(process.execPath, [hook], {
    cwd: project,
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, HOME: project },
    input,
    encoding: "utf8"
  });
  const writeMode = (mode) => fs.writeFile(path.join(project, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ _repo_pattern_source: "generated-attribution-removal", _repo_pattern_attribution_mode: mode }] } }));
  try {
    await fs.mkdir(path.join(project, ".claude"), { recursive: true });
    await writeMode("off");
    for (const [command, expected] of [
      ["title\n🤖 Generated with Claude Code\nbody", "title\nbody"],
      ["title\nGenerated with [Claude Code](https://claude.com/claude-code)\nbody", "title\nbody"],
      ["title\r\nGenerated with Claude Code\r\nbody", "title\r\nbody"],
      ["title\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>\nbody", "title\nbody"],
      ["title Generated with Claude Code", "title Generated with Claude Code"],
      ["Co-Authored-By: Custom <custom@example.com>", "Co-Authored-By: Custom <custom@example.com>"]
    ]) {
      const result = runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, expected === command ? "" : `${JSON.stringify({ permissionDecision: "allow", updatedInput: { command: expected } })}\n`);
    }

    const body = path.join(project, "body.md");
    const outsideBody = path.join(project, "outside-body.md");
    await fs.writeFile(outsideBody, "Summary\n🤖 Generated with Claude Code\n", "utf8");
    await fs.symlink(outsideBody, body);
    assert.deepEqual(JSON.parse(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: `gh pr create --body-file ${body}` } })).stdout), { permissionDecision: "deny", reason: `Cannot remove generated attribution from referenced file: ${body}` });
    assert.equal(await fs.readFile(outsideBody, "utf8"), "Summary\n🤖 Generated with Claude Code\n");
    await fs.rm(body);
    await fs.writeFile(body, "Summary\n\n🤖 Generated with Claude Code\n", "utf8");
    const bodyCommand = `gh pr create --body-file ${body}`;
    assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: bodyCommand } })).stdout, "");
    assert.equal(await fs.readFile(body, "utf8"), "Summary\n\n");
    await fs.writeFile(body, "Summary\n🤖 Generated with Claude Code\n", "utf8");
    assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: "gh pr create --body-file ~/body.md" } })).stdout, "");
    assert.equal(await fs.readFile(body, "utf8"), "Summary\n");

    const mr = path.join(project, "mr.md");
    await fs.writeFile(mr, "Summary\n🤖 Generated with Claude Code\n", "utf8");
    assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: `glab mr create --description-file ${mr}` } })).stdout, "");
    assert.equal(await fs.readFile(mr, "utf8"), "Summary\n");

    const commit = path.join(project, "commit.txt");
    await fs.writeFile(commit, "Subject\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>\n", "utf8");
    for (const option of ["-F", "--file="]) {
      const command = `git commit ${option}${option === "-F" ? ` ${commit}` : commit}`;
      assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command } })).stdout, "");
      assert.equal(await fs.readFile(commit, "utf8"), "Subject\n\n");
      await fs.writeFile(commit, "Subject\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>\n", "utf8");
    }

    await fs.writeFile(body, `${"x".repeat(1024 * 1024)}\n🤖 Generated with Claude Code\n`, "utf8");
    assert.deepEqual(JSON.parse(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: bodyCommand } })).stdout), { permissionDecision: "deny", reason: `Cannot remove generated attribution from referenced file: ${body}` });
    await writeMode("on");
    const generated = "title\n🤖 Generated with Claude Code\n";
    assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: generated } })).stdout, "");
    await writeMode("custom");
    assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: generated } })).stdout, "");
    assert.equal(runHook("not-json").status, 2);
    assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: {} })).status, 2);
    assert.equal(runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: 1 } })).status, 2);
    assert.equal(runHook(JSON.stringify({ tool_name: "Read", tool_input: {} })).status, 2);
    assert.equal(runHook(JSON.stringify({ tool_name: "Read", tool_input: { command: "unchanged" } })).stdout, "{}\n");
    assert.equal((await fs.stat(hook)).mode & 0o111, 0o111);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});

test("generated attribution settings preserve hook replacement and modes", () => {
  // protects=generated attribution hook replacement, third-party hook retention, and attribution modes; fails_when=managed hooks duplicate, unrelated hooks disappear, or mode metadata changes; no_claim=hook subprocess behavior, GitHub/GitLab file rewriting, or provisioning.
  assert.deepEqual(applyAttributionSetting({ hooks: {} }, { mode: "off" }), { hooks: {}, attribution: { commit: "", pr: "" } });
  assert.deepEqual(applyAttributionSetting({ attribution: { commit: "old", pr: "old" } }, { mode: "on" }), { attribution: { commit: "", pr: "" } });
  assert.deepEqual(applyAttributionSetting({ attribution: { pr: "PR" } }, { mode: "custom", commit: "Custom" }), { attribution: { commit: "Custom", pr: "" } });
  // protects=generated attribution hook replacement, third-party hook retention, and attribution modes; fails_when=managed hooks duplicate, unrelated hooks disappear, or mode metadata changes; no_claim=hook subprocess behavior, GitHub/GitLab file rewriting, or provisioning.
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
});
