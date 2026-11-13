import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { runRuntimeCommand, runtimeEnvironment, GSTACK_RUNTIME_TIMEOUTS } from "./gstack-runtime.mjs";

export const GSTACK_UPSTREAM_MANIFEST = "upstream-manifest.json";
export const GSTACK_UPSTREAM_OWNER = "upstream-local-v1";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function assertSafeTarget(root, file, target) {
  const resolvedTarget = await fs.realpath(target);
  if (!inside(await fs.realpath(root), resolvedTarget)) throw new Error(`gstack upstream symlink escapes target: ${file}`);
}

async function collect(root, current = root, safetyRoot = root, ancestors = []) {
  const resolvedCurrent = await fs.realpath(current);
  if (ancestors.includes(resolvedCurrent)) throw new Error(`cyclic gstack upstream symlink: ${current}`);
  const visited = [...ancestors, resolvedCurrent];
  const entries = [];
  const dirents = await fs.readdir(current, { withFileTypes: true });
  for (const entry of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(current, entry.name);
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (entry.isSymbolicLink()) {
      const target = await fs.readlink(file);
      await assertSafeTarget(safetyRoot, file, path.resolve(path.dirname(file), target));
      const resolved = await fs.realpath(file);
      const stat = await fs.stat(resolved);
      const sha256 = stat.isFile() ? hash(await fs.readFile(resolved)) : hash(JSON.stringify(await collect(resolved, resolved, safetyRoot, visited)));
      entries.push({ path: relative, type: "symlink", target, sha256, directory: stat.isDirectory() });
    } else if (entry.isDirectory()) {
      entries.push(...await collect(root, file, safetyRoot, visited));
    } else if (entry.isFile()) {
      entries.push({ path: relative, type: "file", sha256: hash(await fs.readFile(file)) });
    } else {
      throw new Error(`unsupported gstack upstream output: ${file}`);
    }
  }
  return entries;
}

export async function manifestForPaths(target, paths) {
  const entries = [];
  for (const relative of paths.sort()) {
    const root = path.join(target, ".claude", "skills", relative);
    const absolute = root;
    const stat = await fs.lstat(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`invalid gstack upstream publication root: ${relative}`);
    for (const entry of await collect(absolute, absolute, path.resolve(target))) entries.push({ root: path.join(".claude", "skills", relative).split(path.sep).join("/"), ...entry });
  }
  return { version: 1, owner: GSTACK_UPSTREAM_OWNER, entries };
}

export async function verifyUpstreamManifest(target, manifest) {
  const errors = [];
  if (manifest?.version !== 1 || manifest.owner !== GSTACK_UPSTREAM_OWNER || !Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    return ["upstream-manifest.json: invalid or missing upstream publication manifest; rerun repo-pattern setup"];
  }
  if (manifest.entries.some((entry) => !entry || typeof entry.root !== "string" || !/^\.claude\/skills\/[a-z0-9_-]+$/.test(entry.root) || entry.root === ".claude/skills/gstack" || typeof entry.path !== "string" || !entry.path || entry.path.split("/").some((part) => !part || part === "." || part === "..") || path.isAbsolute(entry.path) || !["file", "symlink"].includes(entry.type))) {
    return ["upstream-manifest.json: invalid upstream publication entry; preserve user changes before setup"];
  }
  const expected = new Set(manifest.entries.map((entry) => `${entry.root}/${entry.path}`));
  for (const root of new Set(manifest.entries.map((entry) => entry.root))) {
    try {
      if (typeof root !== "string" || !/^\.claude\/skills\/[a-z0-9_-]+$/.test(root) || root === ".claude/skills/gstack") throw new Error("invalid publication root");
      const stat = await fs.lstat(path.join(target, root));
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("publication root changed");
      for (const entry of await collect(path.join(target, root), path.join(target, root), path.resolve(target))) {
        if (!expected.has(`${root}/${entry.path}`)) errors.push(`${root}/${entry.path}: unmanaged publication file; preserve user changes before setup`);
      }
    } catch (error) { errors.push(`${root}: ${error.message}`); }
  }
  for (const entry of manifest.entries) {
    try {
      if (!entry || !entry.root || !entry.path || !["file", "symlink"].includes(entry.type)) throw new Error("invalid manifest entry");
      const relative = path.join(entry.root, entry.path);
      if (path.isAbsolute(relative) || !inside(path.resolve(target), path.resolve(target, relative))) throw new Error("path escapes target");
      const file = path.join(target, relative);
      const stat = await fs.lstat(file);
      if (entry.type === "file") {
        if (!stat.isFile() || stat.isSymbolicLink() || hash(await fs.readFile(file)) !== entry.sha256) throw new Error("published bytes changed");
      } else {
        if (!stat.isSymbolicLink() || await fs.readlink(file) !== entry.target) throw new Error("published symlink changed");
        await assertSafeTarget(path.resolve(target), file, path.resolve(path.dirname(file), entry.target));
        const resolved = await fs.realpath(file);
        const digest = entry.directory ? hash(JSON.stringify(await collect(resolved, resolved, path.resolve(target)))) : hash(await fs.readFile(file));
        if (digest !== entry.sha256) throw new Error("linked publication bytes changed");
      }
    } catch (error) {
      errors.push(`${entry?.root || "upstream"}/${entry?.path || "unknown"}: upstream publication integrity failure: ${error.message}; preserve user changes and rerun repo-pattern setup`);
    }
  }
  return errors;
}

