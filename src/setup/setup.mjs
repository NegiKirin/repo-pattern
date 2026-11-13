import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { auditProject, printAudit } from "../audit.mjs";
import { detectProject } from "../project-detect.mjs";
import { provisionProject } from "./provision.mjs";
import { choosePermissionConfig, defaultMcpServers, localSettingsPromptOptions, needsLocalSettingsPrompt, retryLocalSettingsEnv, runSetupInteraction, selectEccRuleDefaults, setupInteractionData } from "../ui/setup-interaction.mjs";
import { persistedMcpValues, readGeneratedMcpValues, listAvailableMcpServers, readMcpConfig } from "../mcp.mjs";
import { DEFAULT_EFFORT_LEVEL, isInteractive, printSummary, style } from "../ui/prompt.mjs";
import { createSetupProgress } from "../ui/progress.mjs";
export {
  DEFAULT_MCP_SERVERS,
  chooseMcpConfig,
  choosePermissionConfig,
  groupedMcpOptions,
  localSettingsPromptOptions,
  needsLocalSettingsPrompt
} from "../ui/setup-interaction.mjs";
import { ensureRepoPatternGitignore, isTracked, readJson, readPrivateJson, readRepoLock, repoLockPath, writePrivateJson } from "../shared/fs-utils.mjs";
import { rejectClaudeSymlink } from "./settings.mjs";

const execFileAsync = promisify(execFile);


function setupLockPath(target) {
  return repoLockPath(target);
}

function safeRetryLocalSettingsEnv(localSettingsEnv = {}) {
  return retryLocalSettingsEnv(localSettingsEnv);
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
    permissionConfig: ["allow", "deny", "user", "preserve"].includes(options.permissionConfig?.bypass)
      ? { bypass: options.permissionConfig.bypass }
      : { bypass: "deny" }
  };
}

