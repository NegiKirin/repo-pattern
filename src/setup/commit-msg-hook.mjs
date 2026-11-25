import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export const COMMIT_MSG_MARKER = "// # repo-pattern: managed commit-msg v1";
export const ORIGINAL_HOOK_MARKER = "# repo-pattern: original commit-msg v1";

function git(target, args) {
  try {
    return execFileSync("git", args, { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function within(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function realOrParent(file) {
  try {
    return await fs.realpath(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(await realOrParent(parent), path.basename(file));
  }
}

async function rejectSymlink(file, label, { missingOk = true } = {}) {
  try {
    const details = await fs.lstat(file);
    if (details.isSymbolicLink()) throw new Error(`${label} must not be a symlink.`);
    return details;
  } catch (error) {
    if (error.code === "ENOENT" && missingOk) return null;
    throw error;
  }
}

function fingerprint(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function managedBackup(bytes) {
  const suffix = Buffer.from(`\n${ORIGINAL_HOOK_MARKER}\n`);
  if (!bytes.subarray(bytes.length - suffix.length).equals(suffix)) return null;
  return bytes.subarray(0, bytes.length - suffix.length);
}

const ORIGINAL_HASH_PLACEHOLDER = "__REPO_PATTERN_ORIGINAL_SHA256__";

function expectedWrapperBytes(template, original) {
  const source = template.toString();
  if (!source.includes(ORIGINAL_HASH_PLACEHOLDER)) throw new Error("Managed commit-msg wrapper template has no original-hook fingerprint placeholder.");
  return Buffer.from(source.replaceAll(ORIGINAL_HASH_PLACEHOLDER, fingerprint(original)));
}

async function writeExclusive(file, bytes, mode) {
  const handle = await fs.open(file, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(mode);
  } finally {
    await handle.close();
  }
}

async function stage(file, bytes, mode) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.repo-pattern-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await writeExclusive(temporary, bytes, mode);
  return temporary;
}

function administrativeRoots(topLevel, commonDir) {
  return [topLevel, commonDir].map((root) => path.resolve(root));
}

export async function resolveEffectiveHooks({ target, gitRunner = git, realpath = realOrParent } = {}) {
  const topLevel = gitRunner(target, ["rev-parse", "--show-toplevel"]);
  const hooksPath = gitRunner(target, ["rev-parse", "--git-path", "hooks"]);
  const commonDir = gitRunner(target, ["rev-parse", "--git-common-dir"]);
  if (!topLevel || !hooksPath || !commonDir) return { status: "skipped", reason: "target is not a Git worktree" };

  const root = path.resolve(topLevel);
  const common = path.resolve(target, commonDir);
  const hooks = path.resolve(target, hooksPath);
  const resolvedHooks = await realpath(hooks);
  const resolvedRoot = await fs.realpath(root);
  const resolvedCommon = await fs.realpath(common);
  if (!administrativeRoots(resolvedRoot, resolvedCommon).some((allowed) => within(resolvedHooks, allowed))) {
    return { status: "conflict", reason: "effective hooks path is outside the target repository's administrative boundary" };
  }
  return { status: "ready", target: root, commonDir: resolvedCommon, hooksDir: hooks, resolvedHooksDir: resolvedHooks };
}

export async function installCommitMsgHook({ target, sourceRoot, dryRun = false, resolveHooks = resolveEffectiveHooks, fsOps = fs } = {}) {
  const resolved = await resolveHooks({ target });
  if (resolved.status !== "ready") return resolved;
  const hooksDir = resolved.hooksDir;
  await rejectSymlink(hooksDir, "effective hooks directory");
  const wrapper = path.join(hooksDir, "commit-msg");
  const backup = path.join(hooksDir, "commit-msg.repo-pattern-original");
  const existing = await rejectSymlink(wrapper, "commit-msg hook");
  const existingBackup = await rejectSymlink(backup, "managed commit-msg backup");
  const wrapperTemplate = await fsOps.readFile(path.join(sourceRoot, ".claude.example", "hooks", "clean-commit-attribution.cjs"));

  if (existing && !existing.isFile()) return { status: "conflict", reason: "commit-msg hook is not a regular file" };
  if (existingBackup && !existingBackup.isFile()) return { status: "conflict", reason: "managed commit-msg backup is not a regular file" };
  const currentWrapper = existing ? await fs.readFile(wrapper) : null;
  const currentBackup = existingBackup ? await fs.readFile(backup) : null;
  const original = currentBackup && managedBackup(currentBackup);
  const expectedBackup = original && Buffer.concat([original, Buffer.from(`\n${ORIGINAL_HOOK_MARKER}\n`) ]);
  const expectedWrapper = original && expectedWrapperBytes(wrapperTemplate, original);

  if (existingBackup && currentWrapper?.includes(Buffer.from(COMMIT_MSG_MARKER)) && original) {
    if (!currentBackup.equals(expectedBackup) || !currentWrapper.equals(expectedWrapper)) {
      return { status: "conflict", reason: "managed commit-msg wrapper or backup was modified after installation" };
    }
    return { status: "managed", hooksDir, wrapper, backup };
  }
  if (existing && !currentWrapper.includes(Buffer.from(COMMIT_MSG_MARKER))) {
    if (!existing.isFile()) return { status: "conflict", reason: "commit-msg hook is not a regular file" };
    if ((existing.mode & 0o111) === 0) return { status: "conflict", reason: "existing commit-msg hook is not executable" };
    if (existingBackup) return { status: "conflict", reason: "unknown commit-msg backup exists" };
  }
  if (existing && currentWrapper.includes(Buffer.from(COMMIT_MSG_MARKER)) && !existingBackup) {
    return { status: "conflict", reason: "managed commit-msg wrapper is missing its backup" };
  }
  if (existingBackup && !original) return { status: "conflict", reason: "unknown or malformed managed commit-msg backup exists" };
  if (dryRun) return { status: "dry-run", hooksDir, wouldInstall: true };

  const originalForInstall = existing ? currentWrapper : Buffer.alloc(0);
  const wrapperBytes = expectedWrapperBytes(wrapperTemplate, originalForInstall);
  await fs.mkdir(hooksDir, { recursive: true });
  if (!existing) {
    const wrapperTemp = await stage(wrapper, wrapperBytes, 0o755);
    const backupTemp = await stage(backup, Buffer.from(`\n${ORIGINAL_HOOK_MARKER}\n`), 0o755);
    try {
      await fsOps.rename(backupTemp, backup);
      await fsOps.rename(wrapperTemp, wrapper);
    } catch (error) {
      await fsOps.rm(backupTemp, { force: true });
      await fsOps.rm(wrapperTemp, { force: true });
      throw new Error(`Cannot install commit-msg hook without risking existing files: ${error.message}`);
    }
    return { status: "installed", hooksDir, wrapper, backup };
  }
  if (currentWrapper.includes(Buffer.from(COMMIT_MSG_MARKER))) return { status: "managed", hooksDir, wrapper, backup };

  const backupBytes = Buffer.concat([currentWrapper.length ? currentWrapper : Buffer.alloc(0), Buffer.from(`\n${ORIGINAL_HOOK_MARKER}\n`) ]);
  const backupTemp = await stage(backup, backupBytes, existing.mode & 0o7777);
  const wrapperTemp = await stage(wrapper, wrapperBytes, 0o755);
  try {
    await fsOps.rename(backupTemp, backup);
    await fsOps.rename(wrapperTemp, wrapper);
  } catch (error) {
    await fsOps.rm(backupTemp, { force: true });
    await fsOps.rm(wrapperTemp, { force: true });
    throw new Error(`Cannot install commit-msg hook without risking existing files: ${error.message}`);
  }
  return { status: "installed", hooksDir, wrapper, backup, originalMode: existing.mode & 0o7777 };
}
