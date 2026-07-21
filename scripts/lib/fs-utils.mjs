import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
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

export async function readPrivateJson(file, fallback = null, { label = path.basename(file), parentLabel = null } = {}) {
  const parent = path.dirname(file);
  if (parentLabel) {
    try {
      if ((await fs.lstat(parent)).isSymbolicLink()) throw new Error(`${parentLabel} must not be a symlink.`);
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw error;
    }
  }
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    if (error.code === "ELOOP") throw new Error(`${label} must not be a symlink.`);
    throw error;
  }
  try {
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

export async function writeJson(file, data, { dryRun = false } = {}) {
  if (dryRun) {
    console.log(`[dry-run] write JSON ${file}`);
    return;
  }
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function writePrivateJson(file, data, { dryRun = false, label = path.basename(file), parentLabel = null } = {}) {
  if (dryRun) {
    console.log(`[dry-run] write JSON ${file}`);
    return;
  }
  const parent = path.dirname(file);
  if (parentLabel) {
    let parentStat = null;
    try {
      parentStat = await fs.lstat(parent);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (parentStat?.isSymbolicLink()) throw new Error(`${parentLabel} must not be a symlink.`);
  }
  await ensureDir(parent);
  let stat = null;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (stat?.isSymbolicLink()) throw new Error(`${label} must not be a symlink.`);
  const current = typeof data === "function"
    ? await readPrivateJson(file, {}, { label, parentLabel })
    : null;
  const content = `${JSON.stringify(typeof data === "function" ? data(current) : data, null, 2)}\n`;
  const tempDir = await fs.mkdtemp(path.join(parent, `.${path.basename(file)}-`));
  const tempFile = path.join(tempDir, path.basename(file));
  try {
    await fs.writeFile(tempFile, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.rename(tempFile, file);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
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
