import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { auditProject, printAudit } from "./audit.mjs";
import { detectProject } from "./project-detect.mjs";
import { initProject } from "./init.mjs";
import { migrateProject } from "./migrate.mjs";
import { doctorProject } from "./doctor.mjs";
import { generateMcp } from "./mcp.mjs";
import { askConfirm, askPassword, askText, isInteractive, printBox, selectMany, selectOne } from "./prompt.mjs";
import { extraSkillOptions, licenseRiskSkillIds } from "./extra-skills.mjs";

const execFileAsync = promisify(execFile);

const PROFILES = [
  { value: "web", label: "web", description: "frontend/full-stack default" },
  { value: "minimal", label: "minimal", description: "smallest setup" },
  { value: "backend", label: "backend", description: "backend/API/codebase analysis" },
  { value: "research", label: "research", description: "docs/search/reasoning-heavy work" },
  { value: "full.local.example", label: "full.local.example", description: "all included example MCP servers" }
];

const LOCAL_SETTINGS_FIELDS = [
  ["ANTHROPIC_BASE_URL", "https://example.com/v1", askText],
  ["ANTHROPIC_AUTH_TOKEN", "", askPassword],
  ["ANTHROPIC_DEFAULT_OPUS_MODEL", "claude-opus-4-8", askText],
  ["ANTHROPIC_DEFAULT_SONNET_MODEL", "claude-sonnet-4-6", askText],
  ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "claude-haiku-4-5", askText],
  ["ANTHROPIC_DEFAULT_FABLE_MODEL", "replace-with-your-fable-model-id", askText]
];

function suggestedProfile(detection, fallback) {
  if (fallback && fallback !== "web") return fallback;
  if (["frontend", "fullstack", "node"].includes(detection.repoType)) return "web";
  if (detection.repoType === "backend") return "backend";
  return "minimal";
}

function selectedExtraSkillsLabel(extraSkills) {
  return extraSkills.length > 0 ? extraSkills.join(", ") : "none";
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

async function chooseExtraSkills(initialValues) {
  return selectMany({
    message: "Step 2/3 — Choose optional extra skills",
    options: extraSkillOptions(),
    initialValues
  });
}

async function chooseLocalSettingsEnv() {
  printBox("Step 3/3 — Local Claude provider settings", ["These values are written to .claude/settings.local.json and gitignored."]);
  const env = {};
  for (const [name, fallback, ask] of LOCAL_SETTINGS_FIELDS) {
    env[name] = await ask(name, { initial: process.env[name] || fallback });
  }
  return env;
}

async function confirmSummary({ action, target, profile, extraSkills, localSettingsEnv, dryRun }) {
  printBox("Setup summary", [
    `action: ${action}`,
    `target: ${target}`,
    `profile: ${profile}`,
    `extra skills: ${selectedExtraSkillsLabel(extraSkills)}`,
    `local settings: .claude/settings.local.json`,
    `base url: ${localSettingsEnv.ANTHROPIC_BASE_URL}`,
    `opus: ${localSettingsEnv.ANTHROPIC_DEFAULT_OPUS_MODEL}`,
    `sonnet: ${localSettingsEnv.ANTHROPIC_DEFAULT_SONNET_MODEL}`,
    `haiku: ${localSettingsEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL}`,
    `fable: ${localSettingsEnv.ANTHROPIC_DEFAULT_FABLE_MODEL}`,
    "auth token: [hidden]",
    `dry-run: ${dryRun ? "yes" : "no"}`
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
      { value: "exit", label: "Exit" }
    ],
    initialValue: "doctor"
  });

  if (action === "doctor") await doctorProject(target, { dryRun });
  if (action === "mcp") {
    const detection = await detectProject(target);
    const chosenProfile = await chooseProfile(profile, detection);
    await generateMcp({ sourceRoot, target, profile: chosenProfile, dryRun });
  }
}

export async function setupProject({ sourceRoot, target, profile = "web", dryRun = false, migrate = false, extraSkills = [], yesExtraSkillLicenseRisk = false }) {
  if (!isInteractive()) {
    throw new Error("setup requires an interactive terminal; use init --target ... --profile ... for scripts.");
  }

  printBox("repo-pattern setup", ["Guided terminal setup for Claude Code + ECC."]);
  await checkClaudeCode();

  const detection = await detectProject(target);
  const chosenProfile = await chooseProfile(profile, detection);
  const chosenExtraSkills = await chooseExtraSkills(extraSkills);
  const licenseRiskIds = licenseRiskSkillIds(chosenExtraSkills);
  const licenseRiskAccepted = yesExtraSkillLicenseRisk || (
    licenseRiskIds.length > 0 && await askConfirm(`Selected skill(s) need license review: ${licenseRiskIds.join(", ")}. Continue?`, false)
  );
  if (licenseRiskIds.length > 0 && !licenseRiskAccepted) throw new Error("Setup cancelled.");

  const audit = await auditProject(target);
  printAudit(audit);

  if (audit.state === "ECC_NATIVE_MINIMAL") {
    await handleInitialized({ sourceRoot, target, profile: chosenProfile, dryRun });
    return;
  }

  const action = audit.state === "LEGACY_VENDOR" ? "migrate" : "init";
  if (action === "migrate" && !migrate) {
    printBox("Migration required", ["Legacy/local Claude runtime surfaces detected.", "Recommended action: migrate, with backups."]);
    const confirmed = await askConfirm("Run migrate?", false);
    if (!confirmed) throw new Error("Setup cancelled.");
  }

  const localSettingsEnv = await chooseLocalSettingsEnv();

  if (!await confirmSummary({ action, target, profile: chosenProfile, extraSkills: chosenExtraSkills, localSettingsEnv, dryRun })) {
    throw new Error("Setup cancelled.");
  }

  const args = {
    sourceRoot,
    target,
    profile: chosenProfile,
    dryRun,
    extraSkills: chosenExtraSkills,
    noExtraSkills: chosenExtraSkills.length === 0,
    yesExtraSkillLicenseRisk: yesExtraSkillLicenseRisk || licenseRiskAccepted,
    localSettingsEnv
  };

  if (action === "migrate") await migrateProject(args);
  else await initProject(args);
}
