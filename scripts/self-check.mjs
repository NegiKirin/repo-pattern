import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject, printAudit } from "./lib/audit.mjs";
import { doctorProject } from "./lib/doctor.mjs";
import { applyEccPluginSettings } from "./lib/ecc.mjs";
import { applyMcpValues, mcpSecretPrompt, validateRelativeMcpPath } from "./lib/mcp.mjs";
import { applyAttributionSetting } from "./lib/provision.mjs";
import { printSummary, renderLogo, style } from "./lib/prompt.mjs";
import { formatEccCloneError } from "./lib/rules.mjs";
import { applyOptionalSkills, applyPluginSkillSettings, expectedOptionalSkillDirs, invalidOptionalSkills, normalizeOptionalSkills } from "./lib/skills.mjs";

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
assert.deepEqual(applyAttributionSetting({ hooks: {} }, { mode: "off" }), { hooks: {}, attribution: { commit: "" } });
assert.deepEqual(applyAttributionSetting({ attribution: { commit: "" } }, { mode: "on" }), {});
assert.deepEqual(applyAttributionSetting({ attribution: { pr: "PR" } }, { mode: "custom", commit: "Custom" }), { attribution: { pr: "PR", commit: "Custom" } });
assert.deepEqual(applyEccPluginSettings({ enabledPlugins: { other: false } }).enabledPlugins, { other: false, "ecc@ecc": true });
assert.equal(applyEccPluginSettings().extraKnownMarketplaces.ecc.source.url, "https://github.com/affaan-m/ECC.git");
assert.deepEqual(normalizeOptionalSkills(["taste", "taste", "document-specialist", "ui-ux-pro-max", "impeccable", "huashu-design"]), ["taste", "document-specialist", "ui-ux-pro-max", "impeccable", "huashu-design"]);
assert.deepEqual(invalidOptionalSkills(["taste", "ui-ux-pro-max", "impeccable", "huashu-design", "nope"]), ["nope"]);
assert.deepEqual(applyPluginSkillSettings({}, [{
  source: "https://github.com/Leonxlnx/taste-skill.git",
  plugin: { marketplace: "taste-skill", name: "taste-skill" }
}]), {
  enabledPlugins: { "taste-skill@taste-skill": true },
  extraKnownMarketplaces: {
    "taste-skill": {
      source: {
        source: "git",
        url: "https://github.com/Leonxlnx/taste-skill.git"
      }
    }
  }
});
assert.deepEqual(expectedOptionalSkillDirs([
  {
    name: "ui-ux-pro-max",
    source: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git",
    revision: "4baa399d00da806f83ed93652172f66943205153"
  },
  {
    name: "impeccable",
    source: "https://github.com/pbakaus/impeccable.git",
    revision: "88f52ac4e6a5ce99d39a0f5d89e7ac3a168910f5"
  },
  {
    name: "huashu-design",
    source: "https://github.com/alchaincyf/huashu-design.git",
    revision: "0e7ec8aca0058184c1a9e06e57697e84f68a3f0f"
  }
]), ["huashu-design"]);

const skillTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-skill-"));
const originalSkillLog = console.log;
console.log = () => {};
try {
  await applyOptionalSkills({ target: skillTarget, skills: ["taste"] });
  console.log = originalSkillLog;
  const settings = JSON.parse(await fs.readFile(path.join(skillTarget, ".claude", "settings.local.json"), "utf8"));
  const repoConfig = JSON.parse(await fs.readFile(path.join(skillTarget, ".repo-pattern.json"), "utf8"));
  assert.equal(settings.enabledPlugins["taste-skill@taste-skill"], true);
  assert.equal(settings.extraKnownMarketplaces["taste-skill"].source.url, "https://github.com/Leonxlnx/taste-skill.git");
  assert.equal(repoConfig.runtime.localSkills, false);
  assert.deepEqual(repoConfig.optionalSkills[0].plugin, { marketplace: "taste-skill", name: "taste-skill" });
} finally {
  console.log = originalSkillLog;
  await fs.rm(skillTarget, { recursive: true, force: true });
}

const mixedSkillTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-skill-mixed-"));
console.log = () => {};
try {
  await fs.mkdir(path.join(mixedSkillTarget, ".claude", "skills", "document-specialist-skill"), { recursive: true });
  await fs.writeFile(path.join(mixedSkillTarget, ".claude", "skills", "document-specialist-skill", "KEEP"), "ok", "utf8");
  await fs.writeFile(path.join(mixedSkillTarget, ".repo-pattern.json"), JSON.stringify({
    runtime: { localSkills: true },
    optionalSkills: [{
      name: "document-specialist",
      source: "https://github.com/SpillwaveSolutions/document-specialist-skill.git",
      revision: "4d50d302b9f40e8eafec72d78a86676cdd9511ac",
      license: "NOASSERTION",
      installedDirs: ["document-specialist-skill"]
    }]
  }), "utf8");
  await applyOptionalSkills({ target: mixedSkillTarget, skills: ["taste"] });
  console.log = originalSkillLog;
  const repoConfig = JSON.parse(await fs.readFile(path.join(mixedSkillTarget, ".repo-pattern.json"), "utf8"));
  assert.equal(await fs.readFile(path.join(mixedSkillTarget, ".claude", "skills", "document-specialist-skill", "KEEP"), "utf8"), "ok");
  assert.equal(repoConfig.runtime.localSkills, true);
  assert.deepEqual(repoConfig.optionalSkills.map((entry) => entry.name), ["document-specialist", "taste"]);
} finally {
  console.log = originalSkillLog;
  await fs.rm(mixedSkillTarget, { recursive: true, force: true });
}

async function writeDoctorFixture(target, { appliedRules = ["typescript"], createRuleDirs = true } = {}) {
  await fs.mkdir(path.join(target, ".claude"), { recursive: true });
  await fs.writeFile(path.join(target, ".claude", "settings.json"), JSON.stringify({ hooks: {} }), "utf8");
  await fs.writeFile(path.join(target, ".repo-pattern.json"), JSON.stringify({
    workflow: "ecc-native",
    runtime: {
      localSkills: false,
      localCommands: false,
      localHooks: false,
      localScripts: false,
      localRules: false
    }
  }), "utf8");
  await fs.writeFile(path.join(target, ".repo-pattern.lock.json"), JSON.stringify({
    ecc: {
      status: "not-run",
      rulesSyncedBy: "repo-pattern-auto-cache",
      appliedRules
    }
  }), "utf8");
  if (createRuleDirs) {
    for (const rule of appliedRules) await fs.mkdir(path.join(target, ".claude", "rules", "ecc", rule), { recursive: true });
  }
}

const doctorTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-"));
const originalDoctorLog = console.log;
console.log = () => {};
try {
  await writeDoctorFixture(doctorTarget);
  const audit = await auditProject(doctorTarget);
  assert.deepEqual(audit.eccRulePackDirs, ["typescript"]);
  await doctorProject(doctorTarget);
} finally {
  console.log = originalDoctorLog;
  await fs.rm(doctorTarget, { recursive: true, force: true });
}

const missingRulesTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-missing-"));
console.log = () => {};
try {
  await writeDoctorFixture(missingRulesTarget, { createRuleDirs: false });
  await assert.rejects(() => doctorProject(missingRulesTarget), /Doctor failed/);
} finally {
  console.log = originalDoctorLog;
  await fs.rm(missingRulesTarget, { recursive: true, force: true });
}

const emptyRulesTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-empty-"));
console.log = () => {};
try {
  await writeDoctorFixture(emptyRulesTarget, { appliedRules: [] });
  await assert.rejects(() => doctorProject(emptyRulesTarget), /Doctor failed/);
} finally {
  console.log = originalDoctorLog;
  await fs.rm(emptyRulesTarget, { recursive: true, force: true });
}

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
assert.match(result.stdout, /ui-ux-pro-max/);
assert.match(result.stdout, /impeccable/);
assert.match(result.stdout, /huashu-design/);

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
