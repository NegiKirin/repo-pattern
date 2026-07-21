import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { auditProject, printAudit } from "./audit.mjs";
import { detectProject } from "./project-detect.mjs";
import { provisionProject, updateClaudeAttribution } from "./provision.mjs";
import { doctorProject } from "./doctor.mjs";
import { collectMcpValues, generateMcp, listAvailableMcpServers, persistedMcpValues, readGeneratedMcpValues, readMcpConfig } from "./mcp.mjs";
import { askConfirm, askPassword, askText, isInteractive, printBox, printLogo, printSummary, selectMany, selectOne, style } from "./prompt.mjs";
import { ECC_RULE_PACKS, selectEccRules } from "./ecc-rules.mjs";
import { ensureRepoPatternGitignore, isTracked, readJson, readPrivateJson, readRepoLock, repoLockPath, writeJson } from "./fs-utils.mjs";
import { applyOptionalSkills, OPTIONAL_SKILLS } from "./skills.mjs";

const execFileAsync = promisify(execFile);

const PROFILE_NAMES = ["web", "minimal", "backend", "research", "full"];

async function profileOptions(sourceRoot) {
  const options = await Promise.all(PROFILE_NAMES.map(async (name) => {
    const { profileServers } = await readMcpConfig({ sourceRoot, profile: name });
    return { value: name, label: name, description: profileServers.join(", ") };
  }));
  return [...options, { value: "custom", label: "custom", description: "choose exact MCP servers" }];
}

function validateRequired(value) {
  return String(value || "").trim() ? true : "Required";
}

function validateUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? true : "Use http:// or https://.";
  } catch {
    return "Use a valid URL.";
  }
}

const LOCAL_SETTINGS_FIELDS = [
  ["ANTHROPIC_AUTH_TOKEN", "", askPassword, validateRequired],
  ["ANTHROPIC_BASE_URL", "https://example.com/v1", askText, validateUrl],
  ["ANTHROPIC_DEFAULT_OPUS_MODEL", "claude-opus-4-8", askText, validateRequired],
  ["ANTHROPIC_DEFAULT_SONNET_MODEL", "claude-sonnet-4-6", askText, validateRequired],
  ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "claude-haiku-4-5", askText, validateRequired]
];
const RETRY_SECRET_LOCAL_SETTINGS = new Set(["ANTHROPIC_AUTH_TOKEN", "CONTEXT7_API_KEY", "TAVILY_API_KEY"]);

function setupLockPath(target) {
  return repoLockPath(target);
}

function safeRetryLocalSettingsEnv(localSettingsEnv = {}) {
  return Object.fromEntries(Object.entries(localSettingsEnv).filter(([name]) => !RETRY_SECRET_LOCAL_SETTINGS.has(name)));
}

export function setupRetryOptions({ action, mcpConfig, mcpValues = {}, ruleConfig, optionalSkills, localSettingsEnv, attributionConfig, dryRun }) {
  return {
    action,
    profile: mcpConfig.profile,
    mcpServers: mcpConfig.mcpServers,
    mcpValueNames: Object.keys(persistedMcpValues(mcpValues)),
    migrate: action === "migrate",
    applyRules: ruleConfig.applyRules,
    ruleMode: ruleConfig.ruleMode,
    rules: ruleConfig.rules,
    optionalSkills,
    localSettingsEnv: safeRetryLocalSettingsEnv(localSettingsEnv),
    attributionConfig,
    dryRun
  };
}

function setupOptionsFromLock(lock) {
  const setup = lock?.setup;
  if (!["failed", "running"].includes(setup?.status)) return null;
  return setup.options || null;
}

async function writeSetupStatus(target, setup, { dryRun = false } = {}) {
  const file = setupLockPath(target);
  await ensureRepoPatternGitignore(target, { dryRun });
  const lock = await readJson(file, {});
  lock.setup = { ...(lock.setup || {}), ...setup };
  await writeJson(file, lock, { dryRun });
}

async function currentLocalSettingsEnv(target) {
  const settings = await readPrivateJson(path.join(target, ".claude", "settings.local.json"), {}, {
    label: ".claude/settings.local.json",
    parentLabel: ".claude"
  });
  return settings.env || {};
}

function retryRows(setup) {
  const options = setup.options || {};
  return [
    ["Status", setup.status],
    ["Failed step", setup.failedStep || "unknown"],
    ["Error", setup.error || "unknown"],
    ["Profile", options.profile || "web"],
    ["MCP servers", options.mcpServers?.join(", ") || "from profile"],
    ["MCP values", options.mcpValueNames?.length ? options.mcpValueNames.join(", ") : "none"],
    ["Rules", options.applyRules ? options.rules.join(", ") : "none"],
    ["Optional skills", options.optionalSkills?.length ? options.optionalSkills.join(", ") : "none"],
    ["Commit attribution", attributionSummary(options.attributionConfig || { mode: "off" })],
    ["Dry-run", options.dryRun ? "yes" : "no"]
  ];
}

