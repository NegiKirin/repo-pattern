import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { auditProject, printAudit } from "./audit.mjs";
import { detectProject } from "./project-detect.mjs";
import { provisionProject, setupPipelineScope, updateClaudeAttribution, updateClaudePermissions } from "./provision.mjs";
import { doctorProject } from "./doctor.mjs";
import { collectMcpValues, generateMcp, listAvailableMcpServers, persistedMcpValues, readGeneratedMcpValues, readMcpConfig } from "./mcp.mjs";
import { askConfirm, askPassword, askText, isInteractive, printBox, printLogo, printSummary, selectMany, selectOne, style } from "./prompt.mjs";
import { ECC_RULE_PACKS, normalizeEccRules, selectEccRules } from "./ecc-rules.mjs";
import { ensureRepoPatternGitignore, isTracked, readJson, readPrivateJson, readRepoLock, repoLockPath, writeJson } from "./fs-utils.mjs";
import { applyOptionalSkills, OPTIONAL_SKILLS } from "./skills.mjs";

const execFileAsync = promisify(execFile);

const PROFILE_NAMES = ["backend", "web", "research", "full"];

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

export function setupRetryOptions({ action, setupPipeline, planTuneHooks = false, mcpConfig, mcpValues = {}, ruleConfig, optionalSkills, localSettingsEnv, attributionConfig, permissionConfig = { bypass: "deny" }, dryRun }) {
  return {
    action,
    setupPipeline,
    planTuneHooks,
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
    permissionConfig,
    dryRun
  };
}

function setupOptionsFromLock(lock) {
  const setup = lock?.setup;
  if (!["failed", "running"].includes(setup?.status)) return null;
  const options = setup.options || null;
  if (!options) return null;
  return {
    ...options,
    permissionConfig: options.permissionConfig?.bypass === "allow" ? { bypass: "allow" } : { bypass: "deny" }
  };
}

async function writeSetupStatus(target, setup, { dryRun = false, silent = false } = {}) {
  const file = setupLockPath(target);
  await ensureRepoPatternGitignore(target, { dryRun, silent });
  const lock = await readJson(file, {});
  lock.setup = { ...(lock.setup || {}), ...setup };
  await writeJson(file, lock, { dryRun, silent });
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
    ["Setup pipeline", options.setupPipeline || "ecc"],
    ...(usesGstack(options.setupPipeline) ? [["Plan-tune hooks", options.planTuneHooks ? "installed in .claude/settings.json" : "not installed"]] : []),
    ["Profile", options.profile || "web"],
    ["MCP servers", options.mcpServers?.join(", ") || "from profile"],
    ["MCP values", options.mcpValueNames?.length ? options.mcpValueNames.join(", ") : "none"],
    ["Rules", options.applyRules ? options.rules.join(", ") : "none"],
    ["Optional skills", options.optionalSkills?.length ? options.optionalSkills.join(", ") : "none"],
    ["Bypass permissions", options.permissionConfig?.bypass === "allow" ? "allowed by default" : "disabled"],
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
  return "full";
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
    message: "Step 1/6 — Choose MCP profile",
    options: await profileOptions(sourceRoot),
    initialValue: suggestedProfile(detection, profile)
  });
}

async function chooseMcpConfig(sourceRoot, profile) {
  if (profile !== "custom") return { profile, mcpServers: null };
  const mcpServers = await selectMany({
    message: "Choose MCP servers",
    options: await listAvailableMcpServers(sourceRoot),
    initialValues: ["context7", "graphify"]
  });
  if (mcpServers.length === 0) throw new Error("Custom MCP profile requires at least one server.");
  return { profile, mcpServers };
}

async function chooseMcpValues(sourceRoot, mcpConfig, values = {}) {
  const { mcpServers } = await readMcpConfig({ sourceRoot, profile: mcpConfig.profile, mcpServers: mcpConfig.mcpServers });
  return collectMcpValues(mcpServers, { values: persistedMcpValues(values) });
}

const SETUP_PIPELINES = ["ecc", "gstack", "both", "none"];

function selectedPipeline(values = []) {
  const selected = new Set(values);
  if (selected.has("ecc") && selected.has("gstack")) return "both";
  if (selected.has("gstack")) return "gstack";
  if (selected.has("ecc")) return "ecc";
  return "none";
}

function pipelineValues(setupPipeline = "ecc") {
  if (setupPipeline === "both") return ["ecc", "gstack"];
  if (setupPipeline === "none") return [];
  return [setupPipeline];
}

function usesEcc(setupPipeline) {
  return setupPipeline === "ecc" || setupPipeline === "both";
}

function usesGstack(setupPipeline) {
  return setupPipeline === "gstack" || setupPipeline === "both";
}

