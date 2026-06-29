import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { backupPaths, ensureDir, exists, readJson, removePath, writeJson } from "./fs-utils.mjs";
import { askConfirm, askText, isInteractive } from "./prompt.mjs";

export const EXTRA_SKILLS = [
  {
    id: "documentation-specialist",
    name: "Documentation Specialist",
    purpose: "SRS, PRD, SDD, OpenAPI, docs and diagrams",
    repo: "https://github.com/SpillwaveSolutions/document-specialist-skill.git",
    targetDir: ".claude/skills/documentation-specialist",
    license: "unknown",
    warning: "no visible upstream license; review before use"
  },
  {
    id: "taste-skill",
    name: "Taste Skill",
    purpose: "anti-slop frontend/UI design skills",
    repo: "https://github.com/leonxlnx/taste-skill.git",
    targetDir: ".claude/skills/taste-skill",
    license: "MIT",
    // ponytail: clone the full repo now; split sub-skills later if users need smaller installs.
    warning: "clones full upstream repo"
  }
];

const EXTRA_SKILL_IDS = new Set(EXTRA_SKILLS.map((skill) => skill.id));

function skillById(id) {
  return EXTRA_SKILLS.find((skill) => skill.id === id);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function parseSelection(text) {
  return unique(text.split(",").map((part) => part.trim()).filter(Boolean).map((token) => {
    const n = Number(token);
    if (Number.isInteger(n) && n >= 1 && n <= EXTRA_SKILLS.length) return EXTRA_SKILLS[n - 1].id;
    return token;
  }));
}

function validateSkillIds(ids) {
  const unknown = ids.filter((id) => !EXTRA_SKILL_IDS.has(id));
  if (unknown.length > 0) throw new Error(`Unknown extra skill(s): ${unknown.join(", ")}`);
}

function runGit(args, cwd) {
  execFileSync("git", args, { cwd, stdio: "inherit" });
}

function isGitIgnored(root, relPath) {
  try {
    execFileSync("git", ["check-ignore", "--quiet", relPath], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function confirmLicenseRisk(ids, yesExtraSkillLicenseRisk) {
  const risky = ids.filter((id) => skillById(id)?.license === "unknown");
  if (risky.length === 0) return [];
  if (yesExtraSkillLicenseRisk) return risky;
  if (!isInteractive()) {
    throw new Error(`Extra skill requires license-risk acceptance: ${risky.join(", ")}. Re-run with --yes-extra-skill-license-risk.`);
  }

  const accepted = await askConfirm(`Install license-unclear skill(s) ${risky.join(", ")}?`, false);
  if (!accepted) throw new Error("Extra skill install cancelled.");
  return risky;
}

async function promptForExtraSkills() {
  console.log("\nOptional extra skills (copied into target .claude/skills only if selected):");
  console.log("#  id                         license   purpose");
  EXTRA_SKILLS.forEach((skill, index) => {
    console.log(`${index + 1}. ${skill.id.padEnd(26)} ${skill.license.padEnd(9)} ${skill.purpose}`);
    if (skill.warning) console.log(`   warning: ${skill.warning}`);
  });

  const answer = await askText("Select extra skills by number/id, comma-separated (Enter for none): ");
  return parseSelection(answer);
}

async function resolveSelection({ extraSkills = [], noExtraSkills = false, yesExtraSkillLicenseRisk = false } = {}) {
  if (noExtraSkills && extraSkills.length > 0) throw new Error("Use either --no-extra-skills or --extra-skill, not both.");

  let selected = unique(extraSkills);
  let selectionSource = "flag";

  if (noExtraSkills) {
    selected = [];
    selectionSource = "explicit-none";
  } else if (selected.length === 0 && isInteractive()) {
    selected = await promptForExtraSkills();
    selectionSource = "prompt";
  } else if (selected.length === 0) {
    selectionSource = "non-tty-default";
    console.log("No TTY detected; skipping optional extra skills. Use --extra-skill <id> to opt in or --no-extra-skills to silence this message.");
  }

  validateSkillIds(selected);
  const licenseRiskAccepted = await confirmLicenseRisk(selected, yesExtraSkillLicenseRisk);
  return { selected, selectionSource, licenseRiskAccepted };
}

async function cloneSkill(target, skill, { dryRun = false } = {}) {
  const dest = path.join(target, skill.targetDir);
  await backupPaths(target, [skill.targetDir], { dryRun });
  await removePath(dest, { dryRun });

  if (dryRun) {
    console.log(`[dry-run] git clone --depth 1 ${skill.repo} ${dest}`);
    return;
  }

  await ensureDir(path.dirname(dest));
  console.log(`Cloning extra skill ${skill.id}: ${skill.repo}`);
  runGit(["clone", "--depth", "1", skill.repo, dest], target);
}

async function updateExtraSkillMetadata(target, result, { dryRun = false } = {}) {
  const lockPath = path.join(target, ".repo-pattern.lock.json");
  const lock = await readJson(lockPath, {});
  const now = new Date().toISOString();
  lock.extraSkills = {
    catalogVersion: 1,
    selectionSource: result.selectionSource,
    installMode: "target-local-git-clone",
    selected: result.selected,
    installedPaths: result.selected.map((id) => skillById(id).targetDir),
    licenseRiskAccepted: result.licenseRiskAccepted,
    selectedAt: now,
    installedAt: result.selected.length > 0 ? now : null
  };
  await writeJson(lockPath, lock, { dryRun });

  const repoConfigPath = path.join(target, ".repo-pattern.json");
  const repoConfig = await readJson(repoConfigPath, {});
  repoConfig.runtime = {
    ...(repoConfig.runtime || {}),
    localSkills: result.selected.length > 0 ? "explicit-extra-only" : false
  };
  await writeJson(repoConfigPath, repoConfig, { dryRun });
}

export async function installExtraSkills({ target, extraSkills = [], noExtraSkills = false, yesExtraSkillLicenseRisk = false, dryRun = false } = {}) {
  const result = await resolveSelection({ extraSkills, noExtraSkills, yesExtraSkillLicenseRisk });

  if (result.selected.length === 0) {
    console.log("No optional extra skills selected.");
    await updateExtraSkillMetadata(target, result, { dryRun });
    return result;
  }

  await ensureDir(path.join(target, ".claude", "skills"), { dryRun });
  for (const id of result.selected) {
    await cloneSkill(target, skillById(id), { dryRun });
  }

  await updateExtraSkillMetadata(target, result, { dryRun });
  console.log(`Installed optional extra skills: ${result.selected.join(", ")}`);
  return result;
}

export async function listLocalSkillDirs(target) {
  const dir = path.join(target, ".claude", "skills");
  if (!exists(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export function extraSkillOptions() {
  return EXTRA_SKILLS.map((skill) => ({
    value: skill.id,
    label: `${skill.id} (${skill.license})`,
    description: [skill.purpose, skill.warning].filter(Boolean).join(" • ")
  }));
}

export function licenseRiskSkillIds(ids) {
  return ids.filter((id) => skillById(id)?.license === "unknown");
}

export function knownExtraSkillIds() {
  return [...EXTRA_SKILL_IDS];
}

export function allowedExtraSkillIdsFromLock(lock) {
  return (lock.extraSkills?.selected || []).filter((id) => EXTRA_SKILL_IDS.has(id));
}

export async function unmanagedLocalSkillDirs(target, lock = null) {
  const actual = await listLocalSkillDirs(target);
  const allowed = new Set(allowedExtraSkillIdsFromLock(lock || await readJson(path.join(target, ".repo-pattern.lock.json"), {})));
  return actual.filter((id) => !allowed.has(id) && !isGitIgnored(target, path.join(".claude", "skills", id)));
}
