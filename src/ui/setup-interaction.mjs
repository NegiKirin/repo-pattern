import { askConfirm, askPassword, askText, printBox, selectMany, selectOne } from "./prompt.mjs";
import { claudeVersionSupportsUserScope, setUserBypassPermission } from "../setup/bypass-permissions.mjs";
import { collectMcpValues, mcpInputFields, persistedMcpValues, readMcpConfig, listAvailableMcpServers } from "../mcp.mjs";
import { groupedOptionalSkillOptions, OPTIONAL_SKILLS } from "../skills.mjs";
import { ECC_RULE_PACKS, selectEccRules } from "../ecc/ecc-rules.mjs";
import { runSetupWizard } from "./setup-wizard.mjs";

export const DEFAULT_MCP_SERVERS = ["context7", "tavily", "gitnexus"];
export const defaultMcpServers = DEFAULT_MCP_SERVERS;

const LOCAL_SETTINGS_FIELDS = [
  ["ANTHROPIC_BASE_URL", "https://example.com/v1", askText, validateUrl],
  ["ANTHROPIC_AUTH_TOKEN", "", askPassword, validateRequired],
  ["ANTHROPIC_DEFAULT_OPUS_MODEL", "claude-opus-4-8", askText, validateRequired],
  ["ANTHROPIC_DEFAULT_SONNET_MODEL", "claude-sonnet-4-6", askText, validateRequired],
  ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "claude-haiku-4-5", askText, validateRequired]
];
const RETRY_SECRET_LOCAL_SETTINGS = new Set(["ANTHROPIC_AUTH_TOKEN", "CONTEXT7_API_KEY", "TAVILY_API_KEY"]);
const LOCAL_SETTINGS_PLACEHOLDERS = { ANTHROPIC_AUTH_TOKEN: "sk-.............." };

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

export async function chooseMcpConfig(sourceRoot, initialValues = DEFAULT_MCP_SERVERS, prompt = selectMany) {
  const availableServers = await listAvailableMcpServers(sourceRoot);
  return { mcpServers: await prompt({ message: "Choose MCP servers", options: groupedMcpOptions(availableServers.map((value) => ({ value, label: value }))), initialValues }) };
}

export async function chooseMcpValues(sourceRoot, mcpServers, values = {}, collect = collectMcpValues) {
  const config = await readMcpConfig({ sourceRoot, mcpServers });
  return collect(config.mcpServers, { values: persistedMcpValues(values) });
}

export async function chooseOptionalSkills(initialValues = [], prompt = selectMany) {
  return prompt({ message: "Step 3/6 — Optional external skills", options: groupedOptionalSkillOptions(OPTIONAL_SKILLS), initialValues });
}

export async function chooseAttributionConfig(select = selectOne, text = askText, print = printBox) {
  print("Step 6/6 — Claude Code commit attribution", ["Controls .claude/settings.json attribution.commit."]);
  const mode = await select({ message: "Commit attribution?", options: [{ value: "off", label: "off", description: "disable Co-Authored-By trailer" }, { value: "on", label: "on", description: "use Claude Code default" }, { value: "custom", label: "custom", description: "write your own commit attribution" }], initialValue: "off" });
  if (mode !== "custom") return { mode };
  return { mode, commit: await text("Custom commit attribution", { initial: "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>", validate: validateRequired }) };
}

