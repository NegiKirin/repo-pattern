import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printAudit } from "./lib/audit.mjs";
import { applyMcpValues, mcpSecretPrompt, validateRelativeMcpPath } from "./lib/mcp.mjs";
import { printSummary, renderLogo, style } from "./lib/prompt.mjs";
import { invalidOptionalSkills, normalizeOptionalSkills } from "./lib/skills.mjs";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(cliDir, "repo-pattern.mjs");
const repoRoot = path.dirname(cliDir);

const mcpServers = {
  context7: {
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env: { CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}" }
  },
  filesystem: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
  }
};

assert.equal(validateRelativeMcpPath("src"), true);
assert.equal(validateRelativeMcpPath("."), true);
assert.equal(validateRelativeMcpPath("/home/user/project"), "Use a relative path, not an absolute machine path.");
assert.equal(validateRelativeMcpPath("C:\\Users\\me\\project"), "Use a relative path, not an absolute machine path.");
assert.equal(validateRelativeMcpPath("~/project"), "Use a relative path, not an absolute machine path.");
assert.equal(validateRelativeMcpPath("../secrets"), "Path must not contain '..'.");
assert.equal(
  mcpSecretPrompt({ name: "CONTEXT7_API_KEY", label: "context7: CONTEXT7_API_KEY" }),
  "MCP secret — context7: CONTEXT7_API_KEY (get key: https://context7.com/dashboard)"
);
assert.equal(
  mcpSecretPrompt({ name: "TAVILY_API_KEY", label: "tavily: TAVILY_API_KEY" }),
  "MCP secret — tavily: TAVILY_API_KEY (get key: https://app.tavily.com/home)"
);

assert.deepEqual(applyMcpValues(mcpServers, {
  CONTEXT7_API_KEY: "redacted-key"
}), {
  context7: {
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env: { CONTEXT7_API_KEY: "redacted-key" }
  },
  filesystem: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
  }
});

assert.equal(applyMcpValues(mcpServers).filesystem.args[2], ".");
assert.deepEqual(normalizeOptionalSkills(["taste", "taste", "document-specialist"]), ["taste", "document-specialist"]);
assert.deepEqual(invalidOptionalSkills(["taste", "nope"]), ["nope"]);

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

const logs = [];
const originalLog = console.log;
const originalStdinIsTty = process.stdin.isTTY;
const originalStdoutIsTty = process.stdout.isTTY;
console.log = (message = "") => logs.push(String(message));
process.stdin.isTTY = false;
process.stdout.isTTY = false;
try {
  printSummary("MCP generated", [
    ["Enabled servers", "context7, filesystem, playwright, chrome-devtools, gitnexus, tavily, sequential-thinking"]
  ]);
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

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: repoRoot, encoding: "utf8" });
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

result = runCli(["help"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /--with-skill <name>/);

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

console.log("self-check passed");
