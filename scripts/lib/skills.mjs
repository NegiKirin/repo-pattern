import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { appendGitignoreLine, backupPaths, copyRecursive, ensureDir, exists, readJson, removePath, writeJson } from "./fs-utils.mjs";
import { isInteractive, printSummary, withSpinner } from "./prompt.mjs";

const execFileAsync = promisify(execFile);

export const OPTIONAL_SKILLS = [
  {
    value: "taste",
    label: "taste",
    description: "UI taste/design skills (MIT)",
    source: "https://github.com/Leonxlnx/taste-skill.git",
    revision: "b17742737e796305d829b3ad39eda3add0d79060",
    license: "MIT",
    installedDirs: ["brandkit", "brutalist-skill", "gpt-tasteskill", "imagegen-frontend-mobile", "imagegen-frontend-web", "image-to-code-skill", "minimalist-skill", "output-skill", "redesign-skill", "soft-skill", "stitch-skill", "taste-skill", "taste-skill-v1"],
    sourceDir: "skills"
  },
  {
    value: "document-specialist",
    label: "document-specialist",
    description: "documentation specialist skill (license not declared; user opt-in only)",
    source: "https://github.com/SpillwaveSolutions/document-specialist-skill.git",
    revision: "4d50d302b9f40e8eafec72d78a86676cdd9511ac",
    license: "NOASSERTION",
    installedDirs: ["document-specialist-skill"],
    destName: "document-specialist-skill"
  }
];

function knownSkill(value) {
  return OPTIONAL_SKILLS.find((skill) => skill.value === value);
}

export function normalizeOptionalSkills(skills = []) {
  return [...new Set((skills || []).filter(Boolean))];
}

export function invalidOptionalSkills(skills = []) {
  return normalizeOptionalSkills(skills).filter((skill) => !knownSkill(skill));
}

export function expectedOptionalSkillDirs(optionalSkills = []) {
  return [...new Set(optionalSkills.flatMap((entry) => {
    const skill = knownSkill(entry?.name);
    if (!skill || skill.source !== entry?.source || skill.revision !== entry?.revision) return [];
    return skill.installedDirs;
  }))].sort();
}

function runGit(args, cwd, { quiet = false } = {}) {
  execFileSync("git", args, {
    cwd,
    stdio: quiet ? "ignore" : "inherit"
  });
}

function gitOutput(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function runGitAsync(args, cwd) {
  await execFileAsync("git", args, { cwd });
}

function verifyRevision(cacheDir, skill) {
  const actual = gitOutput(["rev-parse", "HEAD"], cacheDir);
  if (actual !== skill.revision) throw new Error(`${skill.value} cache revision mismatch: expected ${skill.revision}, got ${actual}`);
}

async function rejectSymlinks(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Optional skill source contains symlink: ${fullPath}`);
    if (entry.isDirectory()) await rejectSymlinks(fullPath);
  }
}

async function syncSkillCache(target, skill, { dryRun = false } = {}) {
  const cacheRoot = path.join(target, ".repo-pattern", "cache", "skills");
  const cacheDir = path.join(cacheRoot, skill.value);

  if (exists(path.join(cacheDir, ".git"))) {
    if (!dryRun) {
      runGit(["fetch", "--quiet", "origin", skill.revision], cacheDir);
      runGit(["checkout", "--quiet", skill.revision], cacheDir);
      verifyRevision(cacheDir, skill);
    }
    return cacheDir;
  }

  if (dryRun) {
    console.log(`[dry-run] git clone ${skill.source} ${cacheDir}`);
    console.log(`[dry-run] git -C ${cacheDir} checkout ${skill.revision}`);
    return cacheDir;
  }

  await ensureDir(cacheRoot);
  if (isInteractive()) {
    await withSpinner(`Syncing ${skill.value}`, async () => {
      await runGitAsync(["clone", "--quiet", skill.source, cacheDir], target);
      await runGitAsync(["checkout", "--quiet", skill.revision], cacheDir);
    });
  } else {
    console.log(`Syncing ${skill.value} from ${skill.source}`);
    runGit(["clone", skill.source, cacheDir], target);
    runGit(["checkout", "--quiet", skill.revision], cacheDir);
  }
  verifyRevision(cacheDir, skill);
  return cacheDir;
}

async function copySkill(skill, cacheDir, destRoot, { dryRun = false } = {}) {
  if (skill.sourceDir) {
    const sourceDir = path.join(cacheDir, skill.sourceDir);
    if (!dryRun && !exists(sourceDir)) throw new Error(`${skill.value} source dir not found: ${skill.sourceDir}`);
    if (dryRun) {
      await copyRecursive(sourceDir, destRoot, { dryRun });
      return [skill.sourceDir];
    }
    await rejectSymlinks(sourceDir);
    const installedDirs = [];
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isDirectory())) {
      await copyRecursive(path.join(sourceDir, entry.name), path.join(destRoot, entry.name), { dryRun });
      installedDirs.push(entry.name);
    }
    return installedDirs;
  }

  await rejectSymlinks(cacheDir);
  const dest = path.join(destRoot, skill.destName);
  await copyRecursive(cacheDir, dest, { dryRun });
  await removePath(path.join(dest, ".git"), { dryRun });
  return [skill.destName];
}

export async function applyOptionalSkills({ target, skills = [], dryRun = false }) {
  const selected = normalizeOptionalSkills(skills);
  const invalid = invalidOptionalSkills(selected);
  if (invalid.length > 0) throw new Error(`Unknown optional skill(s): ${invalid.join(", ")}`);
  if (selected.length === 0) return { selectedSkills: [], appliedSkills: [] };

  const chosen = selected.map(knownSkill);
  const destRoot = path.join(target, ".claude", "skills");
  await backupPaths(target, [".claude/skills"], { dryRun });
  await removePath(destRoot, { dryRun });
  await ensureDir(destRoot, { dryRun });
  await appendGitignoreLine(target, ".repo-pattern/", { dryRun });

  const appliedSkills = [];
  for (const skill of chosen) {
    const cacheDir = await syncSkillCache(target, skill, { dryRun });
    const installedDirs = await copySkill(skill, cacheDir, destRoot, { dryRun });
    appliedSkills.push({ name: skill.value, source: skill.source, revision: skill.revision, license: skill.license, installedDirs });
  }

  if (dryRun) console.log(`[dry-run] rm -rf ${path.join(target, ".repo-pattern")}`);
  else await removePath(path.join(target, ".repo-pattern"));

  const repoConfigPath = path.join(target, ".repo-pattern.json");
  const repoConfig = await readJson(repoConfigPath, {});
  repoConfig.runtime = { ...(repoConfig.runtime || {}), localSkills: true };
  repoConfig.optionalSkills = appliedSkills.map(({ name, source, revision, license, installedDirs }) => ({ name, source, revision, license, installedDirs }));
  await writeJson(repoConfigPath, repoConfig, { dryRun });

  const lockPath = path.join(target, ".repo-pattern.lock.json");
  const lock = await readJson(lockPath, {});
  lock.optionalSkills = { appliedSkills, appliedAt: new Date().toISOString() };
  await writeJson(lockPath, lock, { dryRun });

  printSummary("Applied optional skills", [
    ["Path", path.relative(target, destRoot)],
    ["Skills", selected.join(", ")]
  ]);

  return { selectedSkills: selected, appliedSkills };
}
