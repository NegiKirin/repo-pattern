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
import { printSummary, renderLogo, resolveTextValue, style } from "../lib/prompt.mjs";
import { localSettingsPromptOptions, needsLocalSettingsPrompt, setupProject, setupRetryOptions } from "../lib/setup.mjs";
import { applyEccRules, buildAgentManifest, clearEccRules, formatEccCloneError, hasGitUpstream, validateAgentManifest } from "../lib/rules.mjs";
import { applyOptionalSkills, applyPluginSkillSettings, expectedOptionalSkillDirs, invalidOptionalSkills, normalizeOptionalSkills, OPTIONAL_SKILLS } from "../lib/skills.mjs";
const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const cliPath = path.join(cliDir, "..", "repo-pattern.mjs");
const secretSentinel = "do-not-persist-anthropic-token";
const sharedSettingsTemplate = JSON.parse(await fs.readFile(path.join(repoRoot, ".claude.example", "settings.example.json"), "utf8"));
const localSettingsTemplate = JSON.parse(await fs.readFile(path.join(repoRoot, ".claude.example", "settings.local.example.json"), "utf8"));

export async function runMcpAndSettingsChecks() {

assert.deepEqual(sharedSettingsTemplate.attribution, { commit: "", pr: "" });
assert.equal("enabledPlugins" in sharedSettingsTemplate, false);
assert.equal("extraKnownMarketplaces" in sharedSettingsTemplate, false);
assert.equal("attribution" in localSettingsTemplate, false);
assert.deepEqual(localSettingsTemplate.enabledPlugins, {});
assert.deepEqual(localSettingsTemplate.extraKnownMarketplaces, {});
assert.equal(localSettingsTemplate.workflowSizeGuideline, "small");
assert.deepEqual({
  CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: localSettingsTemplate.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY
}, {
  CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: "2"
});
assert.equal("workflowSizeGuideline" in localSettingsTemplate.env, false);

const mcpServers = {
  context7: {
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env: { CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}" }
  },
  tavily: {
    command: "npx",
    args: ["-y", "tavily-mcp"],
    env: { TAVILY_API_KEY: "${TAVILY_API_KEY}" }
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
  tavily: {
    command: "npx",
    args: ["-y", "tavily-mcp"],
    env: { TAVILY_API_KEY: "${TAVILY_API_KEY}" }
  }
});

assert.equal(applyMcpValues(mcpServers).tavily.env.TAVILY_API_KEY, "${TAVILY_API_KEY}");
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
  gstack: "project-local gstack at .claude/skills/gstack",
  both: "project-scoped ECC + project-local gstack at .claude/skills/gstack",
  none: "writes only base project metadata"
});
assert.equal(resolveTextValue("new", { initial: "current", placeholder: "default" }), "new");
assert.equal(resolveTextValue("", { initial: "current", placeholder: "default" }), "current");
assert.equal(resolveTextValue("", { initial: "", placeholder: "default" }), "default");
const defaultPromptOptions = localSettingsPromptOptions({}, {});
assert.equal(defaultPromptOptions.ANTHROPIC_BASE_URL.placeholder, "https://example.com/v1");
assert.equal(defaultPromptOptions.ANTHROPIC_DEFAULT_OPUS_MODEL.placeholder, "claude-opus-4-8");
assert.equal(defaultPromptOptions.ANTHROPIC_DEFAULT_SONNET_MODEL.placeholder, "claude-sonnet-4-6");
assert.equal(defaultPromptOptions.ANTHROPIC_DEFAULT_HAIKU_MODEL.placeholder, "claude-haiku-4-5");
assert.equal(defaultPromptOptions.ANTHROPIC_AUTH_TOKEN.placeholder, "");
assert.deepEqual(Object.values(defaultPromptOptions).map(({ initial }) => initial), ["", "", "", "", ""]);
assert.deepEqual(Object.values(defaultPromptOptions).map(({ placeholder }) => placeholder), ["", "https://example.com/v1", "claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"]);
const currentPromptOptions = localSettingsPromptOptions({
  ANTHROPIC_AUTH_TOKEN: secretSentinel,
  ANTHROPIC_BASE_URL: "https://provider.example/v1",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "custom-opus",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "custom-sonnet",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "custom-haiku"
}, {});
assert.deepEqual(Object.values(currentPromptOptions).map(({ initial }) => initial), [secretSentinel, "https://provider.example/v1", "custom-opus", "custom-sonnet", "custom-haiku"]);
assert.deepEqual(Object.values(currentPromptOptions).map(({ placeholder }) => placeholder), ["", "https://example.com/v1", "claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"]);
const invalidPromptOptions = localSettingsPromptOptions({
  ANTHROPIC_AUTH_TOKEN: secretSentinel,
  ANTHROPIC_BASE_URL: "not-a-url",
  ANTHROPIC_DEFAULT_OPUS_MODEL: " ",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "custom-haiku"
}, {});
assert.deepEqual(Object.values(invalidPromptOptions).map(({ initial }) => initial), [secretSentinel, "", "", "", "custom-haiku"]);
assert.deepEqual(localSettingsPromptOptions({}, {}), defaultPromptOptions);
assert.equal(needsLocalSettingsPrompt({ ANTHROPIC_BASE_URL: "https://example.com/v1" }), true);
assert.equal(needsLocalSettingsPrompt({
  ANTHROPIC_AUTH_TOKEN: secretSentinel,
  ANTHROPIC_BASE_URL: "",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "custom-opus",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "custom-sonnet",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "custom-haiku"
}), true);
assert.equal(needsLocalSettingsPrompt({
  ANTHROPIC_AUTH_TOKEN: secretSentinel,
  ANTHROPIC_BASE_URL: "https://provider.example/v1",
  ANTHROPIC_DEFAULT_OPUS_MODEL: " ",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "custom-sonnet",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "custom-haiku"
}), true);
assert.equal(needsLocalSettingsPrompt({
  ANTHROPIC_AUTH_TOKEN: secretSentinel,
  ANTHROPIC_BASE_URL: "https://provider.example/v1",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "custom-opus",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "\t",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "custom-haiku"
}), true);
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
    profile: "backend",
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
}