function expectedSetupState(setupPipeline) {
  return {
    ecc: "ECC_NATIVE_MINIMAL",
    gstack: "GSTACK_MINIMAL",
    both: "ECC_GSTACK_MINIMAL",
    none: "NO_PIPELINE_MINIMAL"
  }[setupPipeline];
}

async function chooseSetupPipeline(initialValue = "ecc") {
  return selectedPipeline(await selectMany({
    message: "Choose setup pipeline",
    options: [
      { value: "ecc", label: "ECC", description: "project-scoped plugin with optional project rules" },
      { value: "gstack", label: "gstack", description: "project-local at .claude/skills/gstack; requires Git and Bun" }
    ],
    initialValues: pipelineValues(initialValue)
  }));
}

async function choosePlanTuneHooks(setupPipeline, initialValue = false) {
  if (setupPipeline !== "gstack" && setupPipeline !== "both") return false;
  return selectOne({
    message: "Install gstack plan-tune hooks?",
    options: [
      { value: false, label: "No", description: "keep target .claude/settings.json unchanged by gstack" },
      { value: true, label: "Yes", description: "add gstack PreToolUse and PostToolUse hooks to target .claude/settings.json" }
    ],
    initialValue
  });
}

async function chooseRuleConfig(detection, setupPipeline) {
  if (!usesEcc(setupPipeline)) {
    const installRules = await selectOne({
      message: "Install project-local ECC rules?",
      options: [
        { value: false, label: "No", description: "do not install project-local ECC rules" },
        { value: true, label: "Yes", description: "sync ECC rules without installing the ECC plugin" }
      ],
      initialValue: false
    });
    if (!installRules) return { applyRules: false, ruleMode: "auto", rules: [] };
  }

  const autoRules = selectEccRules(detection);
  const ruleMode = await selectOne({
    message: "Step 2/6 — Choose ECC rule detection mode",
    options: [
      { value: "auto", label: "auto", description: `detect from project (${autoRules.join(", ")})` },
      { value: "manual", label: "manual", description: "choose rule packs by type" },
      { value: "none", label: "none", description: "do not install project-local ECC rules" }
    ],
    initialValue: "auto"
  });

  if (ruleMode === "none") return { applyRules: false, ruleMode: "auto", rules: [] };
  if (ruleMode !== "manual") return { applyRules: true, ruleMode, rules: autoRules };

  const rules = normalizeEccRules(await selectMany({
    message: "Choose ECC rule packs",
    options: ECC_RULE_PACKS,
    initialValues: autoRules
  }));
  return { applyRules: rules.length > 0, ruleMode, rules };
}

function defaultRuleConfig(setupPipeline, applyRules, detection) {
  const shouldApplyRules = usesEcc(setupPipeline) || applyRules;
  return {
    applyRules: shouldApplyRules,
    ruleMode: "auto",
    rules: shouldApplyRules ? selectEccRules(detection) : []
  };
}

function hasRequestedRules(audit, ruleConfig) {
  if (!ruleConfig.applyRules) return !audit.hasClaudeRulesDir;
  const appliedRules = audit.eccRulePackDirs || [];
  return audit.hasManagedEccRules && JSON.stringify(appliedRules) === JSON.stringify([...ruleConfig.rules].sort());
}

async function chooseOptionalSkills(initialValues = []) {
  return selectMany({
    message: "Step 3/6 — Optional external skills",
    options: OPTIONAL_SKILLS,
    initialValues
  });
}

export function needsLocalSettingsPrompt(values = {}) {
  return LOCAL_SETTINGS_FIELDS.some(([name, , , validate]) => validate(values[name]) !== true);
}

export function localSettingsPromptOptions(initialValues = {}, environment = process.env) {
  return Object.fromEntries(LOCAL_SETTINGS_FIELDS.map(([name, fallback, , validate]) => {
    const initial = environment[name] || initialValues[name] || "";
    return [name, {
      initial: validate(initial) === true ? initial : "",
      placeholder: fallback
    }];
  }));
}

async function chooseLocalSettingsEnv(initialValues = {}, promptInitialValues = initialValues) {
  printBox("Step 4/6 — Local Claude provider settings", ["These values are written to .claude/settings.local.json and gitignored."]);
  const env = { ...initialValues };
  const promptOptions = localSettingsPromptOptions(promptInitialValues);
  for (const [name, , ask, validate] of LOCAL_SETTINGS_FIELDS) {
    env[name] = await ask(name, { ...promptOptions[name], validate });
  }
  return env;
}

async function choosePermissionConfig() {
  return {
    bypass: await selectOne({
      message: "Step 5/6 — Allow bypass permissions mode?",
      options: [
        { value: "deny", label: "No", description: "disable bypass permissions mode" },
        { value: "allow", label: "Yes", description: "default to bypassPermissions" }
      ],
      initialValue: "deny"
    })
  };
}

