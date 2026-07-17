import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { appendGitignoreLine, backupPaths, copyRecursive, ensureDir, exists, isTracked, readJson, removePath, writeJson } from "./fs-utils.mjs";
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
    plugin: { marketplace: "taste-skill", name: "taste-skill" },
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
  },
  {
    value: "ui-ux-pro-max",
    label: "ui-ux-pro-max",
    description: "UI/UX design intelligence skill (MIT; requires Python 3.x)",
    source: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git",
    revision: "4baa399d00da806f83ed93652172f66943205153",
    license: "MIT",
    plugin: { marketplace: "ui-ux-pro-max-skill", name: "ui-ux-pro-max" },
    installedDirs: ["ui-ux-pro-max"],
    sourceSubdir: ".claude/skills/ui-ux-pro-max",
    destName: "ui-ux-pro-max"
  },
  {
    value: "impeccable",
    label: "impeccable",
    description: "visual design QA plugin (Apache-2.0)",
    source: "https://github.com/pbakaus/impeccable.git",
    revision: "88f52ac4e6a5ce99d39a0f5d89e7ac3a168910f5",
    license: "Apache-2.0",
    plugin: { marketplace: "impeccable", name: "impeccable" },
    installedDirs: ["impeccable"],
    sourceSubdir: ".claude/skills/impeccable",
    destName: "impeccable",
    partialClone: true
  },
  {
    value: "huashu-design",
    label: "huashu-design",
    description: "multimedia design skill (MIT; may require Node, Playwright, Python, ffmpeg)",
    source: "https://github.com/alchaincyf/huashu-design.git",
    revision: "0e7ec8aca0058184c1a9e06e57697e84f68a3f0f",
    license: "MIT",
    installedDirs: ["huashu-design"],
    includePaths: ["SKILL.md", "assets", "references", "scripts", "demos", "package.json", "package-lock.json", "README.md", "README.en.md", "LICENSE"],
    destName: "huashu-design",
    partialClone: true
  },
  {
    value: "nextjs-pattern",
    label: "nextjs-pattern",
    description: "Next.js project pattern skill (MIT)",
    source: "https://github.com/NegiKirin/nextjs-pattern.git",
    revision: "d5b1ac4ea33f6054841ed9d8005ac587ab2a9a5d",
    license: "MIT",
    installedDirs: ["nextjs-pattern"],
    destName: "nextjs-pattern"
  },
  {
    value: "fastapi-pattern",
    label: "fastapi-pattern",
    description: "FastAPI project pattern skill (MIT)",
    source: "https://github.com/NegiKirin/fastapi-pattern.git",
    revision: "3abf484af46765c01a476b2ef61bb211b2b5bab8",
    license: "MIT",
    installedDirs: ["fastapi-pattern"],
    destName: "fastapi-pattern"
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
    if (!skill || skill.source !== entry?.source || skill.revision !== entry?.revision || skill.plugin) return [];
    return skill.installedDirs;
  }))].sort();
}

function pluginId(skill) {
  return `${skill.plugin.name}@${skill.plugin.marketplace}`;
}

export function applyPluginSkillSettings(settings = {}, skills = []) {
  const next = {
    ...settings,
    enabledPlugins: { ...(settings.enabledPlugins || {}) },
    extraKnownMarketplaces: { ...(settings.extraKnownMarketplaces || {}) }
  };
  for (const skill of skills) {
    next.enabledPlugins[pluginId(skill)] = true;
    next.extraKnownMarketplaces[skill.plugin.marketplace] = {
      source: {
        source: "git",
        url: skill.source
      }
    };
  }
  return next;
}

async function writePluginSkillSettings({ target, skills, dryRun }) {
  if (skills.length === 0) return;
  if (isTracked(target, ".claude/settings.local.json")) throw new Error(".claude/settings.local.json is tracked. Untrack it before writing local plugin settings.");
  const file = path.join(target, ".claude", "settings.local.json");
  await writeJson(file, applyPluginSkillSettings(await readJson(file, {}), skills), { dryRun });
  await appendGitignoreLine(target, ".claude/", { dryRun });
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
  const stat = await fs.lstat(root);
  if (stat.isSymbolicLink()) throw new Error(`Optional skill source contains symlink: ${root}`);
  if (!stat.isDirectory()) return;

  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    await rejectSymlinks(path.join(root, entry.name));
  }
}

async function syncSkillCache(target, skill, { dryRun = false } = {}) {
  const cacheRoot = path.join(target, ".repo-pattern", "cache", "skills");
  const cacheDir = path.join(cacheRoot, skill.value);
  const cloneArgs = ["clone", ...(skill.partialClone ? ["--filter=blob:none"] : []), skill.source, cacheDir];

  if (exists(path.join(cacheDir, ".git"))) {
    if (!dryRun) {
      runGit(["fetch", "--quiet", "origin", skill.revision], cacheDir);
      runGit(["checkout", "--quiet", skill.revision], cacheDir);
      verifyRevision(cacheDir, skill);
    }
    return cacheDir;
  }

  if (dryRun) {
    console.log(`[dry-run] git ${cloneArgs.join(" ")}`);
    console.log(`[dry-run] git -C ${cacheDir} checkout ${skill.revision}`);
    return cacheDir;
  }

  await ensureDir(cacheRoot);
  if (isInteractive()) {
    await withSpinner(`Syncing ${skill.value}`, async () => {
      await runGitAsync(["clone", "--quiet", ...cloneArgs.slice(1)], target);
      await runGitAsync(["checkout", "--quiet", skill.revision], cacheDir);
    });
  } else {
    console.log(`Syncing ${skill.value} from ${skill.source}`);
    runGit(cloneArgs, target);
    runGit(["checkout", "--quiet", skill.revision], cacheDir);
  }
  verifyRevision(cacheDir, skill);
  return cacheDir;
}

