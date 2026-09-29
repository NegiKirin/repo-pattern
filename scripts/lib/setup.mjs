import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { auditProject } from "./audit.mjs";
import { detectProject } from "./project-detect.mjs";
import { provisionProject, updateClaudeAttribution, updateClaudePermissions } from "./provision.mjs";
import { doctorProject } from "./doctor.mjs";
import { collectMcpValues, generateMcp, listAvailableMcpServers, mcpInputFields, persistedMcpValues, readGeneratedMcpValues, readMcpConfig } from "./mcp.mjs";
import { askPassword, askText, DEFAULT_EFFORT_LEVEL, isInteractive, printBox, selectMany, selectOne } from "./prompt.mjs";
import { runSetupWizard } from "./setup-wizard.mjs";
import { ECC_RULE_PACKS, normalizeEccRules, selectEccRules } from "./ecc-rules.mjs";
import { ensureRepoPatternGitignore, isTracked, readJson, readPrivateJson, readRepoLock, repoLockPath, writeJson } from "./fs-utils.mjs";
import { applyOptionalSkills, groupedOptionalSkillOptions, OPTIONAL_SKILLS } from "./skills.mjs";

const execFileAsync = promisify(execFile);

export const DEFAULT_MCP_SERVERS = ["context7", "tavily", "gitnexus"];

export function groupedMcpOptions(servers) {
  const descriptions = Object.fromEntries(servers.map((server) => [server.value, server.hint]));
  const groupedServers = [
    ...DEFAULT_MCP_SERVERS,
    "chrome-devtools",
    "playwright",
    "shadcn",
    "shadcn-studio"
  ];
  const ungroupedServers = servers.filter((server) => !groupedServers.includes(server.value));
  return [
    { group: true, label: "Core / Must have" },
    ...DEFAULT_MCP_SERVERS.map((value) => ({ value, label: value, hint: descriptions[value] })),
    { group: true, label: "Development tools" },
    ...["chrome-devtools", "playwright"].map((value) => ({ value, label: value, hint: descriptions[value] })),
    { group: true, label: "UI / shadcn" },
    ...["shadcn", "shadcn-studio"].map((value) => ({ value, label: value, hint: descriptions[value] })),
    ...(ungroupedServers.length > 0 ? [{ group: true, label: "Other servers" }, ...ungroupedServers] : [])
  ];
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
  ["ANTHROPIC_BASE_URL", "https://example.com/v1", askText, validateUrl],
  ["ANTHROPIC_AUTH_TOKEN", "", askPassword, validateRequired],
  ["ANTHROPIC_DEFAULT_OPUS_MODEL", "claude-opus-4-8", askText, validateRequired],
  ["ANTHROPIC_DEFAULT_SONNET_MODEL", "claude-sonnet-4-6", askText, validateRequired],
  ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "claude-haiku-4-5", askText, validateRequired]
];
const RETRY_SECRET_LOCAL_SETTINGS = new Set(["ANTHROPIC_AUTH_TOKEN", "CONTEXT7_API_KEY", "TAVILY_API_KEY"]);
const LOCAL_SETTINGS_PLACEHOLDERS = { ANTHROPIC_AUTH_TOKEN: "sk-.............." };

function setupLockPath(target) {
  return repoLockPath(target);
}

function safeRetryLocalSettingsEnv(localSettingsEnv = {}) {
  return Object.fromEntries(Object.entries(localSettingsEnv).filter(([name]) => !RETRY_SECRET_LOCAL_SETTINGS.has(name)));
}

export function setupRetryOptions({ action, setupPipeline, planTuneHooks = false, mcpConfig, mcpValues = {}, ruleConfig, optionalSkills, localSettingsEnv, effortLevel = DEFAULT_EFFORT_LEVEL, attributionConfig, permissionConfig = { bypass: "deny" }, dryRun }) {
  return {
    action,
    setupPipeline,
    planTuneHooks,
    mcpServers: mcpConfig.mcpServers,
    mcpValueNames: Object.keys(persistedMcpValues(mcpValues)),
    migrate: action === "migrate",
    applyRules: ruleConfig.applyRules,
    ruleMode: ruleConfig.ruleMode,
    rules: ruleConfig.rules,
    optionalSkills,
    effortLevel,
    localSettingsEnv: safeRetryLocalSettingsEnv(localSettingsEnv),
    attributionConfig,
    permissionConfig,
    dryRun
  };
}

