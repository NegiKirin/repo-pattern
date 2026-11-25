#!/usr/bin/env node
// # repo-pattern: managed commit-msg v1
// # repo-pattern: original commit-msg sha256: __REPO_PATTERN_ORIGINAL_SHA256__

const fs = require("node:fs/promises");
const path = require("node:path");
const process = require("node:process");
const { execFileSync, spawnSync } = require("node:child_process");
const SOURCE = "generated-attribution-removal";
const MODES = new Set(["off", "on", "custom"]);
const MATCHING_LINE = /^[ \t]*co-authored-by[ \t]*:[ \t]*claude(?:[ \t]+(?:[^<\r\n]*?[^<\r\n \t])[ \t]*)?[ \t]*<noreply@anthropic\.com>[ \t]*$/i;

function splitLines(bytes) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a && bytes[index] !== 0x0d) continue;
    const separatorLength = bytes[index] === 0x0d && bytes[index + 1] === 0x0a ? 2 : 1;
    lines.push([start, index, index + separatorLength]);
    start = index + separatorLength;
    index += separatorLength - 1;
  }
  if (start < bytes.length) lines.push([start, bytes.length, bytes.length]);
  return lines;
}

function removeClaudeCoAuthorLines(bytes) {
  const output = [];
  let changed = false;
  let previousEnd = 0;
  for (const [start, contentEnd, end] of splitLines(bytes)) {
    const line = bytes.subarray(start, contentEnd).toString("latin1");
    if (MATCHING_LINE.test(line)) {
      changed = true;
      output.push(bytes.subarray(previousEnd, start));
      previousEnd = end;
    }
  }
  if (!changed) return bytes;
  output.push(bytes.subarray(previousEnd));
  return Buffer.concat(output);
}

async function readManagedMode(projectRoot) {
  let settings;
  try {
    settings = JSON.parse(await fs.readFile(path.join(projectRoot, ".claude", "settings.json"), "utf8"));
  } catch (error) {
    throw new Error(`Cannot read managed attribution mode from .claude/settings.json: ${error.message}`);
  }
  const entries = settings && typeof settings === "object" && settings.hooks?.PreToolUse;
  const entry = Array.isArray(entries) ? entries.find((item) => item?._repo_pattern_source === SOURCE) : undefined;
  const mode = entry?._repo_pattern_attribution_mode;
  if (!MODES.has(mode)) throw new Error(".claude/settings.json has no valid managed attribution mode (expected off, on, or custom).");
  return mode;
}

function projectRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", cwd: process.cwd() }).trim();
  } catch {
    throw new Error("Cannot locate the Git worktree for the commit message hook.");
  }
}

function originalHookPath() {
  try {
    const hooks = execFileSync("git", ["rev-parse", "--git-path", "hooks"], { encoding: "utf8", cwd: process.cwd() }).trim();
    return path.resolve(process.cwd(), hooks, "commit-msg.repo-pattern-original");
  } catch {
    throw new Error("Cannot locate the Git hooks directory for the commit message hook.");
  }
}

async function runOriginalHookIfManaged(argv) {
  const file = originalHookPath();
  let bytes;
  try {
    bytes = await fs.readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw new Error(`Cannot read preserved commit-msg hook: ${error.message}`);
  }
  const marker = Buffer.from(`\n# repo-pattern: original commit-msg v1\n`);
  if (!bytes.subarray(bytes.length - marker.length).equals(marker)) throw new Error("Preserved commit-msg hook has an invalid ownership marker.");
  const original = bytes.subarray(0, bytes.length - marker.length);
  if (original.length === 0) return true;
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.repo-pattern-run-${process.pid}`);
  await fs.writeFile(temporary, original, { mode: 0o700, flag: "wx" });
  try {
    const result = spawnSync(temporary, argv.slice(2), { argv0: path.join(path.dirname(file), "commit-msg"), cwd: process.cwd(), env: process.env, stdio: "inherit" });
    if (result.error) throw new Error(`Cannot run existing commit-msg hook: ${result.error.message}`);
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return false;
    }
    return true;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function atomicReplace(file, bytes, originalMode) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.repo-pattern-${process.pid}-${Date.now()}`);
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.chmod(originalMode);
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw new Error(`Cannot atomically update commit message: ${error.message}`);
  }
}

async function cleanMessageFile(file, mode) {
  const details = await fs.lstat(file);
  if (details.isSymbolicLink() || !details.isFile()) throw new Error("Commit message path must be a regular, non-symlink file.");
  const original = await fs.readFile(file);
  if (mode !== "off") return;
  const cleaned = removeClaudeCoAuthorLines(original);
  if (cleaned.equals(original)) return;
  await atomicReplace(file, cleaned, details.mode);
}

async function run(argv = process.argv, cwd = process.cwd()) {
  const file = argv[2];
  if (!file) throw new Error("Git did not provide a commit message file path.");
  const absoluteFile = path.resolve(cwd, file);
  const root = projectRoot();
  const mode = await readManagedMode(root);
  await cleanMessageFile(absoluteFile, mode);
}

module.exports = { removeClaudeCoAuthorLines, readManagedMode, cleanMessageFile, run };

if (require.main === module) {
  runOriginalHookIfManaged(process.argv).then((succeeded) => succeeded && run()).catch((error) => {
    console.error(`repo-pattern commit-msg hook: ${error.message}`);
    process.exitCode = 1;
  });
}
