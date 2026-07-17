import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

export function exists(p) {
  return fsSync.existsSync(p);
}

export function isTracked(root, relPath) {
  try {
    const output = execFileSync("git", ["ls-files", relPath], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export function repoConfigPath(target) {
  return path.join(target, ".repo-pattern", ".repo-pattern.json");
}

export function repoLockPath(target) {
  return path.join(target, ".repo-pattern", ".repo-pattern.lock.json");
}

export function legacyRepoConfigPath(target) {
  return path.join(target, ".repo-pattern.json");
}

export function legacyRepoLockPath(target) {
  return path.join(target, ".repo-pattern.lock.json");
}

export async function readRepoConfig(target, fallback = null) {
  return await readJson(repoConfigPath(target), null) ?? await readJson(legacyRepoConfigPath(target), fallback);
}

export async function readRepoLock(target, fallback = null) {
  return await readJson(repoLockPath(target), null) ?? await readJson(legacyRepoLockPath(target), fallback);
}

export async function ensureRepoPatternGitignore(target, { dryRun = false } = {}) {
  await writeIfMissing(path.join(target, ".repo-pattern", ".gitignore"), "*\n", { dryRun });
}

export async function ensureDir(dir, { dryRun = false } = {}) {
  if (dryRun) {
    console.log(`[dry-run] mkdir -p ${dir}`);
    return;
  }
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson(file, fallback = null) {
  if (!exists(file)) return fallback;
  const text = await fs.readFile(file, "utf8");
  return JSON.parse(text);
}

export async function writeJson(file, data, { dryRun = false } = {}) {
  if (dryRun) {
    console.log(`[dry-run] write JSON ${file}`);
    return;
  }
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function copyRecursive(src, dest, { dryRun = false } = {}) {
  if (!exists(src)) return;
  if (dryRun) {
    console.log(`[dry-run] copy ${src} -> ${dest}`);
    return;
  }
  await ensureDir(path.dirname(dest));
  await fs.cp(src, dest, { recursive: true, force: true });
}

export async function removePath(p, { dryRun = false } = {}) {
  if (!exists(p)) return;
  if (dryRun) {
    console.log(`[dry-run] rm -rf ${p}`);
    return;
  }
  await fs.rm(p, { recursive: true, force: true });
}

export async function writeIfMissing(file, content, { dryRun = false } = {}) {
  if (exists(file)) return false;
  if (dryRun) {
    console.log(`[dry-run] write if missing ${file}`);
    return true;
  }
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, content, "utf8");
  return true;
}

export async function replaceFile(file, content, { dryRun = false } = {}) {
  if (dryRun) {
    console.log(`[dry-run] replace ${file}`);
    return;
  }
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, content, "utf8");
}

export async function appendGitignoreLine(target, line, { dryRun = false } = {}) {
  const file = path.join(target, ".gitignore");
  let content = "";
  try {
    content = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (content.split(/\r?\n/).includes(line)) return;
  const next = `${content}${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
  if (dryRun) {
    console.log(`[dry-run] append ${line} to ${file}`);
    return;
  }
  await fs.writeFile(file, next, "utf8");
}

export function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

export async function backupPaths(targetRoot, relativePaths, { dryRun = false } = {}) {
  const backupRoot = path.join(targetRoot, ".repo-pattern", "backups", timestamp());
  let copied = 0;

  for (const rel of relativePaths) {
    const src = path.join(targetRoot, rel);
    if (!exists(src)) continue;
    const dest = path.join(backupRoot, rel);

    if (dryRun) {
      console.log(`[dry-run] backup ${src} -> ${dest}`);
      copied++;
      continue;
    }

    await ensureDir(path.dirname(dest));
    const stat = await fs.stat(src);
    if (stat.isDirectory()) {
      await fs.cp(src, dest, { recursive: true, force: true });
    } else {
      await fs.copyFile(src, dest);
    }
    copied++;
  }

  if (copied > 0) console.log(`Backup created: ${backupRoot}`);
  return copied > 0 ? backupRoot : null;
}
