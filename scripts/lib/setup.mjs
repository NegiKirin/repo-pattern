import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { auditProject, printAudit } from "./audit.mjs";
import { detectProject } from "./project-detect.mjs";
import { provisionProject } from "./provision.mjs";
import { doctorProject } from "./doctor.mjs";
import { collectMcpValues, generateMcp, listAvailableMcpServers, readMcpConfig } from "./mcp.mjs";
import { askConfirm, askPassword, askText, isInteractive, printBox, printLogo, printSummary, selectMany, selectOne, style } from "./prompt.mjs";
import { ECC_RULE_PACKS, selectEccRules } from "./ecc-rules.mjs";
import { applyOptionalSkills, OPTIONAL_SKILLS } from "./skills.mjs";

const execFileAsync = promisify(execFile);

const PROFILES = [
  { value: "web", label: "web", description: "frontend/full-stack default" },
  { value: "minimal", label: "minimal", description: "smallest setup" },
  { value: "backend", label: "backend", description: "backend/API/codebase analysis" },
  { value: "research", label: "research", description: "docs/search/reasoning-heavy work" },
  { value: "full", label: "full", description: "all included MCP servers" },
  { value: "custom", label: "custom", description: "choose exact MCP servers" }
];

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
  ["ANTHROPIC_AUTH_TOKEN", "", askPassword, null],
  ["ANTHROPIC_DEFAULT_OPUS_MODEL", "claude-opus-4-8", askText, validateRequired],
  ["ANTHROPIC_DEFAULT_SONNET_MODEL", "claude-sonnet-4-6", askText, validateRequired],
  ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "claude-haiku-4-5", askText, validateRequired]
];

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

async function chooseProfile(profile, detection) {
  return selectOne({
    message: "Step 1/3 — Choose MCP profile",
    options: PROFILES,
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

async function chooseMcpValues(sourceRoot, mcpConfig) {
  const { mcpServers } = await readMcpConfig({ sourceRoot, profile: mcpConfig.profile, mcpServers: mcpConfig.mcpServers });
  return collectMcpValues(mcpServers);
}

async function chooseRuleConfig(detection) {
  const autoRules = selectEccRules(detection);
  const ruleMode = await selectOne({
    message: "Step 2/4 — Choose ECC rule detection mode",
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
    message: "Step 3/4 — Optional external skills",
    options: OPTIONAL_SKILLS,
    initialValues
  });
}

async function chooseLocalSettingsEnv() {
  printBox("Step 4/4 — Local Claude provider settings", ["These values are written to .claude/settings.local.json and gitignored."]);
  const env = {};
  for (const [name, fallback, ask, validate] of LOCAL_SETTINGS_FIELDS) {
    env[name] = await ask(name, { initial: process.env[name] || fallback, validate });
  }
  return env;
}

async function confirmSummary({ action, target, mcpConfig, mcpValues, ruleConfig, optionalSkills, localSettingsEnv, dryRun }) {
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
    ["Dry-run", dryRun ? "yes" : "no"],
    ["Will write", `CLAUDE.md (if missing), .claude/CLAUDE.md, .claude/settings.json, .claude/settings.local.json, .mcp.json, .repo-pattern.json, .repo-pattern.lock.json${optionalSkills.length ? ", .claude/skills" : ""}`],
    ["Will not write", optionalSkills.length ? ".claude/commands, .claude/hooks, .claude/scripts" : ".claude/skills, .claude/commands, .claude/hooks, .claude/scripts"]
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
      { value: "exit", label: "Exit" }
    ],
    initialValue: "doctor"
  });

  if (action === "doctor") await doctorProject(target, { dryRun });
  if (action === "mcp") {
    const detection = await detectProject(target);
    const chosenProfile = await chooseProfile(profile, detection);
    const mcpConfig = await chooseMcpConfig(sourceRoot, chosenProfile);
    const mcpValues = await chooseMcpValues(sourceRoot, mcpConfig);
    await generateMcp({ sourceRoot, target, profile: mcpConfig.profile, mcpServers: mcpConfig.mcpServers, mcpValues, dryRun });
  }
  if (action === "skills") {
    const optionalSkills = await chooseOptionalSkills();
    await applyOptionalSkills({ target, skills: optionalSkills, dryRun });
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

    await provisionProject({ sourceRoot, target, profile, dryRun, force, migrate, applyRules, optionalSkills });
    return;
  }

  printLogo();
  await checkClaudeCode();

  const detection = await detectProject(target);
  const chosenProfile = await chooseProfile(profile, detection);
  const mcpConfig = await chooseMcpConfig(sourceRoot, chosenProfile);
  const ruleConfig = await chooseRuleConfig(detection);
  const selectedOptionalSkills = await chooseOptionalSkills(optionalSkills);

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
  if (action === "migrate" && !migrate) {
    printBox("Migration required", ["Legacy/local Claude runtime surfaces detected.", "Recommended action: migrate, with backups."]);
    const confirmed = await askConfirm("Run migrate?", false);
    if (!confirmed) throw new Error("Setup cancelled.");
  }

  const mcpValues = await chooseMcpValues(sourceRoot, mcpConfig);
  const localSettingsEnv = await chooseLocalSettingsEnv();

  if (!await confirmSummary({ action, target, mcpConfig, mcpValues, ruleConfig, optionalSkills: selectedOptionalSkills, localSettingsEnv, dryRun })) {
    throw new Error("Setup cancelled.");
  }

  await provisionProject({
    sourceRoot,
    target,
    profile: mcpConfig.profile,
    mcpServers: mcpConfig.mcpServers,
    mcpValues,
    dryRun,
    force: false,
    migrate: action === "migrate",
    ruleMode: ruleConfig.ruleMode,
    rules: ruleConfig.rules,
    applyRules: ruleConfig.applyRules,
    optionalSkills: selectedOptionalSkills,
    localSettingsEnv
  });
}