async function choosePreviousSetupOptions(target) {
  if (isTracked(target, ".repo-pattern/.repo-pattern.lock.json") || isTracked(target, ".repo-pattern.lock.json")) {
    throw new Error("repo-pattern lock is tracked. Untrack it before retrying setup.");
  }

  const lock = await readRepoLock(target, {});
  const options = setupOptionsFromLock(lock);
  if (!options) return null;

  printSummary("Previous setup did not complete", retryRows(lock.setup));
  const answer = await selectOne({
    message: "Press Enter to retry with previous settings, or edit them.",
    options: [
      { value: "retry", label: "Retry" },
      { value: "edit", label: "Edit" }
    ],
    initialValue: "retry"
  });
  return answer === "retry" ? options : null;
}

function suggestedProfile(detection, fallback) {
  if (fallback && fallback !== "web") return fallback;
  if (["frontend", "fullstack", "node"].includes(detection.repoType)) return "web";
  if (detection.repoType === "backend") return "backend";
  return "minimal";
}

async function checkClaudeCode() {
  try {
    const { stdout } = await execFileAsync("claude", ["--version"]);
    printBox("Claude Code", [`version: ${stdout.trim()}`]);
  } catch {
    throw new Error("Claude Code CLI is required. Install/login to Claude Code, then rerun setup.");
  }
}

async function chooseProfile(sourceRoot, profile, detection) {
  return selectOne({
    message: "Step 1/5 — Choose MCP profile",
    options: await profileOptions(sourceRoot),
    initialValue: suggestedProfile(detection, profile)
  });
}

async function chooseMcpConfig(sourceRoot, profile) {
  if (profile !== "custom") return { profile, mcpServers: null };
  const mcpServers = await selectMany({
    message: "Choose MCP servers",
    options: await listAvailableMcpServers(sourceRoot),
    initialValues: ["context7", "filesystem"]
  });
  if (mcpServers.length === 0) throw new Error("Custom MCP profile requires at least one server.");
  return { profile, mcpServers };
}

async function chooseMcpValues(sourceRoot, mcpConfig, values = {}) {
  const { mcpServers } = await readMcpConfig({ sourceRoot, profile: mcpConfig.profile, mcpServers: mcpConfig.mcpServers });
  return collectMcpValues(mcpServers, { values: persistedMcpValues(values) });
}

async function chooseRuleConfig(detection) {
  const autoRules = selectEccRules(detection);
  const ruleMode = await selectOne({
    message: "Step 2/5 — Choose ECC rule detection mode",
    options: [
      { value: "auto", label: "auto", description: `detect from project (${autoRules.join(", ")})` },
      { value: "manual", label: "manual", description: "choose rule packs by type" },
      { value: "none", label: "none", description: "do not install project-local ECC rules" }
    ],
    initialValue: "auto"
  });

  if (ruleMode === "none") return { applyRules: false, ruleMode: "auto", rules: [] };
  if (ruleMode !== "manual") return { applyRules: true, ruleMode, rules: autoRules };

  return {
    applyRules: true,
    ruleMode,
    rules: await selectMany({
      message: "Choose ECC rule packs",
      options: ECC_RULE_PACKS,
      initialValues: autoRules
    })
  };
}

async function chooseOptionalSkills(initialValues = []) {
  return selectMany({
    message: "Step 3/5 — Optional external skills",
    options: OPTIONAL_SKILLS,
    initialValues
  });
}

export function needsLocalSettingsPrompt(values = {}) {
  return LOCAL_SETTINGS_FIELDS.some(([name, , , validate]) => validate(values[name]) !== true);
}

async function chooseLocalSettingsEnv(initialValues = {}) {
  printBox("Step 4/5 — Local Claude provider settings", ["These values are written to .claude/settings.local.json and gitignored."]);
  const env = {};
  for (const [name, fallback, ask, validate] of LOCAL_SETTINGS_FIELDS) {
    env[name] = await ask(name, { initial: process.env[name] || initialValues[name] || fallback, validate });
  }
  return env;
}

async function chooseAttributionConfig() {
  printBox("Step 5/5 — Claude Code commit attribution", ["Controls .claude/settings.json attribution.commit."]);
  const mode = await selectOne({
    message: "Commit attribution?",
    options: [
      { value: "off", label: "off", description: "disable Co-Authored-By trailer" },
      { value: "on", label: "on", description: "use Claude Code default" },
      { value: "custom", label: "custom", description: "write your own commit attribution" }
    ],
    initialValue: "off"
  });
  if (mode !== "custom") return { mode };
  return {
    mode,
    commit: await askText("Custom commit attribution", {
      initial: "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>",
      validate: validateRequired
    })
  };
}

