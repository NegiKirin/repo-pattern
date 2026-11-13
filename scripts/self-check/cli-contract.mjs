import assert from "node:assert/strict";
import React from "react";
import { render as renderInk } from "ink-testing-library";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject, printAudit } from "../../src/audit.mjs";
import { cleanupProject } from "../../src/cleanup.mjs";
import { doctorProject } from "../../src/doctor.mjs";
import { ECC_PLUGIN, applyEccPluginSettings, setupEcc } from "../../src/ecc/ecc.mjs";
import { applyMcpValues, generateMcp, mcpSecretPrompt, persistedMcpValues, readGeneratedMcpValues, validateRelativeMcpPath } from "../../src/mcp.mjs";
import { provisionProject, setupPipelineScope } from "../../src/setup/provision.mjs";
import { applyAttributionSetting, applyLocalSettings, applyPermissionSettings, reconcileLocalPluginSettings, updateClaudePermissions } from "../../src/setup/settings.mjs";
import { writePrivateJson } from "../../src/shared/fs-utils.mjs";
import { askEffortLevel, askPassword, askText, nextEffortIndex, printBox, printLogo, printSection, printSummary, promptTestComponents, renderEffortPicker, renderLogo, resolveTextValue, selectMany, style, withPromptRenderer, withSpinner } from "../../src/ui/prompt.mjs";
import { setupProject, setupRetryOptions } from "../../src/setup/setup.mjs";
import { needsLocalSettingsPrompt } from "../../src/ui/setup-interaction.mjs";
import { applyEccRules, buildAgentManifest, clearEccRules, formatEccCloneError, hasGitUpstream, validateAgentManifest } from "../../src/ecc/rules.mjs";
import { applyOptionalSkills, applyPluginSkillSettings, expectedOptionalSkillDirs, invalidOptionalSkills, normalizeOptionalSkills, OPTIONAL_SKILLS } from "../../src/skills.mjs";
import { writeEccGitFixture } from "./fixtures.mjs";
const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const cliPath = path.join(repoRoot, "bin", "repo-pattern.mjs");
const secretSentinel = "do-not-persist-anthropic-token";