async function chooseAttributionConfig() {
  printBox("Step 6/6 — Claude Code commit attribution", ["Controls .claude/settings.json attribution.commit."]);
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

async function confirmSummary({ action, setupPipeline, planTuneHooks, target, mcpConfig, mcpValues, ruleConfig, optionalSkills, localSettingsEnv, attributionConfig, permissionConfig, dryRun }) {
  const hasLocalSkill = optionalSkills.some((name) => !OPTIONAL_SKILLS.find((skill) => skill.value === name)?.plugin);
  const writesGstack = usesGstack(setupPipeline);
  printSummary("Setup summary", [
    ["Action", action],
    ["Setup pipeline", setupPipeline],
    ["Pipeline scope", setupPipelineScope(setupPipeline)],
    ...(usesGstack(setupPipeline) ? [["Plan-tune hooks", planTuneHooks ? "will add PreToolUse/PostToolUse hooks to .claude/settings.json" : "not installed"]] : []),
    ["Target", target],
    ["Profile", mcpConfig.profile],
    ["MCP servers", mcpConfig.mcpServers?.join(", ") || "from profile"],
    ["MCP values", Object.keys(mcpValues).length ? Object.keys(mcpValues).join(", ") : "none"],
    ["Rules", ruleConfig.applyRules ? ruleConfig.rules.join(", ") : "none"],
    ["Optional skills", optionalSkills.length ? optionalSkills.join(", ") : "none"],
    ["Local settings", ".claude/settings.local.json"],
    ["Base URL", localSettingsEnv.ANTHROPIC_BASE_URL],
    ["Subagent session limit", localSettingsEnv.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION],
    ["Opus", localSettingsEnv.ANTHROPIC_DEFAULT_OPUS_MODEL],
    ["Sonnet", localSettingsEnv.ANTHROPIC_DEFAULT_SONNET_MODEL],
    ["Haiku", localSettingsEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL],
    ["Auth token", style("dim", "[hidden]")],
    ["Bypass permissions", permissionConfig.bypass === "allow" ? "allowed by default" : "disabled"],
    ["Commit attribution", attributionSummary(attributionConfig)],
    ["Dry-run", dryRun ? "yes" : "no"],
    ["Will write", `CLAUDE.md (if missing), .claude/CLAUDE.md, .claude/settings.json, .claude/settings.local.json, .mcp.json, .repo-pattern/.repo-pattern.json, .repo-pattern/.repo-pattern.lock.json${writesGstack ? ", .claude/skills/gstack, generated gstack wrappers, .repo-pattern/gstack" : ""}${optionalSkills.length ? ", optional skill/plugin config" : ""}${hasLocalSkill ? ", .claude/skills" : ""}`],
    ["Will not write", hasLocalSkill || writesGstack ? ".claude/commands, .claude/hooks, .claude/scripts" : ".claude/skills, .claude/commands, .claude/hooks, .claude/scripts"]
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
  printBox("Already initialized", ["This target already looks like a repo-pattern setup."]);

  const action = await selectOne({
    message: "What do you want to do?",
    options: [
      { value: "doctor", label: "Run doctor" },
      { value: "mcp", label: "Regenerate MCP profile" },
      { value: "skills", label: "Add optional skills" },
      { value: "permissions", label: "Configure bypass permissions" },
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
  if (action === "permissions") {
    await updateClaudePermissions({ sourceRoot, target, permissionConfig: await choosePermissionConfig(), dryRun });
    if (!dryRun) await doctorProject(target, { updateLock: true, dryRun });
  }
  if (action === "attribution") {
    await updateClaudeAttribution({ sourceRoot, target, attributionConfig: await chooseAttributionConfig(), dryRun });
    if (!dryRun) await doctorProject(target, { updateLock: true, dryRun });
  }
}

export async function setupProject({ sourceRoot, target, profile = "web", setupPipeline = "ecc", planTuneHooks = false, dryRun = false, force = false, migrate = false, yes = false, applyRules = false, optionalSkills = [] }) {
  if (!SETUP_PIPELINES.includes(setupPipeline)) throw new Error(`Unknown setup pipeline: ${setupPipeline}. Available: ${SETUP_PIPELINES.join(", ")}`);
  if (planTuneHooks && !["gstack", "both"].includes(setupPipeline)) throw new Error("--with-plan-tune-hooks requires --setup-pipeline gstack or both.");
  if (!isInteractive()) {
    if (!yes) throw new Error("setup requires an interactive terminal, or pass --yes for scriptable mode.");
    if (profile === "custom") throw new Error("setup --yes cannot use the custom profile; choose a named profile.");

    const detection = await detectProject(target);
    const ruleConfig = defaultRuleConfig(setupPipeline, applyRules, detection);

    await provisionProject({
      sourceRoot,
      target,
      profile,
      setupPipeline,
      mcpValues: await readGeneratedMcpValues(target),
      dryRun,
      force,
      migrate,
      planTuneHooks,
      ruleMode: ruleConfig.ruleMode,
      rules: ruleConfig.rules,
      applyRules: ruleConfig.applyRules,
      optionalSkills
    });
    return;
  }

  printLogo();
  await checkClaudeCode();

  const previousOptions = await choosePreviousSetupOptions(target);
  const detection = await detectProject(target);
  const selectedSetupPipeline = previousOptions?.setupPipeline || await chooseSetupPipeline(setupPipeline);
  if (!SETUP_PIPELINES.includes(selectedSetupPipeline)) throw new Error(`Unknown setup pipeline: ${selectedSetupPipeline}. Available: ${SETUP_PIPELINES.join(", ")}`);
  const selectedPlanTuneHooks = previousOptions?.planTuneHooks ?? await choosePlanTuneHooks(selectedSetupPipeline, planTuneHooks);
  const chosenProfile = previousOptions?.profile || await chooseProfile(sourceRoot, profile, detection);
  const mcpConfig = previousOptions
    ? { profile: previousOptions.profile, mcpServers: previousOptions.mcpServers }
    : await chooseMcpConfig(sourceRoot, chosenProfile);
  const ruleConfig = previousOptions
    ? { applyRules: previousOptions.applyRules, ruleMode: previousOptions.ruleMode, rules: previousOptions.rules }
    : await chooseRuleConfig(detection, selectedSetupPipeline);
  const selectedOptionalSkills = previousOptions?.optionalSkills || await chooseOptionalSkills(optionalSkills);

  const audit = await auditProject(target);
  printAudit(audit);

  if (audit.state === "LEGACY_VENDOR" && force && !migrate) {
    throw new Error("Target has legacy/local Claude runtime surfaces. Re-run setup with --migrate, not --force.");
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
  const localSettingsTemplate = await readJson(path.join(sourceRoot, ".claude.example", "settings.local.example.json"), {});
  const defaultOverrides = Object.fromEntries([
    "CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION",
    "CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY"
  ].filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
  const retryLocalSettingsEnv = { ...localSettingsTemplate.env, ...previousOptions?.localSettingsEnv, ...currentSettingsEnv, ...defaultOverrides };
  const promptInitialValues = { ...previousOptions?.localSettingsEnv, ...currentSettingsEnv, ...defaultOverrides };
  const localSettingsEnv = previousOptions && !needsLocalSettingsPrompt(retryLocalSettingsEnv)
    ? retryLocalSettingsEnv
    : await chooseLocalSettingsEnv(retryLocalSettingsEnv, promptInitialValues);
  const permissionConfig = previousOptions?.permissionConfig || await choosePermissionConfig();
  const attributionConfig = previousOptions?.attributionConfig || await chooseAttributionConfig();

  if (!await confirmSummary({ action, setupPipeline: selectedSetupPipeline, planTuneHooks: selectedPlanTuneHooks, target, mcpConfig, mcpValues, ruleConfig, optionalSkills: selectedOptionalSkills, localSettingsEnv, attributionConfig, permissionConfig, dryRun })) {
    throw new Error("Setup cancelled.");
  }

  const retryOptions = setupRetryOptions({ action, setupPipeline: selectedSetupPipeline, planTuneHooks: selectedPlanTuneHooks, mcpConfig, mcpValues, ruleConfig, optionalSkills: selectedOptionalSkills, localSettingsEnv, attributionConfig, permissionConfig, dryRun });
  await writeSetupStatus(target, { status: "running", startedAt: new Date().toISOString(), failedStep: null, error: null, options: retryOptions }, { dryRun, silent: true });
  try {
    await provisionProject({
      sourceRoot,
      target,
      profile: mcpConfig.profile,
      setupPipeline: selectedSetupPipeline,
      planTuneHooks: selectedPlanTuneHooks,
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
      attributionConfig,
      permissionConfig,
      interactiveSetup: true,
      onBeforeSuccessSummary: () => writeSetupStatus(target, { status: "succeeded", succeededAt: new Date().toISOString(), failedStep: null, error: null, options: retryOptions }, { dryRun, silent: true })
    });
  } catch (error) {
    await writeSetupStatus(target, { status: "failed", failedAt: new Date().toISOString(), failedStep: "provision", error: error.message, options: retryOptions }, { dryRun, silent: true });
    throw error;
  }
}