function attributionSummary(attributionConfig) {
  if (attributionConfig.mode === "on") return "Claude Code default";
  if (attributionConfig.mode === "custom") return attributionConfig.commit;
  return "off (commit: \"\")";
}

async function confirmSummary({ action, target, mcpConfig, mcpValues, ruleConfig, optionalSkills, localSettingsEnv, attributionConfig, dryRun }) {
  const hasLocalSkill = optionalSkills.some((name) => !OPTIONAL_SKILLS.find((skill) => skill.value === name)?.plugin);
  printSummary("Setup summary", [
    ["Action", action],
    ["Target", target],
    ["Profile", mcpConfig.profile],
    ["MCP servers", mcpConfig.mcpServers?.join(", ") || "from profile"],
    ["MCP values", Object.keys(mcpValues).length ? Object.keys(mcpValues).join(", ") : "none"],
    ["Rules", ruleConfig.applyRules ? ruleConfig.rules.join(", ") : "none"],
    ["Optional skills", optionalSkills.length ? optionalSkills.join(", ") : "none"],
    ["Local settings", ".claude/settings.local.json"],
    ["Base URL", localSettingsEnv.ANTHROPIC_BASE_URL],
    ["Opus", localSettingsEnv.ANTHROPIC_DEFAULT_OPUS_MODEL],
    ["Sonnet", localSettingsEnv.ANTHROPIC_DEFAULT_SONNET_MODEL],
    ["Haiku", localSettingsEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL],
    ["Auth token", style("dim", "[hidden]")],
    ["Commit attribution", attributionSummary(attributionConfig)],
    ["Dry-run", dryRun ? "yes" : "no"],
    ["Will write", `CLAUDE.md (if missing), .claude/CLAUDE.md, .claude/settings.json, .claude/settings.local.json, .mcp.json, .repo-pattern/.repo-pattern.json, .repo-pattern/.repo-pattern.lock.json${optionalSkills.length ? ", optional skill/plugin config" : ""}${hasLocalSkill ? ", .claude/skills" : ""}`],
    ["Will not write", hasLocalSkill ? ".claude/commands, .claude/hooks, .claude/scripts" : ".claude/skills, .claude/commands, .claude/hooks, .claude/scripts"]
  ]);

  const answer = await selectOne({
    message: "Run setup now?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" }
    ],
    initialValue: "yes"
  });
  return answer === "yes";
}

async function handleInitialized({ sourceRoot, target, profile, dryRun }) {
  printBox("Already initialized", ["This target already looks like repo-pattern ECC-native setup."]);

  const action = await selectOne({
    message: "What do you want to do?",
    options: [
      { value: "doctor", label: "Run doctor" },
      { value: "mcp", label: "Regenerate MCP profile" },
      { value: "skills", label: "Add optional skills" },
      { value: "attribution", label: "Update commit attribution" },
      { value: "exit", label: "Exit" }
    ],
    initialValue: "doctor"
  });

  if (action === "doctor") await doctorProject(target, { dryRun });
  if (action === "mcp") {
    const detection = await detectProject(target);
    const chosenProfile = await chooseProfile(sourceRoot, profile, detection);
    const mcpConfig = await chooseMcpConfig(sourceRoot, chosenProfile);
    const mcpValues = await chooseMcpValues(sourceRoot, mcpConfig, await readGeneratedMcpValues(target));
    await generateMcp({
      sourceRoot,
      target,
      profile: mcpConfig.profile,
      mcpServers: mcpConfig.mcpServers,
      mcpValues,
      dryRun
    });
  }
  if (action === "skills") {
    const optionalSkills = await chooseOptionalSkills();
    await applyOptionalSkills({ target, skills: optionalSkills, dryRun });
    if (!dryRun) await doctorProject(target, { updateLock: true, dryRun });
  }
  if (action === "attribution") {
    await updateClaudeAttribution({ sourceRoot, target, attributionConfig: await chooseAttributionConfig(), dryRun });
    if (!dryRun) await doctorProject(target, { updateLock: true, dryRun });
  }
}