export async function runCliContractChecks() {
  const cloneError = formatEccCloneError({ stderr: "fatal: unable to access: Failed to connect to github.com port 443" });
assert.match(cloneError, /https:\/\/github\.com\/affaan-m\/ECC\.git/);
assert.match(cloneError, /github\.com:443|HTTPS/);
assert.match(cloneError, /proxy|firewall/);
assert.match(cloneError, /git ls-remote/);

const auditLogs = [];
const originalAuditLog = console.log;
const originalAuditStdinIsTty = process.stdin.isTTY;
const originalAuditStdoutIsTty = process.stdout.isTTY;
console.log = (message = "") => auditLogs.push(String(message));
process.stdin.isTTY = false;
process.stdout.isTTY = false;
try {
  printAudit({ target: "/tmp/project", state: "EMPTY" });
  printAudit({ target: "/tmp/project", state: "PARTIAL", hasSettingsHooks: true });
  printAudit({ target: "/tmp/project", state: "LEGACY_VENDOR", hasClaudeRulesDir: true, hasClaudeEccRulesDir: true, hasOnlyEccRulesDir: true, repoPattern: { workflow: "gstack" } });
} finally {
  console.log = originalAuditLog;
  process.stdin.isTTY = originalAuditStdinIsTty;
  process.stdout.isTTY = originalAuditStdoutIsTty;
}
assert(auditLogs.includes("Target  /tmp/project"));
assert(auditLogs.includes("State   EMPTY"));
assert(!auditLogs.some((line) => line.includes(".claude present")));
assert(auditLogs.some((line) => line.includes("⚠ .mcp.json missing")));
assert(auditLogs.some((line) => line.includes("⚠ .claude/settings.json hooks not empty")));
assert(auditLogs.some((line) => line.includes("⚠ .claude/rules/ecc is not repo-pattern-managed")));

const logs = [];
const originalLog = console.log;
const originalStdinIsTty = process.stdin.isTTY;
const originalStdoutIsTty = process.stdout.isTTY;
console.log = (message = "") => logs.push(String(message));
process.stdin.isTTY = false;
process.stdout.isTTY = false;
try {
  printSummary("MCP generated", [["Enabled servers", "context7, playwright, chrome-devtools, gitnexus, tavily"]]);
} finally {
  console.log = originalLog;
  process.stdin.isTTY = originalStdinIsTty;
  process.stdout.isTTY = originalStdoutIsTty;
}
assert(logs.some((line) => line.includes("chrome-devtools")));
assert(!logs.some((line) => line.length > 100));
assert(renderLogo().includes("repo-pattern"));
assert(renderLogo({ color: true }).some((line) => line.includes("\x1b[38;5;")));
process.stdin.isTTY = true;
process.stdout.isTTY = true;
process.env.NO_COLOR = "1";
try {
  assert.equal(style("success", "ready"), "ready");
} finally {
  delete process.env.NO_COLOR;
  process.stdin.isTTY = originalStdinIsTty;
  process.stdout.isTTY = originalStdoutIsTty;
}

// protects=non-interactive prompt fallback, summary wrapping, section output, and spinner passthrough; fails_when=CI/non-TTY execution enters Ink or long values lose wrapping; no_claim=physical TTY prompt behavior.
assert.equal(await askEffortLevel({ input: { isTTY: false }, output: { isTTY: false } }), "medium");
const sectionLogs = [];
const originalSectionLog = console.log;
console.log = (message = "") => sectionLogs.push(String(message));
try {
  printSection("Prompt checks");
  printSummary("Wrapped", [["Value", "x".repeat(80)]]);
} finally {
  console.log = originalSectionLog;
}
assert.equal(sectionLogs[0], "\n== Prompt checks ==");
const summaryText = sectionLogs.slice(1).join("\n");
assert.equal((summaryText.match(/x/g) || []).length, 80);
assert.equal(sectionLogs.slice(1).every((line) => line.length <= 79), true);
assert.equal(await withSpinner("ignored", () => "passed"), "passed");

// protects=prompt wrapper renderer injection, fallback restoration, and error propagation; fails_when=wrappers bypass the renderer, leak it after completion, or swallow render errors; no_claim=production Ink renderer internals.
const virtualRenderer = () => ({ unmount() {} });
await withPromptRenderer(virtualRenderer, async () => {
  askText("Name").catch(() => {});
  askPassword("Token").catch(() => {});
  selectMany({ message: "Pick", options: ["one"], initialValues: ["one"] }).catch(() => {});
  askEffortLevel({ input: { isTTY: true }, output: { isTTY: true } }).catch(() => {});
});
await assert.rejects(() => withPromptRenderer(() => { throw new Error("renderer failed"); }, () => askText("Name")), /renderer failed/);
const originalPromptStdinIsTty = process.stdin.isTTY;
const originalPromptStdoutIsTty = process.stdout.isTTY;
const originalCI = process.env.CI;
try {
  process.stdin.isTTY = true;
  process.stdout.isTTY = true;
  delete process.env.CI;
  await withPromptRenderer((tree) => renderInk(tree), () => printLogo());
  await assert.rejects(() => withPromptRenderer(() => { throw new Error("logo renderer failed"); }, () => printLogo()), /logo renderer failed/);
} finally {
  process.stdin.isTTY = originalPromptStdinIsTty;
  process.stdout.isTTY = originalPromptStdoutIsTty;
  if (originalCI === undefined) delete process.env.CI;
  else process.env.CI = originalCI;
}

// protects=deterministic Ink prompt keyboard behavior and rendering; fails_when=prompt submission, cancellation, validation, selection, masking, or effort movement changes; no_claim=physical terminal rendering or render-error injection.
const promptCases = [
  ["text", promptTestComponents.TextPrompt, { message: "Name", validate: (value) => value === "ok" || "Use ok" }, ["bad", "\r", "\u001b", "ok", "\r"], /Use ok/],
  ["password", promptTestComponents.TextPrompt, { message: "Token", initial: "saved", mask: true }, ["\r"], /•••••/],
  ["confirm", promptTestComponents.ConfirmPrompt, { message: "Continue", defaultYes: true }, ["n", "\r"], /No/],
  ["select", promptTestComponents.SelectPrompt, { message: "Pick", options: ["one", { value: "two", title: "Two", hint: "second" }], initialValue: "one" }, ["\u001b[B", "\r"], /Two/],
  ["many", promptTestComponents.SelectPrompt, { message: "Pick many", many: true, options: [{ value: "one", selected: true }, "two"] }, [" ", "\u001b[B", " ", "\r"], /◉ one/],
  ["effort", promptTestComponents.EffortPrompt, {}, ["\u001b[C", "\r"], /high/]
];
for (const [, Component, props, inputs, expected] of promptCases) {
  const renderedPrompt = renderInk(React.createElement(Component, { ...props, done: () => {} }));
  for (const input of inputs) {
    renderedPrompt.stdin.write(input);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.match(renderedPrompt.lastFrame(), expected);
  renderedPrompt.unmount();
}
const cancelledPrompt = renderInk(React.createElement(promptTestComponents.ConfirmPrompt, { message: "Cancel", defaultYes: true, done: () => {} }));
cancelledPrompt.stdin.write("\u001b");
assert.match(cancelledPrompt.lastFrame(), /Cancel/);
cancelledPrompt.unmount();
assert.equal(resolveTextValue("", { initial: "saved", placeholder: "hint" }), "saved");
assert.equal(resolveTextValue("", { placeholder: "hint" }), "hint");
assert.equal(nextEffortIndex(2, "left"), 1);
assert.equal(nextEffortIndex(2, "right"), 3);
assert.equal(nextEffortIndex(2, "other"), 2);
assert.equal(renderEffortPicker("medium", { columns: 79, color: false }), "Effort: [medium] recommended · ←/→ · Enter");
assert.match(renderEffortPicker("medium", { columns: 80, color: false }), /low ─ \[medium\]/);
const boxLogs = [];
console.log = (message = "") => boxLogs.push(String(message));
try {
  printBox("Prompt box", ["line"]);
  printLogo();
} finally {
  console.log = originalSectionLog;
}
assert.deepEqual(boxLogs.slice(0, 2), ["\n== Prompt box ==", "line"]);

function runCli(args, cwd = repoRoot) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8" });
}

let result;

result = runCli(["audit"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /Target\s+.*repo-pattern/);

const mcpReuseTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-mcp-reuse-"));
try {
  await fs.writeFile(path.join(mcpReuseTarget, ".mcp.json"), JSON.stringify({
    mcpServers: {
      filesystem: { command: "legacy-filesystem" },
      "sequential-thinking": { command: "legacy-thinking" },
      context7: { env: { CONTEXT7_API_KEY: "persisted-context7-key" } },
      tavily: { env: { TAVILY_API_KEY: "persisted-tavily-key" } }
    }
  }), "utf8");
  await fs.mkdir(path.join(mcpReuseTarget, ".claude"), { recursive: true });
  await fs.writeFile(path.join(mcpReuseTarget, ".claude", "settings.json"), JSON.stringify({
    enabledMcpjsonServers: ["filesystem", "sequential-thinking", "context7"]
  }), "utf8");
  result = runCli(["mcp", "--target", mcpReuseTarget, "--mcp", "context7", "--mcp", "tavily", "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  const mcpConfig = JSON.parse(await fs.readFile(path.join(mcpReuseTarget, ".mcp.json"), "utf8"));
  const settings = JSON.parse(await fs.readFile(path.join(mcpReuseTarget, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(Object.keys(mcpConfig.mcpServers), ["context7", "tavily"]);
  assert.deepEqual(settings.enabledMcpjsonServers, ["context7", "tavily"]);
  assert.equal(mcpConfig.mcpServers.context7.env.CONTEXT7_API_KEY, "persisted-context7-key");
  assert.equal(mcpConfig.mcpServers.tavily.env.TAVILY_API_KEY, "persisted-tavily-key");
  assert.equal(JSON.stringify(mcpConfig).includes(secretSentinel), false);
} finally {
  await fs.rm(mcpReuseTarget, { recursive: true, force: true });
}

const setupReuseTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-setup-reuse-"));
try {
  await fs.writeFile(path.join(setupReuseTarget, ".mcp.json"), JSON.stringify({
    mcpServers: { context7: { env: { CONTEXT7_API_KEY: "persisted-setup-key" } } }
  }), "utf8");
  const eccFixture = await writeEccGitFixture(setupReuseTarget);
  assert.equal(hasGitUpstream(eccFixture), false);
  result = runCli(["setup", "--target", setupReuseTarget, "--mcp", "context7", "--mcp", "tavily", "--mcp", "gitnexus", "--setup-pipeline", "ecc", "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /ECC cache exists but git pull failed/);
  assert.match(await fs.readFile(path.join(setupReuseTarget, ".mcp.json"), "utf8"), /persisted-setup-key/);
  assert.equal(JSON.parse(await fs.readFile(path.join(setupReuseTarget, ".repo-pattern", ".repo-pattern.json"), "utf8")).workflow, "ecc-native");
} finally {
  await fs.rm(setupReuseTarget, { recursive: true, force: true });
}

const gstackSetupTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-setup-"));
try {
  result = runCli(["setup", "--target", gstackSetupTarget, "--mcp", "context7", "--mcp", "tavily", "--mcp", "gitnexus", "--setup-pipeline", "gstack", "--yes", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /git clone --single-branch --depth 1|copy .*\.claude\/skills\/gstack/);
  assert.match(result.stdout, /run .*\/setup --local --host claude --no-prefix --no-harness-auto --no-team/);
  assert.doesNotMatch(result.stdout, /write gstack skill wrapper/);
  assert.match(result.stdout, /Setup pipeline\s+gstack/);
  assert.match(result.stdout, /Pipeline scope\s+project-local gstack at \.claude\/skills\/gstack/);
  assert.doesNotMatch(result.stdout, /Install ECC inside Claude Code/);
} finally {
  await fs.rm(gstackSetupTarget, { recursive: true, force: true });
}

const gstackHooksSetupTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-hooks-setup-"));
try {
  result = runCli(["setup", "--target", gstackHooksSetupTarget, "--mcp", "context7", "--mcp", "tavily", "--mcp", "gitnexus", "--setup-pipeline", "gstack", "--with-plan-tune-hooks", "--yes", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Plan-tune hooks\s+installed in \.claude\/settings\.json/);
  assert.match(result.stdout, /run .*\/setup --local --host claude --no-prefix --no-harness-auto --no-team/);
  assert.doesNotMatch(result.stdout, /~\/\.claude\/settings\.json/);
} finally {
  await fs.rm(gstackHooksSetupTarget, { recursive: true, force: true });
}

const privateWriteTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-private-write-"));
try {
  const privateWritePath = path.join(privateWriteTarget, "settings.local.json");
  await fs.writeFile(privateWritePath, '{"env":{"kept":"value"}}\n', { mode: 0o600 });
  await assert.rejects(
    () => writePrivateJson(privateWritePath, { unsupported: 1n }),
    /BigInt/
  );
  assert.equal(await fs.readFile(privateWritePath, "utf8"), '{"env":{"kept":"value"}}\n');
} finally {
  await fs.rm(privateWriteTarget, { recursive: true, force: true });
}

const mcpSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-mcp-symlink-target-"));
const mcpSymlinkDestination = path.join(os.tmpdir(), `repo-pattern-mcp-symlink-destination-${process.pid}`);
console.log = () => {};
try {
  await fs.writeFile(mcpSymlinkDestination, "unchanged", "utf8");
  await fs.symlink(mcpSymlinkDestination, path.join(mcpSymlinkTarget, ".mcp.json"));
  await assert.rejects(
    () => generateMcp({
      sourceRoot: repoRoot,
      target: mcpSymlinkTarget,
      mcpServers: ["context7", "tavily", "gitnexus"],
      mcpValues: { CONTEXT7_API_KEY: "mcp-symlink-key" },
      yes: true
    }),
    /\.mcp\.json.*symlink/
  );
  assert.equal(await fs.readFile(mcpSymlinkDestination, "utf8"), "unchanged");
  await assert.rejects(
    () => readGeneratedMcpValues(mcpSymlinkTarget),
    /\.mcp\.json.*symlink/
  );
  await fs.rm(path.join(mcpSymlinkTarget, ".mcp.json"));
  await fs.writeFile(path.join(mcpSymlinkTarget, ".mcp.json"), '{"mcpServers":{"context7":null}}', "utf8");
  await assert.rejects(
    () => readGeneratedMcpValues(mcpSymlinkTarget),
    /invalid MCP server entry/
  );
} finally {
  console.log = originalLog;
  await fs.rm(mcpSymlinkTarget, { recursive: true, force: true });
  await fs.rm(mcpSymlinkDestination, { force: true });
}
}