export function setupOptionsFromLock(lock) {
  const setup = lock?.setup;
  const options = setup?.options || null;
  if (options?.profile || lock?.mcp?.profile) throw new Error("MCP profiles are no longer supported. Rerun repo-pattern setup to choose MCP servers.");
  if (!["failed", "running"].includes(setup?.status)) return null;
  if (!options) return null;
  return {
    ...options,
    effortLevel: options.effortLevel || DEFAULT_EFFORT_LEVEL,
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

async function previousSetupOptions(target) {
  if (isTracked(target, ".repo-pattern/.repo-pattern.lock.json") || isTracked(target, ".repo-pattern.lock.json")) {
    throw new Error("repo-pattern lock is tracked. Untrack it before retrying setup.");
  }
  return setupOptionsFromLock(await readRepoLock(target, {}));
}


async function checkClaudeCode() {
  try {
    const { stdout } = await execFileAsync("claude", ["--version"]);
    return stdout.trim();
  } catch {
    throw new Error("Claude Code CLI is required. Install/login to Claude Code, then rerun setup.");
  }
}

export async function chooseMcpConfig(sourceRoot, initialValues = DEFAULT_MCP_SERVERS) {
  const availableServers = await listAvailableMcpServers(sourceRoot);
  return {
    mcpServers: await selectMany({
      message: "Choose MCP servers",
      options: groupedMcpOptions(availableServers.map((value) => ({ value, label: value }))),
      initialValues
    })
  };
}

async function chooseMcpValues(sourceRoot, mcpServers, values = {}) {
  const config = await readMcpConfig({ sourceRoot, mcpServers });
  return collectMcpValues(config.mcpServers, { values: persistedMcpValues(values) });
}

const SETUP_PIPELINES = ["ecc", "gstack", "both", "none"];

function selectedPipeline(values = []) {
  const selected = new Set(values);
  if (selected.has("ecc") && selected.has("gstack")) return "both";
  if (selected.has("gstack")) return "gstack";
  if (selected.has("ecc")) return "ecc";
  return "none";
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

export function interactiveSetupPipeline(previousOptions) {
  return previousOptions?.setupPipeline || "none";
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
    options: groupedOptionalSkillOptions(OPTIONAL_SKILLS),
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

async function handleInitialized({ sourceRoot, target, mcpServers, dryRun }) {
  printBox("Already initialized", ["This target already looks like a repo-pattern setup."]);

  const action = await selectOne({
    message: "What do you want to do?",
    options: [
      { value: "doctor", label: "Run doctor" },
      { value: "mcp", label: "Regenerate MCP servers" },
      { value: "skills", label: "Add optional skills" },
      { value: "permissions", label: "Configure bypass permissions" },
      { value: "attribution", label: "Update commit attribution" },
      { value: "exit", label: "Exit" }
    ],
    initialValue: "doctor"
  });

  if (action === "doctor") await doctorProject(target, { dryRun });
  if (action === "mcp") {
    const mcpConfig = await chooseMcpConfig(sourceRoot, mcpServers);
    const mcpValues = await chooseMcpValues(sourceRoot, mcpConfig.mcpServers, await readGeneratedMcpValues(target));
    await generateMcp({
      sourceRoot,
      target,
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

export async function setupProject({ sourceRoot, target, mcpServers = [], setupPipeline = "ecc", planTuneHooks = false, dryRun = false, force = false, migrate = false, yes = false, applyRules = false, optionalSkills = [] }) {
  if (!SETUP_PIPELINES.includes(setupPipeline)) throw new Error(`Unknown setup pipeline: ${setupPipeline}. Available: ${SETUP_PIPELINES.join(", ")}`);
  if (planTuneHooks && !["gstack", "both"].includes(setupPipeline)) throw new Error("--with-plan-tune-hooks requires --setup-pipeline gstack or both.");
  if (!isInteractive()) {
    if (!yes) throw new Error("setup requires an interactive terminal, or pass --yes for scriptable mode.");
    await previousSetupOptions(target);
    const detection = await detectProject(target);
    const ruleConfig = defaultRuleConfig(setupPipeline, applyRules, detection);

    await provisionProject({
      sourceRoot,
      target,
      mcpServers: mcpServers.length > 0 ? mcpServers : DEFAULT_MCP_SERVERS,
      setupPipeline,
      mcpValues: await readGeneratedMcpValues(target),
      dryRun,
      force,
      migrate,
      planTuneHooks,
      ruleMode: ruleConfig.ruleMode,
      rules: ruleConfig.rules,
      applyRules: ruleConfig.applyRules,
      optionalSkills,
      effortLevel: DEFAULT_EFFORT_LEVEL
    });
    return;
  }

  const claudeCodeVersion = await checkClaudeCode();

  const previousOptions = await previousSetupOptions(target);
  const detection = await detectProject(target);
  const audit = await auditProject(target);
  if (audit.state === "LEGACY_VENDOR" && force && !migrate) {
    throw new Error("Target has legacy/local Claude runtime surfaces. Re-run setup with --migrate, not --force.");
  }

  const action = audit.state === "LEGACY_VENDOR" ? "migrate" : "setup";
  const shouldMigrate = previousOptions?.migrate || migrate;

  const currentSettingsEnv = await currentLocalSettingsEnv(target);
  const generatedMcpValues = await readGeneratedMcpValues(target);
  const localSettingsTemplate = await readJson(path.join(sourceRoot, ".claude.example", "settings.local.example.json"), {});
  const defaultOverrides = Object.fromEntries([
    "CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION",
    "CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY"
  ].filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
  const retryLocalSettingsEnv = { ...localSettingsTemplate.env, ...previousOptions?.localSettingsEnv, ...currentSettingsEnv, ...defaultOverrides };
  const promptInitialValues = { ...previousOptions?.localSettingsEnv, ...currentSettingsEnv, ...defaultOverrides };
  const availableMcpServers = await listAvailableMcpServers(sourceRoot);
  const mcpDefinitions = Object.fromEntries(await Promise.all(availableMcpServers.map(async (name) => [name, (await readMcpConfig({ sourceRoot, mcpServers: [name] })).mcpServers])));
  const autoRules = selectEccRules(detection);
  const { state: wizardState, controller: wizardController } = await runSetupWizard({
    migrationChoice: action === "migrate" && !shouldMigrate ? "pending" : "yes",
    retryChoice: previousOptions ? "pending" : "none",
    setupPipeline: interactiveSetupPipeline(previousOptions),
    planTuneHooks: usesGstack(interactiveSetupPipeline(previousOptions)),
    applyRules: previousOptions?.applyRules || applyRules || usesEcc(interactiveSetupPipeline(previousOptions)),
    mcpServers: previousOptions?.mcpServers || (mcpServers.length > 0 ? mcpServers : DEFAULT_MCP_SERVERS),
    ruleMode: previousOptions?.ruleMode || "auto",
    rules: previousOptions?.rules || autoRules,
    optionalSkills: previousOptions?.optionalSkills || optionalSkills,
    mcpValues: persistedMcpValues(generatedMcpValues),
    localSettingsEnv: previousOptions && !needsLocalSettingsPrompt(retryLocalSettingsEnv) ? retryLocalSettingsEnv : promptInitialValues,
    effortLevel: previousOptions?.effortLevel || DEFAULT_EFFORT_LEVEL,
    permissionConfig: previousOptions?.permissionConfig || { bypass: "deny" },
    attributionConfig: previousOptions?.attributionConfig || { mode: "off" }
  }, {
    claudeCodeVersion,
    mcpServers: groupedMcpOptions(availableMcpServers.map((name) => ({ value: name, label: name, hint: mcpDefinitions[name]?.[name]?.description }))),
    mcpInputs: (selectedServers) => mcpInputFields(Object.assign({}, ...selectedServers.map((name) => mcpDefinitions[name] || {}))),
    ruleModes: [
      { value: "auto", label: "auto", hint: `detect from project (${autoRules.join(", ")})` },
      { value: "manual", label: "manual", hint: "choose rule packs by type" },
      { value: "none", label: "none", hint: "do not install project-local ECC rules" }
    ],
    rules: ECC_RULE_PACKS,
    optionalSkills: groupedOptionalSkillOptions(OPTIONAL_SKILLS),
    localSettings: LOCAL_SETTINGS_FIELDS.map(([name, fallback, ask, validate]) => ({
      name,
      initial: retryLocalSettingsEnv[name] || "",
      placeholder: LOCAL_SETTINGS_PLACEHOLDERS[name] || localSettingsPromptOptions(promptInitialValues)[name].placeholder || fallback,
      validate,
      mask: ask === askPassword
    }))
  });
  const selectedSetupPipeline = wizardState.setupPipeline;
  const selectedPlanTuneHooks = wizardState.planTuneHooks;
  const mcpConfig = { mcpServers: wizardState.mcpServers };
  const ruleConfig = !wizardState.applyRules || wizardState.ruleMode === "none"
    ? { applyRules: false, ruleMode: "auto", rules: [] }
    : { applyRules: true, ruleMode: wizardState.ruleMode, rules: wizardState.rules };
  const selectedOptionalSkills = wizardState.optionalSkills;
  const mcpValues = wizardState.mcpValues;
  const localSettingsEnv = { ...retryLocalSettingsEnv, ...wizardState.localSettingsEnv };
  const effortLevel = wizardState.effortLevel;
  const permissionConfig = wizardState.permissionConfig;
  const attributionConfig = wizardState.attributionConfig;

  const retryOptions = setupRetryOptions({ action, setupPipeline: selectedSetupPipeline, planTuneHooks: selectedPlanTuneHooks, mcpConfig, mcpValues, ruleConfig, optionalSkills: selectedOptionalSkills, localSettingsEnv, effortLevel, attributionConfig, permissionConfig, dryRun });
  await writeSetupStatus(target, { status: "running", startedAt: new Date().toISOString(), failedStep: null, error: null, options: retryOptions }, { dryRun, silent: true });
  try {
    await provisionProject({
      sourceRoot,
      target,
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
      effortLevel,
      attributionConfig,
      permissionConfig,
      interactiveSetup: true,
      renderProgress: wizardController.renderProgress,
      onBeforeSuccessSummary: () => writeSetupStatus(target, { status: "succeeded", succeededAt: new Date().toISOString(), failedStep: null, error: null, options: retryOptions }, { dryRun, silent: true })
    });
  } catch (error) {
    await writeSetupStatus(target, { status: "failed", failedAt: new Date().toISOString(), failedStep: "provision", error: error.message, options: retryOptions }, { dryRun, silent: true });
    throw error;
  } finally {
    wizardController.close();
  }
}