export async function setupProject({ sourceRoot, target, profile = "web", dryRun = false, force = false, migrate = false, yes = false, applyRules = false, optionalSkills = [] }) {
  if (!isInteractive()) {
    if (!yes) throw new Error("setup requires an interactive terminal, or pass --yes for scriptable mode.");
    if (profile === "custom") throw new Error("setup --yes cannot use the custom profile; choose a named profile.");

    const audit = await auditProject(target);
    if (audit.state === "ECC_NATIVE_MINIMAL" && !force && optionalSkills.length === 0) {
      await doctorProject(target, { dryRun });
      return;
    }

    if (audit.state === "ECC_NATIVE_MINIMAL" && optionalSkills.length > 0) {
      await applyOptionalSkills({ target, skills: optionalSkills, dryRun });
      if (!dryRun) await doctorProject(target, { updateLock: true, dryRun });
      return;
    }

    await provisionProject({
      sourceRoot,
      target,
      profile,
      mcpValues: await readGeneratedMcpValues(target),
      dryRun,
      force,
      migrate,
      applyRules,
      optionalSkills
    });
    return;
  }

  printLogo();
  await checkClaudeCode();

  const previousOptions = await choosePreviousSetupOptions(target);
  const detection = await detectProject(target);
  const chosenProfile = previousOptions?.profile || await chooseProfile(sourceRoot, profile, detection);
  const mcpConfig = previousOptions
    ? { profile: previousOptions.profile, mcpServers: previousOptions.mcpServers }
    : await chooseMcpConfig(sourceRoot, chosenProfile);
  const ruleConfig = previousOptions
    ? { applyRules: previousOptions.applyRules, ruleMode: previousOptions.ruleMode, rules: previousOptions.rules }
    : await chooseRuleConfig(detection);
  const selectedOptionalSkills = previousOptions?.optionalSkills || await chooseOptionalSkills(optionalSkills);

  const audit = await auditProject(target);
  printAudit(audit);

  if (audit.state === "LEGACY_VENDOR" && force && !migrate) {
    throw new Error("Target has legacy/local Claude runtime surfaces. Re-run setup with --migrate, not --force.");
  }

  if (audit.state === "ECC_NATIVE_MINIMAL") {
    if (selectedOptionalSkills.length > 0) {
      await applyOptionalSkills({ target, skills: selectedOptionalSkills, dryRun });
      if (!dryRun) await doctorProject(target, { updateLock: true, dryRun });
    } else {
      await handleInitialized({ sourceRoot, target, profile: chosenProfile, dryRun });
    }
    return;
  }

  const action = audit.state === "LEGACY_VENDOR" ? "migrate" : "setup";
  const shouldMigrate = previousOptions?.migrate || migrate;
  if (action === "migrate" && !shouldMigrate) {
    printBox("Migration required", ["Legacy/local Claude runtime surfaces detected.", "Recommended action: migrate, with backups."]);
    const confirmed = await askConfirm("Run migrate?", false);
    if (!confirmed) throw new Error("Setup cancelled.");
  }

  const currentSettingsEnv = await currentLocalSettingsEnv(target);
  const mcpValues = await chooseMcpValues(sourceRoot, mcpConfig, await readGeneratedMcpValues(target));
  const retryLocalSettingsEnv = { ...previousOptions?.localSettingsEnv, ...currentSettingsEnv };
  const localSettingsEnv = previousOptions && !needsLocalSettingsPrompt(retryLocalSettingsEnv)
    ? retryLocalSettingsEnv
    : await chooseLocalSettingsEnv(retryLocalSettingsEnv);
  const attributionConfig = previousOptions?.attributionConfig || await chooseAttributionConfig();

  if (!await confirmSummary({ action, target, mcpConfig, mcpValues, ruleConfig, optionalSkills: selectedOptionalSkills, localSettingsEnv, attributionConfig, dryRun })) {
    throw new Error("Setup cancelled.");
  }

  const retryOptions = setupRetryOptions({ action, mcpConfig, mcpValues, ruleConfig, optionalSkills: selectedOptionalSkills, localSettingsEnv, attributionConfig, dryRun });
  await writeSetupStatus(target, { status: "running", startedAt: new Date().toISOString(), failedStep: null, error: null, options: retryOptions }, { dryRun });
  try {
    await provisionProject({
      sourceRoot,
      target,
      profile: mcpConfig.profile,
      mcpServers: mcpConfig.mcpServers,
      mcpValues,
      dryRun,
      force: false,
      migrate: shouldMigrate,
      ruleMode: ruleConfig.ruleMode,
      rules: ruleConfig.rules,
      applyRules: ruleConfig.applyRules,
      optionalSkills: selectedOptionalSkills,
      localSettingsEnv,
      attributionConfig
    });
    await writeSetupStatus(target, { status: "succeeded", succeededAt: new Date().toISOString(), failedStep: null, error: null, options: retryOptions }, { dryRun });
  } catch (error) {
    await writeSetupStatus(target, { status: "failed", failedAt: new Date().toISOString(), failedStep: "provision", error: error.message, options: retryOptions }, { dryRun });
    throw error;
  }
}
