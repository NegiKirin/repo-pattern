import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject, printAudit } from "./lib/audit.mjs";
import { cleanupProject } from "./lib/cleanup.mjs";
import { doctorProject } from "./lib/doctor.mjs";
import { ECC_PLUGIN, applyEccPluginSettings, setupEcc } from "./lib/ecc.mjs";
import { ensureBun, gstackEnvironment, gstackSummaryRows, isValidBunInstaller, removeEccPluginSettings, runGstackSetup, setupGstack } from "./lib/gstack.mjs";
import { applyMcpValues, generateMcp, mcpSecretPrompt, persistedMcpValues, readGeneratedMcpValues, validateRelativeMcpPath } from "./lib/mcp.mjs";
import { applyAttributionSetting, applyLocalSettings, applyPermissionSettings, provisionProject, reconcileLocalPluginSettings, setupPipelineScope, updateClaudePermissions } from "./lib/provision.mjs";
import { writePrivateJson } from "./lib/fs-utils.mjs";
import { printSummary, renderLogo, style } from "./lib/prompt.mjs";
import { needsLocalSettingsPrompt, setupProject, setupRetryOptions } from "./lib/setup.mjs";
import { applyEccRules, formatEccCloneError } from "./lib/rules.mjs";
import { applyOptionalSkills, applyPluginSkillSettings, expectedOptionalSkillDirs, invalidOptionalSkills, normalizeOptionalSkills, OPTIONAL_SKILLS } from "./lib/skills.mjs";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(cliDir, "repo-pattern.mjs");
const repoRoot = path.dirname(cliDir);
const secretSentinel = "do-not-persist-anthropic-token";
const sharedSettingsTemplate = JSON.parse(await fs.readFile(path.join(repoRoot, ".claude.example", "settings.example.json"), "utf8"));
const localSettingsTemplate = JSON.parse(await fs.readFile(path.join(repoRoot, ".claude.example", "settings.local.example.json"), "utf8"));

assert.deepEqual(sharedSettingsTemplate.attribution, { commit: "", pr: "" });
assert.equal("enabledPlugins" in sharedSettingsTemplate, false);
assert.equal("extraKnownMarketplaces" in sharedSettingsTemplate, false);
assert.equal("attribution" in localSettingsTemplate, false);
assert.deepEqual(localSettingsTemplate.enabledPlugins, {});
assert.deepEqual(localSettingsTemplate.extraKnownMarketplaces, {});
assert.equal(localSettingsTemplate.workflowSizeGuideline, "small");
assert.deepEqual({
  CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: localSettingsTemplate.env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION,
  CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: localSettingsTemplate.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY
}, {
  CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "4",
  CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: "2"
});
assert.equal("workflowSizeGuideline" in localSettingsTemplate.env, false);

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
assert.deepEqual(applyMcpValues({
  unexpected: { env: { ANTHROPIC_AUTH_TOKEN: "${ANTHROPIC_AUTH_TOKEN}" } }
}, {
  ANTHROPIC_AUTH_TOKEN: secretSentinel
}), {
  unexpected: { env: { ANTHROPIC_AUTH_TOKEN: "${ANTHROPIC_AUTH_TOKEN}" } }
});
assert.deepEqual(persistedMcpValues({
  CONTEXT7_API_KEY: "context7-key",
  TAVILY_API_KEY: "tavily-key",
  ANTHROPIC_AUTH_TOKEN: secretSentinel,
  OTHER_API_KEY: "other-key"
}), {
  CONTEXT7_API_KEY: "context7-key",
  TAVILY_API_KEY: "tavily-key"
});
assert.deepEqual(applyLocalSettings({ env: {
  EXISTING: "kept",
  CONTEXT7_API_KEY: "stale-context7-key"
} }, {
  ANTHROPIC_BASE_URL: "https://example.com/v1",
  ANTHROPIC_AUTH_TOKEN: secretSentinel,
  TAVILY_API_KEY: "stale-tavily-key"
}), {
  env: {
    EXISTING: "kept",
    ANTHROPIC_BASE_URL: "https://example.com/v1",
    ANTHROPIC_AUTH_TOKEN: secretSentinel
  }
});
assert.deepEqual(applyAttributionSetting({ hooks: {} }, { mode: "off" }), { hooks: {}, attribution: { commit: "", pr: "" } });
assert.deepEqual(applyAttributionSetting({ attribution: { commit: "old", pr: "old" } }, { mode: "on" }), { attribution: { commit: "", pr: "" } });
assert.deepEqual(applyAttributionSetting({ attribution: { pr: "PR" } }, { mode: "custom", commit: "Custom" }), { attribution: { commit: "Custom", pr: "" } });
assert.deepEqual(reconcileLocalPluginSettings({
  env: { ANTHROPIC_AUTH_TOKEN: secretSentinel },
  custom: true,
  attribution: { commit: "legacy" },
  enabledPlugins: { "ecc@ecc": true, "taste-skill@taste-skill": true, "unknown@plugin": true },
  extraKnownMarketplaces: { ecc: ECC_PLUGIN.marketplace, "taste-skill": { source: { source: "git", url: "https://example.com/stale.git" } }, unknown: { source: { source: "git", url: "https://example.com/unknown.git" } } }
}, { setupPipeline: "gstack", optionalSkills: [] }), {
  env: { ANTHROPIC_AUTH_TOKEN: secretSentinel },
  custom: true,
  enabledPlugins: { "unknown@plugin": true },
  extraKnownMarketplaces: { unknown: { source: { source: "git", url: "https://example.com/unknown.git" } } }
});
assert.deepEqual(reconcileLocalPluginSettings({ enabledPlugins: { "unknown@plugin": true }, extraKnownMarketplaces: {} }, { setupPipeline: "both", optionalSkills: ["impeccable"] }).enabledPlugins, {
  "unknown@plugin": true,
  "ecc@ecc": true,
  "impeccable@impeccable": true
});
assert.deepEqual(applyPermissionSettings({ permissions: { deny: ["Read(.env)"] } }, { bypass: "allow" }), {
  permissions: { deny: ["Read(.env)"], defaultMode: "bypassPermissions" }
});
assert.deepEqual(applyPermissionSettings({ permissions: { defaultMode: "bypassPermissions" } }, { bypass: "deny" }), {
  permissions: { defaultMode: "default", disableBypassPermissionsMode: "disable" }
});
assert.deepEqual(setupRetryOptions({
  action: "setup",
  setupPipeline: "gstack",
  mcpConfig: { profile: "web", mcpServers: null },
  mcpValues: {
    CONTEXT7_API_KEY: "secret",
    ANTHROPIC_AUTH_TOKEN: secretSentinel
  },
  ruleConfig: { applyRules: false, ruleMode: "auto", rules: [] },
  optionalSkills: ["nextjs-pattern"],
  localSettingsEnv: {
    ANTHROPIC_BASE_URL: "https://example.com/v1",
    ANTHROPIC_AUTH_TOKEN: secretSentinel,
    CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "5",
    CONTEXT7_API_KEY: "context7-key",
    TAVILY_API_KEY: "tavily-key"
  },
  attributionConfig: { mode: "off" },
  dryRun: false
}), {
  action: "setup",
  setupPipeline: "gstack",
  planTuneHooks: false,
  profile: "web",
  mcpServers: null,
  mcpValueNames: ["CONTEXT7_API_KEY"],
  migrate: false,
  applyRules: false,
  ruleMode: "auto",
  rules: [],
  optionalSkills: ["nextjs-pattern"],
  localSettingsEnv: {
    ANTHROPIC_BASE_URL: "https://example.com/v1",
    CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "5"
  },
  attributionConfig: { mode: "off" },
  permissionConfig: { bypass: "deny" },
  dryRun: false
});
assert.deepEqual({
  ecc: setupPipelineScope("ecc"),
  gstack: setupPipelineScope("gstack"),
  both: setupPipelineScope("both"),
  none: setupPipelineScope("none")
}, {
  ecc: "project-scoped ECC",
  gstack: "user-scoped/global gstack at ~/.claude/skills/gstack",
  both: "project-scoped ECC + user-scoped/global gstack at ~/.claude/skills/gstack",
  none: "writes only base project metadata"
});
assert.equal(needsLocalSettingsPrompt({ ANTHROPIC_BASE_URL: "https://example.com/v1" }), true);
assert.equal(needsLocalSettingsPrompt({
  CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "0",
  ANTHROPIC_AUTH_TOKEN: secretSentinel,
  ANTHROPIC_BASE_URL: "https://example.com/v1",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5"
}), false);
assert.equal(needsLocalSettingsPrompt({
  ANTHROPIC_AUTH_TOKEN: " ",
  ANTHROPIC_BASE_URL: "https://example.com/v1",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5"
}), true);
assert.equal(needsLocalSettingsPrompt({
  ANTHROPIC_AUTH_TOKEN: secretSentinel,
  ANTHROPIC_BASE_URL: "not-a-url",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5"
}), true);
assert.equal(needsLocalSettingsPrompt({
  ANTHROPIC_AUTH_TOKEN: secretSentinel,
  ANTHROPIC_BASE_URL: "https://example.com/v1",
  CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "5",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5"
}), false);
assert.deepEqual(applyEccPluginSettings({ enabledPlugins: { other: false } }).enabledPlugins, { other: false, "ecc@ecc": true });
assert.equal(applyEccPluginSettings().extraKnownMarketplaces.ecc.source.url, "https://github.com/affaan-m/ECC.git");
const optionalSkillValues = OPTIONAL_SKILLS.map((skill) => skill.value);
assert.deepEqual(normalizeOptionalSkills(["taste", ...optionalSkillValues]), optionalSkillValues);
assert.deepEqual(invalidOptionalSkills([...optionalSkillValues, "nope"]), ["nope"]);
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
  },
  {
    name: "nextjs-pattern",
    source: "https://github.com/NegiKirin/nextjs-pattern.git",
    revision: "d5b1ac4ea33f6054841ed9d8005ac587ab2a9a5d"
  },
  {
    name: "fastapi-pattern",
    source: "https://github.com/NegiKirin/fastapi-pattern.git",
    revision: "3abf484af46765c01a476b2ef61bb211b2b5bab8"
  },
  {
    name: "herdr",
    source: "https://github.com/ogulcancelik/herdr.git",
    revision: "9450b168c727e9e4cbee95e6edf4f11cfe6f2154"
  }
]), ["fastapi-pattern", "herdr", "huashu-design", "nextjs-pattern"]);

const skillTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-skill-"));
const originalSkillLog = console.log;
console.log = () => {};
try {
  await applyOptionalSkills({ target: skillTarget, skills: ["taste"] });
  console.log = originalSkillLog;
  const settings = JSON.parse(await fs.readFile(path.join(skillTarget, ".claude", "settings.local.json"), "utf8"));
  const repoConfig = JSON.parse(await fs.readFile(path.join(skillTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
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
  await fs.mkdir(path.join(mixedSkillTarget, ".repo-pattern"), { recursive: true });
  await fs.writeFile(path.join(mixedSkillTarget, ".claude", "skills", "document-specialist-skill", "KEEP"), "ok", "utf8");
  await fs.writeFile(path.join(mixedSkillTarget, ".repo-pattern", ".repo-pattern.json"), JSON.stringify({
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
  let repoConfig = JSON.parse(await fs.readFile(path.join(mixedSkillTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  assert.equal(await fs.readFile(path.join(mixedSkillTarget, ".claude", "skills", "document-specialist-skill", "KEEP"), "utf8"), "ok");
  assert.equal(repoConfig.runtime.localSkills, true);
  assert.deepEqual(repoConfig.optionalSkills.map((entry) => entry.name), ["document-specialist", "taste"]);

  await fs.rename(
    path.join(mixedSkillTarget, ".repo-pattern", ".repo-pattern.json"),
    path.join(mixedSkillTarget, ".repo-pattern.json")
  );
  await provisionProject({
    sourceRoot: repoRoot,
    target: mixedSkillTarget,
    profile: "minimal",
    setupPipeline: "none",
    applyRules: false
  });
  console.log = originalSkillLog;
  repoConfig = JSON.parse(await fs.readFile(path.join(mixedSkillTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  await assert.rejects(() => fs.access(path.join(mixedSkillTarget, ".claude", "skills", "document-specialist-skill")), { code: "ENOENT" });
  assert.equal(repoConfig.runtime.localSkills, false);
  assert.deepEqual(repoConfig.optionalSkills, []);
} finally {
  console.log = originalSkillLog;
  await fs.rm(mixedSkillTarget, { recursive: true, force: true });
}

const dryRunRootCopyTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-skill-dry-run-"));
const dryRunSkillLogs = [];
console.log = (message = "") => dryRunSkillLogs.push(String(message));
try {
  await applyOptionalSkills({ target: dryRunRootCopyTarget, skills: ["nextjs-pattern"], dryRun: true });
  assert(dryRunSkillLogs.some((line) => line.includes(".claude/skills/nextjs-pattern")));
} finally {
  console.log = originalSkillLog;
  await fs.rm(dryRunRootCopyTarget, { recursive: true, force: true });
}

const herdrSkill = OPTIONAL_SKILLS.find((skill) => skill.value === "herdr");
assert.deepEqual(herdrSkill.includePaths, ["SKILL.md"]);
assert.equal(herdrSkill.destName, "herdr");

async function writeDoctorFixture(target, { appliedRules = ["typescript"], createRuleDirs = true } = {}) {
  await fs.mkdir(path.join(target, ".claude"), { recursive: true });
  await fs.mkdir(path.join(target, ".repo-pattern"), { recursive: true });
  await fs.writeFile(path.join(target, ".claude", "settings.json"), JSON.stringify({ hooks: {} }), "utf8");
  await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.json"), JSON.stringify({
    workflow: "ecc-native",
    runtime: {
      localSkills: false,
      localCommands: false,
      localHooks: false,
      localScripts: false,
      localRules: false
    }
  }), "utf8");
  await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), JSON.stringify({
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

const pythonRulesTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-python-rules-"));
console.log = () => {};
try {
  await fs.mkdir(path.join(pythonRulesTarget, ".claude"), { recursive: true });
  await fs.writeFile(path.join(pythonRulesTarget, "pyproject.toml"), "", "utf8");
  await fs.writeFile(path.join(pythonRulesTarget, ".claude", "CLAUDE.md"), "Existing guidance\n", "utf8");
  for (const rule of ["common", "python"]) {
    await fs.mkdir(path.join(pythonRulesTarget, ".repo-pattern", "cache", "ECC", "rules", rule), { recursive: true });
  }
  await applyEccRules({ target: pythonRulesTarget });
  let claudeMd = await fs.readFile(path.join(pythonRulesTarget, ".claude", "CLAUDE.md"), "utf8");
  assert.match(claudeMd, /`uv run` owns `\.venv`/);
  assert.match(claudeMd, /Existing guidance/);

  for (const rule of ["common", "python"]) {
    await fs.mkdir(path.join(pythonRulesTarget, ".repo-pattern", "cache", "ECC", "rules", rule), { recursive: true });
  }
  await applyEccRules({ target: pythonRulesTarget });
  claudeMd = await fs.readFile(path.join(pythonRulesTarget, ".claude", "CLAUDE.md"), "utf8");
  assert.equal(claudeMd.split("<!-- USE UV:Start -->").length - 1, 1);
} finally {
  console.log = originalDoctorLog;
  await fs.rm(pythonRulesTarget, { recursive: true, force: true });
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
  printAudit({
    target: "/tmp/project",
    state: "LEGACY_VENDOR",
    hasClaudeRulesDir: true,
    hasClaudeEccRulesDir: true,
    hasOnlyEccRulesDir: true,
    repoPattern: { workflow: "gstack" }
  });
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
assert.match(result.stdout, /gstack: user-scoped\/global at ~\/\.claude\/skills\/gstack/);
assert.match(result.stdout, /both: project-scoped ECC \+ user-scoped\/global gstack/);
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
  result = runCli(["setup", "--target", setupReuseTarget, "--profile", "minimal", "--setup-pipeline", "ecc", "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(await fs.readFile(path.join(setupReuseTarget, ".mcp.json"), "utf8"), /persisted-setup-key/);
  assert.equal(JSON.parse(await fs.readFile(path.join(setupReuseTarget, ".repo-pattern", ".repo-pattern.json"), "utf8")).workflow, "ecc-native");
} finally {
  await fs.rm(setupReuseTarget, { recursive: true, force: true });
}

const gstackSetupTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-setup-"));
try {
  result = runCli(["setup", "--target", gstackSetupTarget, "--profile", "minimal", "--setup-pipeline", "gstack", "--yes", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Checking gstack prerequisites/);
  assert.match(result.stdout, /Cloning gstack|Using existing gstack checkout/);
  assert.match(result.stdout, /Running gstack setup/);
  assert.match(result.stdout, /\.\/setup --quiet --no-plan-tune-hooks/);
  assert.match(result.stdout, /Pipeline scope\s+user-scoped\/global gstack at ~\/\.claude\/skills\/gstack/);
  assert.doesNotMatch(result.stdout, /Install ECC inside Claude Code/);
} finally {
  await fs.rm(gstackSetupTarget, { recursive: true, force: true });
}

const gstackHooksSetupTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-hooks-setup-"));
try {
  result = runCli(["setup", "--target", gstackHooksSetupTarget, "--profile", "minimal", "--setup-pipeline", "gstack", "--with-plan-tune-hooks", "--yes", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\.\/setup --quiet --plan-tune-hooks/);
  assert.match(result.stdout, /Plan-tune hooks\s+installed in ~\/\.claude\/settings\.json/);
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

const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
const gitignore = await fs.readFile(path.join(repoRoot, ".gitignore"), "utf8");
const gitignoreLines = gitignore.split(/\r?\n/);
assert(!packageJson.files.includes(".repo-pattern.lock.json"));
assert(!packageJson.files.includes(".repo-pattern.json"));
assert(packageJson.files.includes(".repo-pattern.example.json"));
assert(packageJson.files.includes(".claude.example/CLAUDE.md"));
assert(packageJson.files.includes(".claude.example/settings.example.json"));
assert(packageJson.files.includes(".claude.example/settings.local.example.json"));
assert(!packageJson.files.some((file) => file.startsWith(".claude/")));
assert(gitignoreLines.includes(".repo-pattern/"));
assert(!gitignoreLines.includes(".repo-pattern.json"));
assert(!gitignoreLines.includes(".repo-pattern.lock.json"));
assert(gitignoreLines.includes(".claude/"));

assert.deepEqual(gstackEnvironment("bun", { PATH: "/usr/bin" }), { PATH: "/usr/bin" });
assert.deepEqual(gstackEnvironment("/home/test/.bun/bin/bun", { PATH: "/usr/bin" }), { PATH: `/home/test/.bun/bin${path.delimiter}/usr/bin` });
assert.deepEqual(gstackSummaryRows(), [
  ["Scope", "user-global ~/.claude/skills/gstack"],
  ["Plan-tune hooks", "not installed"],
  ["Status", "ready"]
]);
assert.deepEqual(gstackSummaryRows(true), [
  ["Scope", "user-global ~/.claude/skills/gstack"],
  ["Plan-tune hooks", "installed in ~/.claude/settings.json"],
  ["Status", "ready"]
]);

const gstackSetupCalls = [];
const gstackSetupLogs = [];
runGstackSetup({
  platform: "linux",
  bun: "bun",
  run(command, args, options) {
    gstackSetupCalls.push({ command, args, options });
    return "generated skill output\ninstallation detail\n";
  },
  log: (message) => gstackSetupLogs.push(message)
});
assert.deepEqual(gstackSetupCalls[0].args, ["--quiet", "--no-plan-tune-hooks"]);
assert.deepEqual(gstackSetupCalls[0].options.stdio, ["ignore", "pipe", "pipe"]);
assert.deepEqual(gstackSetupLogs, []);

runGstackSetup({
  platform: "linux",
  bun: "bun",
  planTuneHooks: true,
  run(command, args) {
    gstackSetupCalls.push({ command, args });
  }
});
assert.deepEqual(gstackSetupCalls[1].args, ["--quiet", "--plan-tune-hooks"]);

const gstackCredentialFixture = ["example", "credential", "value"].join("-");
const gstackFailure = Object.assign(new Error("setup failed"), {
  stdout: Buffer.from("routine output\n"),
  stderr: Buffer.from(`${"warning: repeated diagnostic line\n".repeat(300)}fatal: setup could not complete\nAuthorization: Bearer ${gstackCredentialFixture}\nAPI_TOKEN=${gstackCredentialFixture}\ncorrect the prerequisite and retry\n`)
});
let gstackFailureLog = "";
assert.throws(() => runGstackSetup({
  platform: "win32",
  bun: "bun",
  run(command, args) {
    assert.equal(command, "bash");
    assert.deepEqual(args, ["./setup", "--quiet", "--no-plan-tune-hooks"]);
    throw gstackFailure;
  },
  log: (message) => { gstackFailureLog += `${message}\n`; }
}), /gstack setup failed; review the diagnostics above and rerun setup/);
assert.match(gstackFailureLog, /Upstream reported a setup failure/);
assert.match(gstackFailureLog, /A required prerequisite is missing or invalid/);
assert.match(gstackFailureLog, /Correct the reported prerequisite and rerun setup/);
assert.match(gstackFailureLog, /Upstream output: \[redacted\]/);
assert.doesNotMatch(gstackFailureLog, /routine output/);
assert.doesNotMatch(gstackFailureLog, /fatal: setup could not complete/);
assert.doesNotMatch(gstackFailureLog, new RegExp(gstackCredentialFixture));
assert(gstackFailureLog.length <= 4200);

const validBunInstaller = Buffer.from(`#!/usr/bin/env bash
set -euo pipefail
install_env=BUN_INSTALL
github_repo="\$GITHUB/oven-sh/bun"
bun_uri=\$github_repo/releases/latest/download/bun-\$target.zip
${"# Bun installer\n".repeat(80)}`);
assert.equal(isValidBunInstaller(validBunInstaller), true);
assert.equal(isValidBunInstaller(Buffer.from("<!doctype html><title>502 Bad Gateway</title>")), false);
assert.equal(isValidBunInstaller(Buffer.from("#!/usr/bin/env bash\nset -euo pipefail\n")), false);

const bunInstallCommands = [];
let bunCheckCount = 0;
let removedBunInstaller = false;
const installedBun = await ensureBun({
  platform: "linux",
  homedir: "/home/test",
  tmpdir: "/tmp",
  run(command, args, options) {
    bunInstallCommands.push({ command, args, options });
    if (command === "bun" && bunCheckCount++ === 0) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    if (command === "/home/test/.bun/bin/bun") return "1.2.0\n";
    return "";
  },
  mkdtemp: async () => "/tmp/repo-pattern-bun-installer",
  readFile: async () => validBunInstaller,
  rm: async () => { removedBunInstaller = true; }
});
assert.equal(installedBun, "/home/test/.bun/bin/bun");
assert.deepEqual(bunInstallCommands[1].args, [
  "--fail", "--show-error", "--silent", "--location",
  "--proto", "=https", "--proto-redir", "=https", "--tlsv1.2",
  "--max-filesize", "1048576", "--output", "/tmp/repo-pattern-bun-installer/install.sh",
  "https://bun.sh/install"
]);
assert.deepEqual(bunInstallCommands[2].args, ["-n", "/tmp/repo-pattern-bun-installer/install.sh"]);
assert.deepEqual(bunInstallCommands[3].args, ["/tmp/repo-pattern-bun-installer/install.sh"]);
assert.equal(removedBunInstaller, true);
await assert.rejects(() => ensureBun({ platform: "win32", run: () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } }), /automatic Bun installation is supported only on Linux and macOS/);
await assert.rejects(() => ensureBun({
  platform: "linux",
  run(command) {
    if (command === "bun") throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return "";
  },
  mkdtemp: async () => "/tmp/repo-pattern-invalid-bun-installer",
  readFile: async () => Buffer.from("<!doctype html><title>502 Bad Gateway</title>"),
  rm: async () => {}
}), /failed content validation/);

const failedGstackTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-failed-"));
console.log = () => {};
try {
  const localSettingsPath = path.join(failedGstackTarget, ".claude", "settings.local.json");
  await fs.mkdir(path.dirname(localSettingsPath));
  await fs.writeFile(localSettingsPath, JSON.stringify({
    env: { ANTHROPIC_AUTH_TOKEN: secretSentinel },
    enabledPlugins: { "ecc@ecc": true }
  }), { mode: 0o600 });
  process.env.REPO_PATTERN_GSTACK_SETUP_CMD = "false";
  await assert.rejects(() => setupGstack({ target: failedGstackTarget }), /Command failed/);
  assert.match(await fs.readFile(localSettingsPath, "utf8"), /ecc@ecc/);
} finally {
  delete process.env.REPO_PATTERN_GSTACK_SETUP_CMD;
  console.log = originalLog;
  await fs.rm(failedGstackTarget, { recursive: true, force: true });
}

const failedGstackProvisionTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-failed-provision-"));
console.log = () => {};
try {
  const localSettingsPath = path.join(failedGstackProvisionTarget, ".claude", "settings.local.json");
  await fs.mkdir(path.dirname(localSettingsPath));
  await fs.writeFile(localSettingsPath, JSON.stringify({
    env: { ANTHROPIC_AUTH_TOKEN: "existing-token" },
    enabledPlugins: { "ecc@ecc": true }
  }), { mode: 0o600 });
  const existingRulePath = path.join(failedGstackProvisionTarget, ".claude", "rules", "ecc", "existing.md");
  await fs.mkdir(path.dirname(existingRulePath), { recursive: true });
  await fs.writeFile(existingRulePath, "existing rule\n", "utf8");
  await fs.mkdir(path.join(failedGstackProvisionTarget, ".claude", "commands"));
  process.env.REPO_PATTERN_GSTACK_SETUP_CMD = "false";
  await assert.rejects(() => provisionProject({
    sourceRoot: repoRoot,
    target: failedGstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "gstack",
    localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: "replacement-token" },
    migrate: true
  }), /Command failed/);
  const localSettings = await fs.readFile(localSettingsPath, "utf8");
  assert.match(localSettings, /ecc@ecc/);
  assert.match(localSettings, /existing-token/);
  assert.equal(await fs.readFile(existingRulePath, "utf8"), "existing rule\n");
  process.env.REPO_PATTERN_GSTACK_SETUP_CMD = "true";
  await provisionProject({
    sourceRoot: repoRoot,
    target: failedGstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "gstack",
    localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: "replacement-token" },
    migrate: true
  });
  assert.equal((await auditProject(failedGstackProvisionTarget)).state, "GSTACK_MINIMAL");
  assert.match(await fs.readFile(localSettingsPath, "utf8"), /replacement-token/);
} finally {
  delete process.env.REPO_PATTERN_GSTACK_SETUP_CMD;
  console.log = originalLog;
  await fs.rm(failedGstackProvisionTarget, { recursive: true, force: true });
}

const trackedGstackSettingsTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-tracked-settings-"));
console.log = () => {};
try {
  spawnSync("git", ["init"], { cwd: trackedGstackSettingsTarget, stdio: "ignore" });
  await fs.mkdir(path.join(trackedGstackSettingsTarget, ".claude"));
  const localSettingsPath = path.join(trackedGstackSettingsTarget, ".claude", "settings.local.json");
  await fs.writeFile(localSettingsPath, JSON.stringify({ enabledPlugins: { "ecc@ecc": true } }), { mode: 0o600 });
  spawnSync("git", ["add", ".claude/settings.local.json"], { cwd: trackedGstackSettingsTarget, stdio: "ignore" });
  process.env.REPO_PATTERN_GSTACK_SETUP_CMD = "true";
  await assert.rejects(() => setupGstack({ target: trackedGstackSettingsTarget }), /settings\.local\.json is tracked/);
  await assert.rejects(() => removeEccPluginSettings({ target: trackedGstackSettingsTarget }), /settings\.local\.json is tracked/);
  assert.match(await fs.readFile(localSettingsPath, "utf8"), /ecc@ecc/);
} finally {
  delete process.env.REPO_PATTERN_GSTACK_SETUP_CMD;
  console.log = originalLog;
  await fs.rm(trackedGstackSettingsTarget, { recursive: true, force: true });
}

const incompleteGstackTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-incomplete-"));
console.log = () => {};
try {
  await fs.mkdir(path.join(incompleteGstackTarget, ".claude"));
  await fs.mkdir(path.join(incompleteGstackTarget, ".repo-pattern"));
  await fs.writeFile(path.join(incompleteGstackTarget, ".repo-pattern", ".repo-pattern.json"), JSON.stringify({
    workflow: "gstack",
    runtime: { localSkills: false, localCommands: false, localHooks: false, localScripts: false, localRules: false }
  }));
  await fs.writeFile(path.join(incompleteGstackTarget, ".repo-pattern", ".repo-pattern.lock.json"), JSON.stringify({
    gstack: { status: "not-run" }
  }));
  assert.equal((await auditProject(incompleteGstackTarget)).state, "PARTIAL");
  await assert.rejects(() => doctorProject(incompleteGstackTarget), /Doctor failed/);
} finally {
  console.log = originalLog;
  await fs.rm(incompleteGstackTarget, { recursive: true, force: true });
}

await assert.rejects(
  () => setupProject({ sourceRoot: repoRoot, target: os.tmpdir(), setupPipeline: "invalid", yes: true }),
  /Unknown setup pipeline: invalid/
);
await assert.rejects(
  () => provisionProject({ sourceRoot: repoRoot, target: os.tmpdir(), setupPipeline: "invalid", dryRun: true }),
  /Unknown setup pipeline: invalid/
);
await assert.rejects(
  () => provisionProject({ sourceRoot: repoRoot, target: os.tmpdir(), setupPipeline: "ecc", planTuneHooks: true, dryRun: true }),
  /--with-plan-tune-hooks requires --setup-pipeline gstack or both/
);

const bothProvisionTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-both-provision-"));
console.log = () => {};
try {
  process.env.REPO_PATTERN_ECC_SETUP_CMD = "true";
  process.env.REPO_PATTERN_GSTACK_SETUP_CMD = "true";
  await provisionProject({
    sourceRoot: repoRoot,
    target: bothProvisionTarget,
    profile: "minimal",
    setupPipeline: "both",
    planTuneHooks: true,
    localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: secretSentinel }
  });
  const repoConfig = JSON.parse(await fs.readFile(path.join(bothProvisionTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  const lock = JSON.parse(await fs.readFile(path.join(bothProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  const localSettings = JSON.parse(await fs.readFile(path.join(bothProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  assert.equal(repoConfig.workflow, "ecc-gstack");
  assert.equal(lock.setupPipeline, "both");
  assert.equal(lock.ecc.status, "installed");
  assert.equal(lock.gstack.status, "installed");
  assert.equal(lock.gstack.planTuneHooks, true);
  assert.equal(localSettings.enabledPlugins["ecc@ecc"], true);
  assert.equal(localSettings.extraKnownMarketplaces.ecc.source.url, "https://github.com/affaan-m/ECC.git");
  assert.equal((await auditProject(bothProvisionTarget)).state, "ECC_GSTACK_MINIMAL");
  await doctorProject(bothProvisionTarget);
} finally {
  delete process.env.REPO_PATTERN_ECC_SETUP_CMD;
  delete process.env.REPO_PATTERN_GSTACK_SETUP_CMD;
  console.log = originalLog;
  await fs.rm(bothProvisionTarget, { recursive: true, force: true });
}

const noPipelineProvisionTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-none-provision-"));
console.log = () => {};
try {
  await provisionProject({
    sourceRoot: repoRoot,
    target: noPipelineProvisionTarget,
    profile: "minimal",
    setupPipeline: "none",
    localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: secretSentinel },
    applyRules: true
  });
  const repoConfig = JSON.parse(await fs.readFile(path.join(noPipelineProvisionTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  const lock = JSON.parse(await fs.readFile(path.join(noPipelineProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  const localSettings = JSON.parse(await fs.readFile(path.join(noPipelineProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  assert.equal(repoConfig.workflow, "none");
  assert.equal(lock.setupPipeline, "none");
  assert.deepEqual(lock.ecc.appliedRules, ["common"]);
  assert.equal("gstack" in lock, false);
  assert.equal(localSettings.enabledPlugins["ecc@ecc"], undefined);
  assert.equal((await auditProject(noPipelineProvisionTarget)).state, "NO_PIPELINE_MINIMAL");
  await doctorProject(noPipelineProvisionTarget);
} finally {
  console.log = originalLog;
  await fs.rm(noPipelineProvisionTarget, { recursive: true, force: true });
}

const setupBothDryRunTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-both-dry-run-"));
try {
  result = runCli(["setup", "--target", setupBothDryRunTarget, "--setup-pipeline", "both", "--yes", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Setup pipeline\s+both/);
  assert.match(result.stdout, /Pipeline scope\s+project-scoped ECC \+ user-scoped\/global gstack at\s+~\/\.claude\/skills\/gstack/);
} finally {
  await fs.rm(setupBothDryRunTarget, { recursive: true, force: true });
}

result = runCli(["setup", "--setup-pipeline", "none", "--with-rules", "--yes", "--dry-run"]);
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /Selected ECC rules/);
assert.match(result.stdout, /Applied ECC rules/);

result = runCli(["setup", "--setup-pipeline", "gstack", "--with-rules", "--yes", "--dry-run"]);
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /Selected ECC rules/);
assert.match(result.stdout, /Applied ECC rules/);

const gstackProvisionTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-provision-"));
console.log = () => {};
try {
  await fs.mkdir(path.join(gstackProvisionTarget, ".claude", "rules", "ecc", "typescript"), { recursive: true });
  await fs.writeFile(path.join(gstackProvisionTarget, ".claude", "settings.local.json"), JSON.stringify({
    workflowSizeGuideline: "large",
    custom: true,
    attribution: { commit: "legacy", pr: "legacy" },
    env: { ANTHROPIC_AUTH_TOKEN: secretSentinel },
    enabledPlugins: {
      "ecc@ecc": true,
      "taste-skill@taste-skill": true,
      "unknown@plugin": true
    },
    extraKnownMarketplaces: {
      ecc: { source: { source: "git", url: "https://github.com/affaan-m/ECC.git" } },
      "taste-skill": { source: { source: "git", url: "https://example.com/taste.git" } },
      unknown: { source: { source: "git", url: "https://example.com/unknown.git" } }
    }
  }), { mode: 0o600 });
  process.env.REPO_PATTERN_GSTACK_SETUP_CMD = "true";
  await provisionProject({
    sourceRoot: repoRoot,
    target: gstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "gstack",
    applyRules: true
  });
  const repoConfig = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  const lock = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  assert.equal(repoConfig.workflow, "gstack");
  assert.equal(repoConfig.ecc.rulesSync, "repo-pattern-auto-cache");
  assert.equal(lock.setupPipeline, "gstack");
  assert.equal(lock.gstack.status, "installed");
  assert.equal(lock.gstack.planTuneHooks, false);
  assert.deepEqual(lock.ecc.appliedRules, ["common"]);
  const gstackLocalSettings = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  assert.equal(gstackLocalSettings.enabledPlugins["ecc@ecc"], undefined);
  assert.equal(gstackLocalSettings.enabledPlugins["taste-skill@taste-skill"], undefined);
  assert.equal(gstackLocalSettings.enabledPlugins["unknown@plugin"], true);
  assert.equal(gstackLocalSettings.extraKnownMarketplaces.ecc, undefined);
  assert.equal(gstackLocalSettings.extraKnownMarketplaces["taste-skill"], undefined);
  assert.equal(gstackLocalSettings.extraKnownMarketplaces.unknown.source.url, "https://example.com/unknown.git");
  assert.equal("attribution" in gstackLocalSettings, false);
  assert.equal(gstackLocalSettings.custom, true);
  assert.equal(gstackLocalSettings.workflowSizeGuideline, "large");
  assert.equal(gstackLocalSettings.env.ANTHROPIC_AUTH_TOKEN, secretSentinel);
  await fs.access(path.join(gstackProvisionTarget, ".claude", "rules", "ecc", "common"));
  assert.equal((await auditProject(gstackProvisionTarget)).state, "GSTACK_MINIMAL");
  await doctorProject(gstackProvisionTarget);

  await provisionProject({
    sourceRoot: repoRoot,
    target: gstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "both",
    optionalSkills: ["nextjs-pattern"],
    applyRules: false
  });
  await fs.access(path.join(gstackProvisionTarget, ".claude", "skills", "nextjs-pattern"));

  await provisionProject({
    sourceRoot: repoRoot,
    target: gstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "both",
    optionalSkills: ["impeccable"],
    applyRules: false
  });
  await assert.rejects(() => fs.access(path.join(gstackProvisionTarget, ".claude", "skills", "nextjs-pattern")), { code: "ENOENT" });
  const reconciledLocalSettings = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  const reconciledLock = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  assert.equal(reconciledLocalSettings.enabledPlugins["ecc@ecc"], true);
  assert.equal(reconciledLocalSettings.enabledPlugins["taste-skill@taste-skill"], undefined);
  assert.equal(reconciledLocalSettings.enabledPlugins["impeccable@impeccable"], true);
  assert.equal(reconciledLocalSettings.enabledPlugins["unknown@plugin"], true);
  assert.equal(reconciledLocalSettings.extraKnownMarketplaces["taste-skill"], undefined);
  assert.equal(reconciledLocalSettings.extraKnownMarketplaces.impeccable.source.url, "https://github.com/pbakaus/impeccable.git");
  assert.equal(reconciledLocalSettings.extraKnownMarketplaces.unknown.source.url, "https://example.com/unknown.git");
  assert.equal(reconciledLocalSettings.env.ANTHROPIC_AUTH_TOKEN, secretSentinel);
  assert.equal(reconciledLock.ecc.appliedRules.length, 0);
  await assert.rejects(() => fs.access(path.join(gstackProvisionTarget, ".claude", "rules", "ecc", "common")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(path.join(gstackProvisionTarget, ".claude", "rules")), { code: "ENOENT" });

  await provisionProject({
    sourceRoot: repoRoot,
    target: gstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "gstack",
    optionalSkills: [],
    applyRules: false
  });
  const deselectedLocalSettings = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  const deselectedConfig = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  const deselectedLock = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  assert.deepEqual(deselectedConfig.optionalSkills, []);
  assert.equal(deselectedConfig.runtime.localSkills, false);
  assert.deepEqual(deselectedLock.optionalSkills.appliedSkills, []);
  assert.equal(deselectedLocalSettings.enabledPlugins["ecc@ecc"], undefined);
  assert.equal(deselectedLocalSettings.enabledPlugins["impeccable@impeccable"], undefined);
  assert.equal(deselectedLocalSettings.enabledPlugins["unknown@plugin"], true);

  const idempotentSnapshot = JSON.stringify({
    settings: deselectedLocalSettings,
    config: deselectedConfig,
    appliedSkills: deselectedLock.optionalSkills.appliedSkills,
    appliedRules: deselectedLock.ecc?.appliedRules || []
  });
  await provisionProject({
    sourceRoot: repoRoot,
    target: gstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "gstack",
    optionalSkills: [],
    applyRules: false
  });
  const idempotentSettings = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  const idempotentConfig = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  const idempotentLock = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  assert.equal(JSON.stringify({
    settings: idempotentSettings,
    config: idempotentConfig,
    appliedSkills: idempotentLock.optionalSkills.appliedSkills,
    appliedRules: idempotentLock.ecc?.appliedRules || []
  }), idempotentSnapshot);
} finally {
  delete process.env.REPO_PATTERN_GSTACK_SETUP_CMD;
  console.log = originalLog;
  await fs.rm(gstackProvisionTarget, { recursive: true, force: true });
}

const unrelatedRulesTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-unrelated-rules-"));
console.log = () => {};
try {
  await provisionProject({
    sourceRoot: repoRoot,
    target: unrelatedRulesTarget,
    profile: "minimal",
    setupPipeline: "none",
    applyRules: false
  });
  const unrelatedRulePath = path.join(unrelatedRulesTarget, ".claude", "rules", "third-party", "rule.md");
  const unrelatedSkillPath = path.join(unrelatedRulesTarget, ".claude", "skills", "third-party", "SKILL.md");
  await fs.mkdir(path.dirname(unrelatedRulePath), { recursive: true });
  await fs.mkdir(path.dirname(unrelatedSkillPath), { recursive: true });
  await fs.writeFile(unrelatedRulePath, "preserve", "utf8");
  await fs.writeFile(unrelatedSkillPath, "preserve", "utf8");

  await provisionProject({
    sourceRoot: repoRoot,
    target: unrelatedRulesTarget,
    profile: "minimal",
    setupPipeline: "none",
    applyRules: false
  });
  assert.equal(await fs.readFile(unrelatedRulePath, "utf8"), "preserve");
  assert.equal(await fs.readFile(unrelatedSkillPath, "utf8"), "preserve");
  assert.equal((await auditProject(unrelatedRulesTarget)).state, "NO_PIPELINE_MINIMAL");
  await doctorProject(unrelatedRulesTarget);
} finally {
  console.log = originalLog;
  await fs.rm(unrelatedRulesTarget, { recursive: true, force: true });
}

const provisionTemplateTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-template-"));
console.log = () => {};
try {
  await provisionProject({
    sourceRoot: repoRoot,
    target: provisionTemplateTarget,
    profile: "minimal",
    mcpValues: {
      CONTEXT7_API_KEY: "redacted-key",
      ANTHROPIC_AUTH_TOKEN: secretSentinel,
      OTHER_API_KEY: "other-key"
    },
    localSettingsEnv: {
      ANTHROPIC_BASE_URL: "https://example.com/v1",
      ANTHROPIC_AUTH_TOKEN: secretSentinel,
      CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "7",
      MAX_THINKING_TOKENS: "9000"
    },
    permissionConfig: { bypass: "allow" }
  });
  const localSettingsPath = path.join(provisionTemplateTarget, ".claude", "settings.local.json");
  const localSettingsText = await fs.readFile(localSettingsPath, "utf8");
  const localSettings = JSON.parse(localSettingsText);
  const settings = JSON.parse(await fs.readFile(path.join(provisionTemplateTarget, ".claude", "settings.json"), "utf8"));
  assert.equal((await fs.stat(localSettingsPath)).mode & 0o777, 0o600);
  const setupLockText = await fs.readFile(path.join(provisionTemplateTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8");
  const mcpConfigPath = path.join(provisionTemplateTarget, ".mcp.json");
  const mcpConfigText = await fs.readFile(mcpConfigPath, "utf8");
  assert.equal((await fs.stat(mcpConfigPath)).mode & 0o777, 0o600);
  assert.equal(localSettings.env.ANTHROPIC_AUTH_TOKEN, secretSentinel);
  assert.equal(localSettings.env.ANTHROPIC_BASE_URL, "https://example.com/v1");
  assert.equal(localSettings.model, "sonnet");
  assert.equal(localSettings.workflowSizeGuideline, "small");
  assert.equal(localSettings.env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION, "7");
  assert.equal(localSettings.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY, "2");
  assert.equal(localSettings.env.MAX_THINKING_TOKENS, "9000");
  assert.equal(localSettings.env.CLAUDE_CODE_SUBAGENT_MODEL, "haiku");
  assert.equal("workflowSizeGuideline" in localSettings.env, false);
  assert.equal(settings.permissions.defaultMode, "bypassPermissions");
  assert.equal("disableBypassPermissionsMode" in settings.permissions, false);
  assert.equal("CONTEXT7_API_KEY" in localSettings.env, false);
  assert.equal("TAVILY_API_KEY" in localSettings.env, false);
  assert.match(mcpConfigText, /redacted-key/);
  assert.equal(mcpConfigText.includes(secretSentinel), false);
  assert.equal(setupLockText.includes("redacted-key"), false);
  assert.equal(setupLockText.includes(secretSentinel), false);
  assert.equal("OTHER_API_KEY" in localSettings.env, false);
  const repoConfig = JSON.parse(await fs.readFile(path.join(provisionTemplateTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  assert.equal(repoConfig.mode, "target");
  assert.equal(repoConfig.mcp.profile, "minimal");
  assert.equal(repoConfig.mcp.generated, true);
  assert.equal(await fs.readFile(path.join(provisionTemplateTarget, ".claude", "CLAUDE.md"), "utf8"), await fs.readFile(path.join(repoRoot, ".claude.example", "CLAUDE.md"), "utf8"));
  const provisionGitignore = (await fs.readFile(path.join(provisionTemplateTarget, ".gitignore"), "utf8")).split(/\r?\n/);
  for (const line of [".DS_Store", "Thumbs.db", ".vscode/", ".idea/", ".claude/", ".mcp.json"]) {
    assert(provisionGitignore.includes(line));
  }
  const repoPatternGitignore = (await fs.readFile(path.join(provisionTemplateTarget, ".repo-pattern", ".gitignore"), "utf8")).trim();
  assert.equal(repoPatternGitignore, "*");

  await fs.chmod(localSettingsPath, 0o666);
  await fs.chmod(mcpConfigPath, 0o666);
  await provisionProject({
    sourceRoot: repoRoot,
    target: provisionTemplateTarget,
    profile: "minimal",
    mcpValues: { CONTEXT7_API_KEY: "replacement-key" },
    localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: "replacement-token" }
  });
  assert.equal((await fs.stat(localSettingsPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(mcpConfigPath)).mode & 0o777, 0o600);
  const [backupName] = await fs.readdir(path.join(provisionTemplateTarget, ".repo-pattern", "backups"));
  const backupRoot = path.join(provisionTemplateTarget, ".repo-pattern", "backups", backupName);
  await assert.rejects(() => fs.readFile(path.join(backupRoot, ".mcp.json")), { code: "ENOENT" });
  await assert.rejects(() => fs.readFile(path.join(backupRoot, ".claude", "settings.local.json")), { code: "ENOENT" });
} finally {
  console.log = originalLog;
  await fs.rm(provisionTemplateTarget, { recursive: true, force: true });
}

const symlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-symlink-target-"));
const symlinkDestination = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-symlink-destination-"));
console.log = () => {};
try {
  await fs.symlink(symlinkDestination, path.join(symlinkTarget, ".claude"), "dir");
  await assert.rejects(
    () => provisionProject({
      sourceRoot: repoRoot,
      target: symlinkTarget,
      profile: "minimal",
      localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: secretSentinel }
    }),
    /\.claude.*symlink/
  );
  await assert.rejects(
    () => fs.readFile(path.join(symlinkDestination, "settings.local.json")),
    { code: "ENOENT" }
  );
} finally {
  console.log = originalLog;
  await fs.rm(symlinkTarget, { recursive: true, force: true });
  await fs.rm(symlinkDestination, { recursive: true, force: true });
}

const settingsSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-settings-symlink-target-"));
const settingsSymlinkDestination = path.join(os.tmpdir(), `repo-pattern-settings-symlink-destination-${process.pid}`);
console.log = () => {};
try {
  await fs.mkdir(path.join(settingsSymlinkTarget, ".claude"));
  await fs.writeFile(settingsSymlinkDestination, "unchanged", "utf8");
  await fs.symlink(settingsSymlinkDestination, path.join(settingsSymlinkTarget, ".claude", "settings.local.json"));
  await assert.rejects(
    () => provisionProject({
      sourceRoot: repoRoot,
      target: settingsSymlinkTarget,
      profile: "minimal",
      localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: secretSentinel }
    }),
    /settings\.local\.json.*symlink/
  );
  assert.equal(await fs.readFile(settingsSymlinkDestination, "utf8"), "unchanged");
} finally {
  console.log = originalLog;
  await fs.rm(settingsSymlinkTarget, { recursive: true, force: true });
  await fs.rm(settingsSymlinkDestination, { force: true });
}

const eccSettingsTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-ecc-settings-"));
console.log = () => {};
try {
  const eccSettingsPath = path.join(eccSettingsTarget, ".claude", "settings.local.json");
  await fs.mkdir(path.dirname(eccSettingsPath));
  await fs.writeFile(eccSettingsPath, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: secretSentinel } }), { mode: 0o666 });
  await setupEcc({ target: eccSettingsTarget });
  assert.equal((await fs.stat(eccSettingsPath)).mode & 0o777, 0o600);
  assert.match(await fs.readFile(eccSettingsPath, "utf8"), /do-not-persist-anthropic-token/);
} finally {
  console.log = originalLog;
  await fs.rm(eccSettingsTarget, { recursive: true, force: true });
}

const eccSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-ecc-symlink-target-"));
const eccSymlinkDestination = path.join(os.tmpdir(), `repo-pattern-ecc-symlink-destination-${process.pid}`);
console.log = () => {};
try {
  await fs.mkdir(path.join(eccSymlinkTarget, ".claude"));
  await fs.writeFile(eccSymlinkDestination, "not-json", "utf8");
  await fs.symlink(eccSymlinkDestination, path.join(eccSymlinkTarget, ".claude", "settings.local.json"));
  await assert.rejects(
    () => setupEcc({ target: eccSymlinkTarget }),
    /settings\.local\.json.*symlink/
  );
  assert.equal(await fs.readFile(eccSymlinkDestination, "utf8"), "not-json");
} finally {
  console.log = originalLog;
  await fs.rm(eccSymlinkTarget, { recursive: true, force: true });
  await fs.rm(eccSymlinkDestination, { force: true });
}

const eccClaudeSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-ecc-claude-symlink-target-"));
const eccClaudeSymlinkDestination = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-ecc-claude-symlink-destination-"));
console.log = () => {};
try {
  await fs.symlink(eccClaudeSymlinkDestination, path.join(eccClaudeSymlinkTarget, ".claude"), "dir");
  await assert.rejects(
    () => setupEcc({ target: eccClaudeSymlinkTarget }),
    /\.claude.*symlink/
  );
  await assert.rejects(
    () => fs.readFile(path.join(eccClaudeSymlinkDestination, "settings.local.json")),
    { code: "ENOENT" }
  );
} finally {
  console.log = originalLog;
  await fs.rm(eccClaudeSymlinkTarget, { recursive: true, force: true });
  await fs.rm(eccClaudeSymlinkDestination, { recursive: true, force: true });
}

const pluginSettingsTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-plugin-settings-"));
console.log = () => {};
try {
  const pluginSettingsPath = path.join(pluginSettingsTarget, ".claude", "settings.local.json");
  await fs.mkdir(path.dirname(pluginSettingsPath));
  await fs.writeFile(pluginSettingsPath, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: secretSentinel } }), { mode: 0o666 });
  await applyOptionalSkills({ target: pluginSettingsTarget, skills: ["taste"] });
  assert.equal((await fs.stat(pluginSettingsPath)).mode & 0o777, 0o600);
  assert.match(await fs.readFile(pluginSettingsPath, "utf8"), /do-not-persist-anthropic-token/);
} finally {
  console.log = originalLog;
  await fs.rm(pluginSettingsTarget, { recursive: true, force: true });
}

const pluginSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-plugin-symlink-target-"));
const pluginSymlinkDestination = path.join(os.tmpdir(), `repo-pattern-plugin-symlink-destination-${process.pid}`);
console.log = () => {};
try {
  await fs.mkdir(path.join(pluginSymlinkTarget, ".claude"));
  await fs.writeFile(pluginSymlinkDestination, "not-json", "utf8");
  await fs.symlink(pluginSymlinkDestination, path.join(pluginSymlinkTarget, ".claude", "settings.local.json"));
  await assert.rejects(
    () => applyOptionalSkills({ target: pluginSymlinkTarget, skills: ["taste"] }),
    /settings\.local\.json.*symlink/
  );
  assert.equal(await fs.readFile(pluginSymlinkDestination, "utf8"), "not-json");
} finally {
  console.log = originalLog;
  await fs.rm(pluginSymlinkTarget, { recursive: true, force: true });
  await fs.rm(pluginSymlinkDestination, { force: true });
}

const pluginClaudeSymlinkTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-plugin-claude-symlink-target-"));
const pluginClaudeSymlinkDestination = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-plugin-claude-symlink-destination-"));
console.log = () => {};
try {
  await fs.symlink(pluginClaudeSymlinkDestination, path.join(pluginClaudeSymlinkTarget, ".claude"), "dir");
  await assert.rejects(
    () => applyOptionalSkills({ target: pluginClaudeSymlinkTarget, skills: ["taste"] }),
    /\.claude.*symlink/
  );
  await assert.rejects(
    () => fs.readFile(path.join(pluginClaudeSymlinkDestination, "settings.local.json")),
    { code: "ENOENT" }
  );
} finally {
  console.log = originalLog;
  await fs.rm(pluginClaudeSymlinkTarget, { recursive: true, force: true });
  await fs.rm(pluginClaudeSymlinkDestination, { recursive: true, force: true });
}

const cleanupCredentialTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-cleanup-credentials-"));
console.log = () => {};
try {
  await fs.mkdir(path.join(cleanupCredentialTarget, ".claude"), { recursive: true });
  await fs.writeFile(path.join(cleanupCredentialTarget, ".claude", "settings.json"), "{}", "utf8");
  await fs.writeFile(path.join(cleanupCredentialTarget, ".claude", "settings.local.json"), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: secretSentinel } }), "utf8");
  await fs.writeFile(path.join(cleanupCredentialTarget, ".mcp.json"), JSON.stringify({ mcpServers: { context7: { env: { CONTEXT7_API_KEY: "cleanup-key" } } } }), "utf8");
  await cleanupProject({ sourceRoot: repoRoot, target: cleanupCredentialTarget });
  assert.match(await fs.readFile(path.join(cleanupCredentialTarget, ".claude", "settings.local.json"), "utf8"), /do-not-persist-anthropic-token/);
  assert.match(await fs.readFile(path.join(cleanupCredentialTarget, ".mcp.json"), "utf8"), /cleanup-key/);
  const [backupName] = await fs.readdir(path.join(cleanupCredentialTarget, ".repo-pattern", "backups"));
  const backupRoot = path.join(cleanupCredentialTarget, ".repo-pattern", "backups", backupName);
  await assert.rejects(() => fs.readFile(path.join(backupRoot, ".mcp.json")), { code: "ENOENT" });
  await assert.rejects(() => fs.readFile(path.join(backupRoot, ".claude", "settings.local.json")), { code: "ENOENT" });
} finally {
  console.log = originalLog;
  await fs.rm(cleanupCredentialTarget, { recursive: true, force: true });
}

const defaultProvisionTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-default-provision-"));
console.log = () => {};
try {
  await provisionProject({
    sourceRoot: repoRoot,
    target: defaultProvisionTarget,
    profile: "minimal",
    mcpValues: { CONTEXT7_API_KEY: "default-run-key" }
  });
  const mcpConfigText = await fs.readFile(path.join(defaultProvisionTarget, ".mcp.json"), "utf8");
  const settingsPath = path.join(defaultProvisionTarget, ".claude", "settings.json");
  const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  assert.match(mcpConfigText, /default-run-key/);
  assert.equal(settings.permissions.defaultMode, "default");
  assert.equal(settings.permissions.disableBypassPermissionsMode, "disable");
  const localSettings = JSON.parse(await fs.readFile(path.join(defaultProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  const defaultProvisionLock = JSON.parse(await fs.readFile(path.join(defaultProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  assert.deepEqual(defaultProvisionLock.ecc.appliedRules, ["common"]);
  await fs.access(path.join(defaultProvisionTarget, ".claude", "rules", "ecc", "common"));
  assert.equal(localSettings.model, "sonnet");
  assert.equal(localSettings.workflowSizeGuideline, "small");
  assert.deepEqual({
    CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: localSettings.env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION,
    CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: localSettings.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY,
    MAX_THINKING_TOKENS: localSettings.env.MAX_THINKING_TOKENS,
    CLAUDE_CODE_SUBAGENT_MODEL: localSettings.env.CLAUDE_CODE_SUBAGENT_MODEL
  }, {
    CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "4",
    CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: "2",
    MAX_THINKING_TOKENS: "10000",
    CLAUDE_CODE_SUBAGENT_MODEL: "haiku"
  });
  assert.equal("workflowSizeGuideline" in localSettings.env, false);
  await updateClaudePermissions({ sourceRoot: repoRoot, target: defaultProvisionTarget, permissionConfig: { bypass: "allow" } });
  const updatedSettings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  assert.equal(updatedSettings.permissions.defaultMode, "bypassPermissions");
  assert.equal("disableBypassPermissionsMode" in updatedSettings.permissions, false);
} finally {
  console.log = originalLog;
  await fs.rm(defaultProvisionTarget, { recursive: true, force: true });
}

const runOnlyTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-run-only-"));
console.log = () => {};
try {
  await provisionProject({
    sourceRoot: repoRoot,
    target: runOnlyTarget,
    profile: "minimal",
    mcpValues: {
      CONTEXT7_API_KEY: "run-only-key",
      ANTHROPIC_AUTH_TOKEN: secretSentinel
    },
    localSettingsEnv: {
      CONTEXT7_API_KEY: "previously-saved-key",
      ANTHROPIC_AUTH_TOKEN: secretSentinel
    }
  });
  const localSettingsText = await fs.readFile(path.join(runOnlyTarget, ".claude", "settings.local.json"), "utf8");
  const mcpConfigText = await fs.readFile(path.join(runOnlyTarget, ".mcp.json"), "utf8");
  const setupLockText = await fs.readFile(path.join(runOnlyTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8");
  assert.equal(localSettingsText.includes("run-only-key"), false);
  assert.equal(localSettingsText.includes("previously-saved-key"), false);
  assert.match(localSettingsText, /do-not-persist-anthropic-token/);
  assert.match(mcpConfigText, /run-only-key/);
  assert.equal(mcpConfigText.includes(secretSentinel), false);
  assert.equal(setupLockText.includes("run-only-key"), false);
  assert.equal(setupLockText.includes(secretSentinel), false);
} finally {
  console.log = originalLog;
  await fs.rm(runOnlyTarget, { recursive: true, force: true });
}

const trackedLockTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-tracked-lock-"));
const gstackMarker = path.join(os.tmpdir(), `repo-pattern-gstack-marker-${process.pid}`);
console.log = () => {};
try {
  spawnSync("git", ["init"], { cwd: trackedLockTarget, stdio: "ignore" });
  await fs.mkdir(path.join(trackedLockTarget, ".repo-pattern"), { recursive: true });
  await fs.writeFile(path.join(trackedLockTarget, ".repo-pattern", ".repo-pattern.lock.json"), JSON.stringify({ setup: { status: "failed", options: { localSettingsEnv: { ANTHROPIC_BASE_URL: "https://attacker.invalid/v1" } } } }), "utf8");
  spawnSync("git", ["add", ".repo-pattern/.repo-pattern.lock.json"], { cwd: trackedLockTarget, stdio: "ignore" });
  await assert.rejects(
    () => provisionProject({ sourceRoot: repoRoot, target: trackedLockTarget, profile: "minimal" }),
    /repo-pattern lock is tracked/,
  );
  process.env.REPO_PATTERN_GSTACK_SETUP_CMD = `touch ${JSON.stringify(gstackMarker)}`;
  await assert.rejects(
    () => provisionProject({ sourceRoot: repoRoot, target: trackedLockTarget, profile: "minimal", setupPipeline: "gstack" }),
    /repo-pattern lock is tracked/,
  );
  await assert.rejects(() => fs.access(gstackMarker), { code: "ENOENT" });
} finally {
  delete process.env.REPO_PATTERN_GSTACK_SETUP_CMD;
  console.log = originalLog;
  await fs.rm(trackedLockTarget, { recursive: true, force: true });
  await fs.rm(gstackMarker, { force: true });
}

console.log("self-check passed");