export function groupedMcpOptions(servers) {
  const descriptions = Object.fromEntries(servers.map((server) => [server.value, server.hint]));
  const groupedServers = [...DEFAULT_MCP_SERVERS, "chrome-devtools", "playwright", "shadcn", "shadcn-studio"];
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

export function localSettingsPromptOptions(initialValues = {}, environment = process.env) {
  return Object.fromEntries(LOCAL_SETTINGS_FIELDS.map(([name, fallback, , validate]) => {
    const initial = environment[name] || initialValues[name] || "";
    return [name, { initial: validate(initial) === true ? initial : "", placeholder: fallback }];
  }));
}

export function needsLocalSettingsPrompt(values = {}) {
  return LOCAL_SETTINGS_FIELDS.some(([name, , , validate]) => validate(values[name]) !== true);
}

export function retryLocalSettingsEnv(localSettingsEnv = {}) {
  return Object.fromEntries(Object.entries(localSettingsEnv).filter(([name]) => !RETRY_SECRET_LOCAL_SETTINGS.has(name)));
}

export function localSettingsFields(retryLocalSettingsEnv, promptInitialValues) {
  return LOCAL_SETTINGS_FIELDS.map(([name, fallback, ask, validate]) => ({
    name,
    initial: retryLocalSettingsEnv[name] || "",
    placeholder: LOCAL_SETTINGS_PLACEHOLDERS[name] || localSettingsPromptOptions(promptInitialValues)[name].placeholder || fallback,
    validate,
    mask: ask === askPassword
  }));
}

export function setupInteractionData({ claudeCodeVersion, autoRules, availableMcpServers, mcpDefinitions, retryLocalSettingsEnv, promptInitialValues }) {
  return {
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
    localSettings: localSettingsFields(retryLocalSettingsEnv, promptInitialValues)
  };
}

export async function choosePermissionConfig({ claudeCodeVersion, migrationChoice, legacyBypass, selectedBypass, retryChoice, dryRun = false, confirm = askConfirm, setUserBypass = setUserBypassPermission }) {
  const supported = claudeVersionSupportsUserScope(claudeCodeVersion);
  if (retryChoice === "retry") {
    if (["user", "preserve"].includes(selectedBypass)) return { bypass: selectedBypass === "user" && !supported ? "allow" : selectedBypass };
    if (selectedBypass === "deny") return { bypass: "deny" };
  }
  if (dryRun && supported && (legacyBypass && migrationChoice === "yes" || selectedBypass === "allow")) {
    console.warn("WARN: Dry run does not change user settings; bypass permissions remain unchanged.");
    return { bypass: legacyBypass ? "preserve" : "deny" };
  }
  if (supported && legacyBypass && migrationChoice === "yes" && selectedBypass === "allow") {
    const transfer = await confirm("Enable bypassPermissions in user settings? User scope affects every project. Existing settings will not be overwritten; if a settings file exists, you must add this manually.", false);
    if (!transfer) {
      console.warn("WARN: Project bypassPermissions remains in project settings but is ineffective in Claude Code v2.1.257+.");
      return { bypass: "preserve" };
    }
    const result = await setUserBypass({ accepted: true });
    console.warn(`WARN: ${result.message}`);
    if (!result.changed && !result.alreadyEnabled) console.warn("WARN: Project bypassPermissions remains in project settings but is ineffective in Claude Code v2.1.257+.");
    return { bypass: result.changed || result.alreadyEnabled ? "user" : "preserve" };
  }
  if (!supported && legacyBypass) return { bypass: selectedBypass === "deny" ? "deny" : "allow" };
  if (supported && legacyBypass && migrationChoice === "no") {
    console.warn("WARN: Project bypassPermissions remains in project settings but is ineffective in Claude Code v2.1.257+.");
    return { bypass: "preserve" };
  }
  if (supported && legacyBypass && migrationChoice === "yes" && selectedBypass !== "allow") {
    console.warn("WARN: Project bypassPermissions remains in project settings but is ineffective in Claude Code v2.1.257+.");
    return { bypass: "preserve" };
  }
  const bypass = selectedBypass ?? await selectOne({
    message: supported ? "Allow bypass permissions mode? User scope affects every project. Existing settings will not be overwritten; if a settings file exists, you must add this manually." : "Step 5/6 — Allow bypass permissions mode?",
    options: [{ value: "deny", label: "No", description: "disable bypass permissions mode" }, { value: "allow", label: "Yes", description: supported ? "enable in user settings for every project" : "default to bypassPermissions" }],
    initialValue: "deny"
  });
  if (!supported || bypass !== "allow") return { bypass };
  if (dryRun) {
    console.warn("WARN: Dry run does not change user settings; bypass permissions remain unchanged.");
    return { bypass: legacyBypass ? "preserve" : "deny" };
  }
  if (!await confirm("Enable bypass permissions in ~/.claude/settings.json? This affects every project.", false)) {
    if (legacyBypass) console.warn("WARN: Project bypassPermissions remains in project settings but is ineffective in Claude Code v2.1.257+.");
    return { bypass: legacyBypass ? "preserve" : "deny" };
  }
  const result = await setUserBypass({ accepted: true });
  console.warn(`WARN: ${result.message}`);
  if (!result.changed && !result.alreadyEnabled && legacyBypass) console.warn("WARN: Project bypassPermissions remains in project settings but is ineffective in Claude Code v2.1.257+.");
  return { bypass: result.changed || result.alreadyEnabled ? "user" : legacyBypass ? "preserve" : "deny" };
}

export async function runSetupInteraction(initialState, data, options) {
  return runSetupWizard(initialState, data, options);
}

export function selectEccRuleDefaults(detection) {
  return selectEccRules(detection);
}
