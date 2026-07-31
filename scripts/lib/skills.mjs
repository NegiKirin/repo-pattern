import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { appendGitignoreLine, backupPaths, copyRecursiveWithProgress, ensureDir, ensureRepoPatternGitignore, exists, isTracked, readRepoConfig, readRepoLock, removePath, repoConfigPath, repoLockPath, scanCopyTree, writeJson, writePrivateJson } from "./fs-utils.mjs";
import { runGitWithProgress } from "./git-progress.mjs";
import { printSummary } from "./prompt.mjs";


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
  },
  {
    value: "herdr",
    label: "herdr",
    description: "Herdr terminal multiplexer control skill (AGPL-3.0-or-later; user opt-in only)",
    source: "https://github.com/ogulcancelik/herdr.git",
    revision: "9450b168c727e9e4cbee95e6edf4f11cfe6f2154",
    license: "AGPL-3.0-or-later",
    installedDirs: ["herdr"],
    includePaths: ["SKILL.md"],
    destName: "herdr",
    partialClone: true
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

export function selectedPluginSkills(skills = []) {
  return normalizeOptionalSkills(skills).map(knownSkill).filter((skill) => skill?.plugin);
}

export function reconcilePluginSkillSettings(settings = {}, skills = []) {
  const enabledPlugins = { ...(settings.enabledPlugins || {}) };
  const extraKnownMarketplaces = { ...(settings.extraKnownMarketplaces || {}) };
  for (const skill of OPTIONAL_SKILLS.filter((entry) => entry.plugin)) {
    delete enabledPlugins[pluginId(skill)];
    delete extraKnownMarketplaces[skill.plugin.marketplace];
  }
  return applyPluginSkillSettings({ ...settings, enabledPlugins, extraKnownMarketplaces }, selectedPluginSkills(skills));
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
  await writePrivateJson(file, (settings) => applyPluginSkillSettings(settings, skills), {
    dryRun,
    label: ".claude/settings.local.json",
    parentLabel: ".claude"
  });
  await appendGitignoreLine(target, ".claude/", { dryRun });
}

function gitOutput(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
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

async function syncSkillCache(target, skill, { dryRun = false, progress = null } = {}) {
  const cacheRoot = path.join(target, ".repo-pattern", "cache", "skills");
  const cacheDir = path.join(cacheRoot, skill.value);
  const cloneArgs = ["clone", "--progress", ...(skill.partialClone ? ["--filter=blob:none"] : []), skill.source, cacheDir];
  const operation = progress?.beginOperation?.({ id: `skill-git-${skill.value}`, label: `Syncing ${skill.value}`, totalUnits: 100, weight: 2 });

  if (exists(path.join(cacheDir, ".git"))) {
    if (!dryRun) {
      try {
        await runGitWithProgress(["fetch", "--progress", "origin", skill.revision], {
          cwd: cacheDir,
          onProgress: ({ percent, detail }) => operation?.update({ completedUnits: percent, totalUnits: 100, detail })
        });
        await runGitWithProgress(["checkout", "--quiet", skill.revision], { cwd: cacheDir });
        verifyRevision(cacheDir, skill);
        operation?.complete({ detail: "completed" });
      } catch (error) {
        operation?.fail({ detail: "failed" });
        throw error;
      }
    }
    return cacheDir;
  }

  if (dryRun) {
    console.log(`[dry-run] git ${cloneArgs.join(" ")}`);
    console.log(`[dry-run] git -C ${cacheDir} checkout ${skill.revision}`);
    return cacheDir;
  }

  await ensureDir(cacheRoot);
  try {
    await runGitWithProgress(cloneArgs, {
      cwd: target,
      onProgress: ({ percent, detail }) => operation?.update({ completedUnits: percent, totalUnits: 100, detail })
    });
    await runGitWithProgress(["checkout", "--quiet", skill.revision], { cwd: cacheDir });
    verifyRevision(cacheDir, skill);
    operation?.complete({ detail: "completed" });
  } catch (error) {
    operation?.fail({ detail: "failed" });
    throw error;
  }
  return cacheDir;
}

async function copySkill(skill, cacheDir, destRoot, { dryRun = false, progress = null } = {}) {
  const resources = [];
  let installedDirs = [];

  if (skill.includePaths) {
    const destination = path.join(destRoot, skill.destName);
    for (const relPath of skill.includePaths) {
      const source = path.join(cacheDir, relPath);
      if (!dryRun && !exists(source)) throw new Error(`${skill.value} source path not found: ${relPath}`);
      if (!dryRun) await rejectSymlinks(source);
      resources.push({ source, destination: path.join(destination, relPath) });
    }
    installedDirs = [skill.destName];
  } else if (skill.sourceSubdir) {
    const source = path.join(cacheDir, skill.sourceSubdir);
    if (!dryRun && !exists(source)) throw new Error(`${skill.value} source dir not found: ${skill.sourceSubdir}`);
    if (!dryRun) await rejectSymlinks(source);
    resources.push({ source, destination: path.join(destRoot, skill.destName) });
    installedDirs = [skill.destName];
  } else if (skill.sourceDir) {
    const sourceDir = path.join(cacheDir, skill.sourceDir);
    if (!dryRun && !exists(sourceDir)) throw new Error(`${skill.value} source dir not found: ${skill.sourceDir}`);
    if (dryRun) {
      console.log(`[dry-run] copy ${sourceDir} -> ${destRoot}`);
      return [skill.sourceDir];
    }
    await rejectSymlinks(sourceDir);
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isDirectory())) {
      resources.push({ source: path.join(sourceDir, entry.name), destination: path.join(destRoot, entry.name) });
      installedDirs.push(entry.name);
    }
  } else {
    if (!dryRun) await rejectSymlinks(cacheDir);
    const destination = path.join(destRoot, skill.destName);
    if (dryRun) {
      console.log(`[dry-run] copy ${cacheDir} -> ${destination}`);
      console.log(`[dry-run] rm -rf ${path.join(destination, ".git")}`);
      return [skill.destName];
    }
    resources.push({ source: cacheDir, destination });
    installedDirs = [skill.destName];
  }

  const trees = dryRun ? [] : await Promise.all(resources.map(async (resource) => ({ ...resource, tree: await scanCopyTree(resource.source) })));
  const totalFiles = trees.reduce((total, resource) => total + resource.tree.files, 0);
  const totalBytes = trees.reduce((total, resource) => total + resource.tree.bytes, 0);
  const operation = progress?.beginOperation?.({ id: `skill-copy-${skill.value}`, label: `Copying ${skill.value}`, totalUnits: totalFiles || resources.length, unitLabel: "files", weight: 2 });
  let completedFiles = 0;
  let completedBytes = 0;

  try {
    for (const resource of trees) {
      await copyRecursiveWithProgress(resource.source, resource.destination, {
        onProgress: ({ completedFiles: files, completedBytes: bytes }) => {
          const nextFiles = completedFiles + files;
          const nextBytes = completedBytes + bytes;
          const detail = totalBytes > 0
            ? `${nextFiles}/${totalFiles} files · ${nextBytes}/${totalBytes} bytes`
            : `${nextFiles}/${totalFiles} files`;
          operation?.update({ completedUnits: nextFiles, totalUnits: totalFiles || resources.length, detail });
        }
      });
      completedFiles += resource.tree.files;
      completedBytes += resource.tree.bytes;
    }
    if (!skill.sourceDir) await removePath(path.join(destRoot, skill.destName, ".git"), { dryRun });
    operation?.complete({ detail: "completed" });
  } catch (error) {
    operation?.fail({ detail: "failed" });
    throw error;
  }
  return installedDirs;
}