async function copySkill(skill, cacheDir, destRoot, { dryRun = false } = {}) {
  if (skill.includePaths) {
    const dest = path.join(destRoot, skill.destName);
    for (const relPath of skill.includePaths) {
      const sourcePath = path.join(cacheDir, relPath);
      if (!dryRun && !exists(sourcePath)) throw new Error(`${skill.value} source path not found: ${relPath}`);
      if (!dryRun) await rejectSymlinks(sourcePath);
      await copyRecursive(sourcePath, path.join(dest, relPath), { dryRun });
    }
    return [skill.destName];
  }

  if (skill.sourceSubdir) {
    const sourceDir = path.join(cacheDir, skill.sourceSubdir);
    if (!dryRun && !exists(sourceDir)) throw new Error(`${skill.value} source dir not found: ${skill.sourceSubdir}`);
    if (!dryRun) await rejectSymlinks(sourceDir);
    const dest = path.join(destRoot, skill.destName);
    await copyRecursive(sourceDir, dest, { dryRun });
    return [skill.destName];
  }

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

  if (!dryRun) await rejectSymlinks(cacheDir);
  const dest = path.join(destRoot, skill.destName);
  if (dryRun) {
    console.log(`[dry-run] copy ${cacheDir} -> ${dest}`);
    console.log(`[dry-run] rm -rf ${path.join(dest, ".git")}`);
    return [skill.destName];
  }
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
  const repoConfigPath = path.join(target, ".repo-pattern.json");
  const repoConfig = await readJson(repoConfigPath, {});
  const desired = [...new Set([...(repoConfig.optionalSkills || []), ...chosen].map((entry) => entry.name || entry.value))]
    .map(knownSkill)
    .filter(Boolean);
  const pluginSkills = desired.filter((skill) => skill.plugin);
  const localSkills = desired.filter((skill) => !skill.plugin);
  const shouldSyncLocalSkills = chosen.some((skill) => !skill.plugin);
  const destRoot = path.join(target, ".claude", "skills");
  await writePluginSkillSettings({ target, skills: pluginSkills, dryRun });

  const appliedSkills = shouldSyncLocalSkills
    ? []
    : (repoConfig.optionalSkills || []).filter((entry) => {
      const skill = knownSkill(entry.name);
      return skill && !skill.plugin;
    });
  if (shouldSyncLocalSkills) {
    await backupPaths(target, [".claude/skills"], { dryRun });
    await removePath(destRoot, { dryRun });
    await ensureDir(destRoot, { dryRun });
    await appendGitignoreLine(target, ".repo-pattern/", { dryRun });

    for (const skill of localSkills) {
      const cacheDir = await syncSkillCache(target, skill, { dryRun });
      const installedDirs = await copySkill(skill, cacheDir, destRoot, { dryRun });
      appliedSkills.push({ name: skill.value, source: skill.source, revision: skill.revision, license: skill.license, installedDirs });
    }

    const repoPatternDir = path.join(target, ".repo-pattern");
    if (dryRun) {
      console.log(`[dry-run] rm -rf ${path.join(repoPatternDir, "cache")}`);
      console.log(`[dry-run] rmdir ${repoPatternDir} if empty`);
    } else {
      await removePath(path.join(repoPatternDir, "cache"));
      try {
        await fs.rmdir(repoPatternDir);
      } catch (error) {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
      }
    }
  }

  appliedSkills.push(...pluginSkills.map((skill) => ({ name: skill.value, source: skill.source, revision: skill.revision, license: skill.license, installedDirs: [], plugin: skill.plugin })));

  repoConfig.runtime = { ...(repoConfig.runtime || {}), localSkills: localSkills.length > 0 };
  repoConfig.optionalSkills = appliedSkills.map(({ name, source, revision, license, installedDirs, plugin }) => ({ name, source, revision, license, installedDirs, ...(plugin ? { plugin } : {}) }));
  await writeJson(repoConfigPath, repoConfig, { dryRun });

  const lockPath = path.join(target, ".repo-pattern.lock.json");
  const lock = await readJson(lockPath, {});
  lock.optionalSkills = { appliedSkills, appliedAt: new Date().toISOString() };
  await writeJson(lockPath, lock, { dryRun });

  printSummary("Applied optional skills", [
    ["Plugin settings", pluginSkills.length ? ".claude/settings.local.json" : "none"],
    ["Local skill path", localSkills.length ? path.relative(target, destRoot) : "none"],
    ["Skills", selected.join(", ")]
  ]);

  return { selectedSkills: selected, appliedSkills };
}
