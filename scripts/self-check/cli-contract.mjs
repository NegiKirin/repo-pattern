import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject, printAudit } from "../lib/audit.mjs";
import { cleanupProject } from "../lib/cleanup.mjs";
import { doctorProject } from "../lib/doctor.mjs";
import { ECC_PLUGIN, applyEccPluginSettings, setupEcc } from "../lib/ecc.mjs";
import { applyMcpValues, generateMcp, mcpSecretPrompt, persistedMcpValues, readGeneratedMcpValues, validateRelativeMcpPath } from "../lib/mcp.mjs";
import { applyAttributionSetting, applyLocalSettings, applyPermissionSettings, provisionProject, reconcileLocalPluginSettings, setupPipelineScope, updateClaudePermissions } from "../lib/provision.mjs";
import { writePrivateJson } from "../lib/fs-utils.mjs";
import { printSummary, renderLogo, style } from "../lib/prompt.mjs";
import { needsLocalSettingsPrompt, setupProject, setupRetryOptions } from "../lib/setup.mjs";
import { applyEccRules, buildAgentManifest, clearEccRules, formatEccCloneError, hasGitUpstream, validateAgentManifest } from "../lib/rules.mjs";
import { applyOptionalSkills, applyPluginSkillSettings, expectedOptionalSkillDirs, invalidOptionalSkills, normalizeOptionalSkills, OPTIONAL_SKILLS } from "../lib/skills.mjs";
import { writeEccGitFixture } from "./fixtures.mjs";
const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const cliPath = path.join(cliDir, "..", "repo-pattern.mjs");
const secretSentinel = "do-not-persist-anthropic-token";

const originalLog = console.log;

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
  printSummary("MCP generated", [["Enabled servers", "context7, filesystem, playwright, chrome-devtools, gitnexus, tavily, sequential-thinking"]]);
} finally {
  console.log = originalLog;
  process.stdin.isTTY = originalStdinIsTty;
  process.stdout.isTTY = originalStdoutIsTty;
}
assert(logs.some((line) => line.includes("sequential-thinking")));
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

function runCli(args, cwd = repoRoot) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8" });
}

let result = runCli(["help"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /repo-pattern help/);

result = runCli(["doctor", "--bogus"]);
assert.equal(result.status, 2);
assert.match(result.stderr, /Unknown argument: --bogus/);

result = runCli(["setup", "--target"]);
assert.equal(result.status, 2);
assert.match(result.stderr, /Missing value for --target/);

result = runCli(["setup", "--with-skill", "nope"]);
assert.equal(result.status, 2);
assert.match(result.stderr, /Unknown optional skill\(s\): nope/);

result = runCli(["setup", "--setup-pipeline", "nope", "--yes"]);
assert.equal(result.status, 2);
assert.match(result.stderr, /Unknown setup pipeline: nope\. Available: ecc, gstack/);

result = runCli(["setup", "--setup-pipeline", "ecc", "--with-plan-tune-hooks", "--yes"]);
assert.equal(result.status, 2);
assert.match(result.stderr, /--with-plan-tune-hooks requires --setup-pipeline gstack or both/);

result = runCli(["help"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /--setup-pipeline <ecc\|gstack\|both\|none>/);
assert.match(result.stdout, /ecc: project-scoped ECC/);
assert.match(result.stdout, /gstack: project-local at \.claude\/skills\/gstack/);
assert.match(result.stdout, /both: project-scoped ECC \+ project-local gstack/);
assert.match(result.stdout, /none: base project metadata only/);
assert.match(result.stdout, /--with-plan-tune-hooks/);
assert.match(result.stdout, /--with-skill <name>/);
assert.match(result.stdout, /ui-ux-pro-max/);
assert.match(result.stdout, /impeccable/);
assert.match(result.stdout, /huashu-design/);
assert.match(result.stdout, /nextjs-pattern/);
assert.match(result.stdout, /fastapi-pattern/);
assert.match(result.stdout, /herdr/);

result = runCli(["audit"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /Target\s+.*repo-pattern/);

result = runCli(["mcp", "--profile", "minimal", "--yes", "--dry-run"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /MCP generated/);

result = runCli(["mcp", "--profile", "nope", "--yes"]);
assert.equal(result.status, 1);
assert.match(result.stderr, /MCP profile not found: nope\. Available profiles: /);
assert.match(result.stderr, /minimal/);
assert.match(result.stderr, /web/);

const mcpReuseTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-mcp-reuse-"));
try {
  await fs.writeFile(path.join(mcpReuseTarget, ".mcp.json"), JSON.stringify({
    mcpServers: {
      context7: { env: { CONTEXT7_API_KEY: "persisted-context7-key" } },
      tavily: { env: { TAVILY_API_KEY: "persisted-tavily-key" } }
    }
  }), "utf8");
  result = runCli(["mcp", "--target", mcpReuseTarget, "--profile", "research", "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  const mcpConfigText = await fs.readFile(path.join(mcpReuseTarget, ".mcp.json"), "utf8");
  assert.match(mcpConfigText, /persisted-context7-key/);
  assert.match(mcpConfigText, /persisted-tavily-key/);
  assert.equal(mcpConfigText.includes(secretSentinel), false);
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
  result = runCli(["setup", "--target", setupReuseTarget, "--profile", "minimal", "--setup-pipeline", "ecc", "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /ECC cache exists but git pull failed/);
  assert.match(await fs.readFile(path.join(setupReuseTarget, ".mcp.json"), "utf8"), /persisted-setup-key/);
  assert.equal(JSON.parse(await fs.readFile(path.join(setupReuseTarget, ".repo-pattern", ".repo-pattern.json"), "utf8")).workflow, "ecc-native");
} finally {
  await fs.rm(setupReuseTarget, { recursive: true, force: true });
}

const gstackSetupTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-setup-"));
try {
  result = runCli(["setup", "--target", gstackSetupTarget, "--profile", "minimal", "--setup-pipeline", "gstack", "--yes", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /git clone --single-branch --depth 1|copy .*\.claude\/skills\/gstack/);
  assert.match(result.stdout, /write gstack skill wrapper/);
  assert.match(result.stdout, /Setup pipeline\s+gstack/);
  assert.match(result.stdout, /Pipeline scope\s+project-local gstack at \.claude\/skills\/gstack/);
  assert.doesNotMatch(result.stdout, /Install ECC inside Claude Code/);
} finally {
  await fs.rm(gstackSetupTarget, { recursive: true, force: true });
}

const gstackHooksSetupTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-hooks-setup-"));
try {
  result = runCli(["setup", "--target", gstackHooksSetupTarget, "--profile", "minimal", "--setup-pipeline", "gstack", "--with-plan-tune-hooks", "--yes", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Plan-tune hooks\s+installed in \.claude\/settings\.json/);
  assert.doesNotMatch(result.stdout, /\.\/setup|~\/\.claude\/settings\.json/);
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
      profile: "minimal",
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