async function writeSetupStatus(target, setup, { dryRun = false, silent = false } = {}) {
  await rejectClaudeSymlink(target, { dryRun });
  const file = setupLockPath(target);
  await ensureRepoPatternGitignore(target, { dryRun, silent });
  const lock = await readPrivateJson(file, {}, {
    label: ".repo-pattern/.repo-pattern.lock.json",
    parentLabel: ".repo-pattern"
  });
  lock.setup = { ...(lock.setup || {}), ...setup };
  await writePrivateJson(file, lock, {
    dryRun,
    silent,
    label: ".repo-pattern/.repo-pattern.lock.json",
    parentLabel: ".repo-pattern"
  });
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


async function checkClaudeCode(exec = execFileAsync) {
  try {
    const { stdout } = await exec("claude", ["--version"]);
    return stdout.trim();
  } catch {
    throw new Error("Claude Code CLI is required. Install/login to Claude Code, then rerun setup.");
  }
}

const SETUP_PIPELINES = ["ecc", "gstack", "both", "none"];
function usesEcc(setupPipeline) {
  return setupPipeline === "ecc" || setupPipeline === "both";
}

function usesGstack(setupPipeline) {
  return setupPipeline === "gstack" || setupPipeline === "both";
}

export function interactiveSetupPipeline(previousOptions) {
  return previousOptions?.setupPipeline || "none";
}

function defaultRuleConfig(setupPipeline, applyRules, detection) {
  const shouldApplyRules = usesEcc(setupPipeline) || applyRules;
  return {
    applyRules: shouldApplyRules,
    ruleMode: "auto",
    rules: shouldApplyRules ? selectEccRuleDefaults(detection) : []
  };
}

const defaultOutput = { summary: printSummary, audit: printAudit, style, warn: console.warn };
const defaultProgressAdapter = { create: createSetupProgress };

export async function setupProject({ sourceRoot, target, mcpServers = [], setupPipeline = "ecc", planTuneHooks = false, dryRun = false, force = false, migrate = false, yes = false, applyRules = false, optionalSkills = [], output = defaultOutput, progressAdapter = defaultProgressAdapter, checkClaude = checkClaudeCode, interactionRunner = runSetupInteraction, provision = provisionProject }) {
  if (!SETUP_PIPELINES.includes(setupPipeline)) throw new Error(`Unknown setup pipeline: ${setupPipeline}. Available: ${SETUP_PIPELINES.join(", ")}`);
  if (planTuneHooks && !["gstack", "both"].includes(setupPipeline)) throw new Error("--with-plan-tune-hooks requires --setup-pipeline gstack or both.");
  if (!isInteractive()) {
    if (!yes) throw new Error("setup requires an interactive terminal, or pass --yes for scriptable mode.");
    console.warn("WARN: --yes disables bypass permissions without editing user settings. Existing project bypass settings are removed during setup; use interactive setup to review them.");
    await previousSetupOptions(target);
    const detection = await detectProject(target);
    const ruleConfig = defaultRuleConfig(setupPipeline, applyRules, detection);

    await provision({
      sourceRoot,
      target,
      mcpServers: mcpServers.length > 0 ? mcpServers : defaultMcpServers,
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
      effortLevel: DEFAULT_EFFORT_LEVEL,
      permissionConfig: { bypass: "deny" },
      output,
      progressAdapter
    });
    return;
  }

  const claudeCodeVersion = await checkClaude();

  const previousOptions = await previousSetupOptions(target);
  const detection = await detectProject(target);
  const audit = await auditProject(target);
  if (audit.state === "LEGACY_VENDOR" && force && !migrate) {
    throw new Error("Target has legacy/local Claude runtime surfaces. Re-run setup with --migrate, not --force.");
  }

  const action = audit.state === "LEGACY_VENDOR" ? "migrate" : "setup";
  const requestedMigrate = previousOptions?.migrate || migrate;

  let legacyBypass = false;
  try {
    const projectSettings = await readPrivateJson(path.join(target, ".claude", "settings.json"), {}, { label: ".claude/settings.json", parentLabel: ".claude" });
    legacyBypass = projectSettings.permissions?.defaultMode === "bypassPermissions";
  } catch (error) {
    if (error instanceof SyntaxError) console.warn(`WARN: Existing .claude/settings.json is malformed; fix it before running setup: ${error.message}`);
    else throw error;
  }
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
  const autoRules = selectEccRuleDefaults(detection);
  const initialState = {
    migrationChoice: action === "migrate" && !requestedMigrate ? "pending" : "yes",
    retryChoice: previousOptions ? "pending" : "none",
    setupPipeline: interactiveSetupPipeline(previousOptions),
    planTuneHooks: usesGstack(interactiveSetupPipeline(previousOptions)),
    applyRules: previousOptions?.applyRules || applyRules || usesEcc(interactiveSetupPipeline(previousOptions)),
    mcpServers: previousOptions?.mcpServers || (mcpServers.length > 0 ? mcpServers : defaultMcpServers),
    ruleMode: previousOptions?.ruleMode || "auto",
    rules: previousOptions?.rules || autoRules,
    optionalSkills: previousOptions?.optionalSkills || optionalSkills,
    mcpValues: persistedMcpValues(generatedMcpValues),
    localSettingsEnv: previousOptions && !needsLocalSettingsPrompt(retryLocalSettingsEnv) ? retryLocalSettingsEnv : promptInitialValues,
    effortLevel: previousOptions?.effortLevel || DEFAULT_EFFORT_LEVEL,
    permissionConfig: previousOptions?.permissionConfig || { bypass: "deny" },
    attributionConfig: previousOptions?.attributionConfig || { mode: "off" }
  };
  const interactionData = setupInteractionData({ claudeCodeVersion, autoRules, availableMcpServers, mcpDefinitions, retryLocalSettingsEnv, promptInitialValues });
  const { state: wizardState, controller: wizardController } = await interactionRunner(initialState, { ...interactionData, legacyBypass });
  const shouldMigrate = wizardState.migrationChoice === "no" ? false : requestedMigrate || action === "migrate";
  const permissionConfig = await choosePermissionConfig({
    claudeCodeVersion,
    migrationChoice: wizardState.migrationChoice,
    legacyBypass,
    selectedBypass: wizardState.permissionConfig.bypass,
    retryChoice: wizardState.retryChoice,
    dryRun
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
  const attributionConfig = wizardState.attributionConfig;

  const retryOptions = setupRetryOptions({ action, setupPipeline: selectedSetupPipeline, planTuneHooks: selectedPlanTuneHooks, mcpConfig, mcpValues, ruleConfig, optionalSkills: selectedOptionalSkills, localSettingsEnv, effortLevel, attributionConfig, permissionConfig, dryRun });
  await writeSetupStatus(target, { status: "running", startedAt: new Date().toISOString(), failedStep: null, error: null, options: retryOptions }, { dryRun, silent: true });
  try {
    await provision({
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
      output,
      progressAdapter: { create: (plan, options) => progressAdapter.create(plan, { ...options, interactive: true, ansi: true, renderProgress: wizardController.renderProgress }) },
      onBeforeSuccessSummary: () => writeSetupStatus(target, { status: "succeeded", succeededAt: new Date().toISOString(), failedStep: null, error: null, options: retryOptions }, { dryRun, silent: true })
    });
  } catch (error) {
    await writeSetupStatus(target, { status: "failed", failedAt: new Date().toISOString(), failedStep: "provision", error: error.message, options: retryOptions }, { dryRun, silent: true });
    throw error;
  } finally {
    wizardController.close();
  }
}