async function assertNoSymlinkPath(target, file) {
  const root = path.resolve(target);
  const destination = path.resolve(file);
  if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) throw new Error(`gstack path escapes the target: ${file}`);
  for (let current = destination; current !== path.dirname(root); current = path.dirname(current)) {
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`gstack target path contains a symlink: ${current}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current === root) break;
  }
}

async function snapshotPath(file, root) {
  const snapshot = path.join(root, String((await fs.readdir(root)).length));
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error(`gstack snapshot source must not be a symlink: ${file}`);
    await fs.cp(file, snapshot, { recursive: true, force: true });
    const copied = await fs.lstat(file);
    if (copied.isSymbolicLink()) throw new Error(`gstack snapshot source changed to a symlink: ${file}`);
    return { file, snapshot, exists: true };
  } catch (error) {
    if (error.code === "ENOENT") return { file, exists: false };
    throw error;
  }
}

export async function runUpstreamLocalSetup({ target, checkout, statePath, publicationRoots, runCommand = runRuntimeCommand, browserSkipped = process.env.GSTACK_SKIP_PLAYWRIGHT === "1" }) {
  const runtime = path.join(target, ".repo-pattern-runtime");
  const env = runtimeEnvironment(checkout, {
    ...process.env,
    HOME: path.join(runtime, "home"),
    CLAUDE_CONFIG_DIR: path.join(runtime, "claude-config"),
    GSTACK_STATE_ROOT: path.join(runtime, "state-root"),
    GSTACK_USER_RENDER_DIR: path.join(runtime, "renders"),
    CODEX_HOME: path.join(runtime, "codex"),
    GSTACK_HOME: path.join(runtime, "state"),
    PLAYWRIGHT_BROWSERS_PATH: path.join(runtime, "chromium"),
    GSTACK_SKIP_FONTS: "1",
    GSTACK_HARNESS_AUTO: "0",
    GSTACK_SETUP_RUNNING: "1"
  });
  for (const key of ["GSTACK_STATE_ROOT", "GSTACK_USER_RENDER_DIR", "CLAUDE_PLUGIN_ROOT", "CLAUDE_PLUGIN_DIR"]) delete env[key];
  Object.assign(env, {
    HOME: path.join(runtime, "home"),
    CLAUDE_CONFIG_DIR: path.join(runtime, "claude-config"),
    GSTACK_STATE_ROOT: path.join(runtime, "state-root"),
    GSTACK_USER_RENDER_DIR: path.join(runtime, "renders"),
    CLAUDE_PLUGIN_ROOT: "",
    CLAUDE_PLUGIN_DIR: "",
    GSTACK_HOME: path.join(runtime, "state"),
    GSTACK_ROOT: checkout
  });
  await fs.mkdir(statePath, { recursive: true });
  for (const directory of [env.HOME, env.CLAUDE_CONFIG_DIR, env.GSTACK_STATE_ROOT, env.GSTACK_USER_RENDER_DIR, env.CODEX_HOME, env.TMPDIR, env.PLAYWRIGHT_BROWSERS_PATH]) await fs.mkdir(directory, { recursive: true });
  const output = await runCommand(path.join(checkout, "setup"), ["--local", "--host", "claude", "--no-prefix", "--no-harness-auto", "--no-team"], {
    cwd: target,
    env,
    timeout: GSTACK_RUNTIME_TIMEOUTS.install,
    stage: "upstream local setup"
  });
  if (/could not render (?:claude|codex) skills for the install|the previous render stays in use/.test(output)) {
    throw new Error("gstack upstream render failed; previous render cannot validate a new installation");
  }
  const manifest = await manifestForPaths(target, publicationRoots);
  return { manifest, output, env };
}

export async function snapshotUpstreamTransaction({ target, checkout, statePath, publicationRoots }) {
  const root = await fs.mkdtemp(path.join(target, ".gstack-upstream-transaction-"));
  const files = [checkout, statePath, path.join(target, ".repo-pattern-runtime"), path.join(target, ".claude", "settings.json"), ...publicationRoots.map((relative) => path.join(target, ".claude", "skills", relative))];
  const entries = [];
  try {
    for (const file of files) entries.push(await snapshotPath(file, root));
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
  return {
    root,
    async rollback() {
      const errors = [];
      for (const entry of [...entries].reverse()) {
        try {
          await assertNoSymlinkPath(target, entry.file);
          await fs.rm(entry.file, { recursive: true, force: true });
          if (entry.exists) {
            await assertNoSymlinkPath(target, entry.file);
            await fs.cp(entry.snapshot, entry.file, { recursive: true, force: true });
          }
        } catch (error) {
          errors.push(`${entry.file}: ${error.message}`);
        }
      }
      if (errors.length) throw new Error(errors.join("; "));
    },
    async remove() { await fs.rm(root, { recursive: true, force: true }); }
  };
}