export async function applyOptionalSkills({
  target,
  skills = [],
  dryRun = false,
  reconcile = false,
  previousOptionalSkills = null,
  progress = null
}) {
  const selected = normalizeOptionalSkills(skills);
  const invalid = invalidOptionalSkills(selected);
  if (invalid.length > 0) throw new Error(`Unknown optional skill(s): ${invalid.join(", ")}`);

  const chosen = selected.map(knownSkill);
  const repoConfig = await readRepoConfig(target, {});
  const previousSkills = previousOptionalSkills || repoConfig.optionalSkills || [];
  const desired = reconcile
    ? chosen
    : [...new Set([...previousSkills, ...chosen].map((entry) => entry.name || entry.value))]
      .map(knownSkill)
      .filter(Boolean);
  const pluginSkills = desired.filter((skill) => skill.plugin);
  const localSkills = desired.filter((skill) => !skill.plugin);
  const shouldSyncLocalSkills = reconcile || chosen.some((skill) => !skill.plugin);
  const destRoot = path.join(target, ".claude", "skills");
  if (!reconcile) await writePluginSkillSettings({ target, skills: pluginSkills, dryRun });

  const appliedSkills = [];
  if (shouldSyncLocalSkills) {
    await backupPaths(target, [".claude/skills"], {
      dryRun,
      progress,
      progressId: "skills-backup",
      progressLabel: "Backing up local skills",
      progressWeight: 1
    });
    const previousLocalSkills = previousSkills.filter((entry) => {
      const skill = knownSkill(entry.name);
      return skill && !skill.plugin;
    });
    for (const skill of previousLocalSkills) {
      for (const dir of skill.installedDirs || []) await removePath(path.join(destRoot, dir), { dryRun });
    }
    if (localSkills.length > 0) {
      await ensureDir(destRoot, { dryRun });
      await ensureRepoPatternGitignore(target, { dryRun });
      for (const skill of localSkills) {
        const cacheDir = await syncSkillCache(target, skill, { dryRun, progress });
        const installedDirs = await copySkill(skill, cacheDir, destRoot, { dryRun, progress });
        appliedSkills.push({ name: skill.value, source: skill.source, revision: skill.revision, license: skill.license, installedDirs });
      }
    } else if (!dryRun) {
      try {
        await fs.rmdir(destRoot);
      } catch (error) {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
      }
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
  } else {
    appliedSkills.push(...(repoConfig.optionalSkills || []).filter((entry) => !knownSkill(entry.name)?.plugin));
  }

  appliedSkills.push(...pluginSkills.map((skill) => ({ name: skill.value, source: skill.source, revision: skill.revision, license: skill.license, installedDirs: [], plugin: skill.plugin })));

  repoConfig.runtime = { ...(repoConfig.runtime || {}), localSkills: localSkills.length > 0 };
  repoConfig.optionalSkills = appliedSkills.map(({ name, source, revision, license, installedDirs, plugin }) => ({ name, source, revision, license, installedDirs, ...(plugin ? { plugin } : {}) }));
  await writeJson(repoConfigPath(target), repoConfig, { dryRun });

  await ensureRepoPatternGitignore(target, { dryRun });
  const lockPath = repoLockPath(target);
  const lock = await readRepoLock(target, {});
  lock.optionalSkills = { appliedSkills, appliedAt: new Date().toISOString() };
  await writeJson(lockPath, lock, { dryRun });

  printSummary("Applied optional skills", [
    ["Plugin settings", pluginSkills.length ? ".claude/settings.local.json" : "none"],
    ["Local skill path", localSkills.length ? path.relative(target, destRoot) : "none"],
    ["Skills", selected.join(", ") || "none"]
  ], { progress });

  return { selectedSkills: selected, appliedSkills };
}
