import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendGitignoreLine, ensureDir, exists, isTracked, readJson, removePath, writeJson, writePrivateJson } from "./fs-utils.mjs";
import { printSummary, withSpinner } from "./prompt.mjs";

const GSTACK_REPOSITORY = "https://github.com/garrytan/gstack.git";
const GSTACK_DIAGNOSTIC_MAX_CHARS = 4000;
const GSTACK_HOOK_SOURCE = "repo-pattern-plan-tune";
const UNSUPPORTED_SKILL_ROOTS = new Set(["codex", "node_modules", "openclaw"]);
export const GSTACK_REVIEW_SIDECARS = [
  "review/checklist.md",
  "review/design-checklist.md",
  "review/greptile-triage.md",
  "review/TODOS-format.md",
  "review/specialists/api-contract.md",
  "review/specialists/data-migration.md",
  "review/specialists/maintainability.md",
  "review/specialists/performance.md",
  "review/specialists/red-team.md",
  "review/specialists/security.md",
  "review/specialists/testing.md"
];
const FORBIDDEN_HOME_PATH = /(?:~|\$(?:\{HOME\}|HOME)|\/(?:home|Users)\/[^/\s]+|\/root|[A-Za-z]:[\\/]Users[\\/][^\\/\s]+)[\\/](?:\.claude|\.gstack|\.bun|\.codex|\.kiro|\.factory|\.config[\\/]opencode)(?:[\\/]|\b)/;

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options });
}

function parseBunVersion(output) {
  const match = String(output).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match || Number(match[1]) < 1) {
    throw new Error(`Bun v1.0+ is required; found ${String(output).trim() || "an invalid version"}. Install Bun manually and rerun setup.`);
  }
}

export function ensureBun({ run: runCommand = run } = {}) {
  try {
    const version = runCommand("bun", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    parseBunVersion(version);
    return "bun";
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Bun v1.0+ is required. Install Bun manually from https://bun.sh/docs/installation and rerun setup.");
    }
    throw new Error(`Bun validation failed: ${error.message}`);
  }
}

export function gstackCheckoutPath(target) {
  return path.join(target, ".claude", "skills", "gstack");
}

export function gstackStatePath(target) {
  return path.join(target, ".repo-pattern", "gstack");
}

function globalGstackCheckoutPath(homedir = os.homedir()) {
  return path.join(homedir, ".claude", "skills", "gstack");
}

async function removeLocalPath(file) {
  try {
    await fs.lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await fs.rm(file, { recursive: true, force: true });
}

async function assertNoSymlinkPath(target, relativePath) {
  const root = path.resolve(target);
  const destination = path.resolve(root, relativePath);
  if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
    throw new Error(`gstack path escapes the target: ${relativePath}`);
  }

  for (let current = root; ; current = path.dirname(current)) {
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        throw new Error(`gstack target path contains a symlink: ${current}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current === path.dirname(current)) break;
  }

  let current = root;
  for (const segment of path.relative(root, destination).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        throw new Error(`gstack target path contains a symlink: ${current}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export async function isValidGstackCheckout(checkout, { run: runCommand = run } = {}) {
  try {
    const stat = await fs.lstat(checkout);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    await fs.access(path.join(checkout, "setup"), constants.X_OK);
    const insideWorkTree = runCommand("git", ["-C", checkout, "rev-parse", "--is-inside-work-tree"], { stdio: ["ignore", "pipe", "pipe"] });
    const workTreeRoot = runCommand("git", ["-C", checkout, "rev-parse", "--show-toplevel"], { stdio: ["ignore", "pipe", "pipe"] });
    return String(insideWorkTree).trim() === "true" &&
      path.resolve(String(workTreeRoot).trim()) === path.resolve(checkout);
  } catch {
    return false;
  }
}

function redactedGstackDiagnostic(error) {
  const output = [error.stderr, error.stdout, error.message]
    .map((value) => String(value || "").slice(-65536))
    .join("\n");
  const diagnostics = [
    "gstack output: [redacted].",
    ...(Number.isInteger(error.status) ? [`Exit code: ${error.status}.`] : []),
    ...(/\b(?:bun)\b/i.test(output) ? ["Bun prerequisite failed."] : []),
    ...(/\b(?:git|clone|checkout)\b/i.test(output) ? ["Git checkout operation failed."] : []),
    ...(/\b(?:network|download|fetch|connection|dns|tls|certificate)\b/i.test(output) ? ["Network operation failed."] : []),
    ...(/\b(?:permission|denied|access)\b/i.test(output) ? ["Permission or access check failed."] : []),
    ...(/\b(?:missing|required|not found|prerequisite)\b/i.test(output) ? ["A required prerequisite is missing or invalid."] : []),
    ...(/\b(?:error|fatal|fail(?:ed|ure)?)\b/i.test(output) ? ["gstack bootstrap failed."] : [])
  ];
  return diagnostics.join("\n").slice(0, GSTACK_DIAGNOSTIC_MAX_CHARS);
}

function replaceGstackPaths(source, checkout, statePath) {
  return source
    .replaceAll("~/.claude/skills/gstack", checkout)
    .replaceAll("$HOME/.claude/skills/gstack", checkout)
    .replaceAll("${GSTACK_HOME:-$HOME/.gstack}", statePath)
    .replaceAll("${HOME}/.gstack", statePath)
    .replaceAll("$HOME/.gstack", statePath)
    .replaceAll("~/.gstack", statePath)
    .replaceAll("${HOME}/.claude.json", path.join(statePath, "claude.json"))
    .replaceAll("$HOME/.claude.json", path.join(statePath, "claude.json"))
    .replaceAll("~/.claude.json", path.join(statePath, "claude.json"))
    .replaceAll("${HOME}/.claude", path.join(statePath, "claude"))
    .replaceAll("$HOME/.claude", path.join(statePath, "claude"))
    .replaceAll("~/.claude", path.join(statePath, "claude"))
    .replaceAll("${HOME}/.codex", path.join(statePath, "codex"))
    .replaceAll("$HOME/.codex", path.join(statePath, "codex"))
    .replaceAll("~/.codex", path.join(statePath, "codex"))
    .replaceAll("${HOME}/.bun", path.join(statePath, "bun"))
    .replaceAll("$HOME/.bun", path.join(statePath, "bun"))
    .replaceAll("~/.bun", path.join(statePath, "bun"));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `"'"'`)}'`;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function resolveSkillAlias(checkout, directory) {
  let resolved;
  try {
    resolved = await fs.realpath(directory);
  } catch (error) {
    throw new Error(`gstack skill symlink is invalid: ${directory} (${error.code || error.message})`);
  }
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
  if (!isInside(await fs.realpath(checkout), resolved)) {
    throw new Error(`gstack skill symlink escapes the local checkout: ${directory}`);
  }
  return resolved;
}

async function skillDirectories(checkout) {
  const directories = [];
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      directories.push({ source: directory, relative: path.relative(checkout, directory) });
    }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const relative = path.relative(checkout, candidate);
      const root = relative.split(path.sep)[0];
      if (entry.name === ".git" || entry.name.startsWith(".") || UNSUPPORTED_SKILL_ROOTS.has(root)) continue;
      if (entry.isDirectory()) await walk(candidate);
      else if (entry.isSymbolicLink()) {
        const resolved = await resolveSkillAlias(checkout, candidate);
        if (!resolved) continue;
        const resolvedEntries = await fs.readdir(resolved, { withFileTypes: true });
        if (resolvedEntries.some((child) => child.isFile() && child.name === "SKILL.md")) {
          directories.push({ source: resolved, relative });
        }
      }
    }
  }
  await walk(checkout);
  return directories;
}

function rewrittenGstackContent(source, checkout, statePath) {
  const rewritten = replaceGstackPaths(source, checkout, statePath);
  if (FORBIDDEN_HOME_PATH.test(rewritten)) {
    throw new Error(`gstack skill references forbidden home-scoped state: ${rewritten.match(FORBIDDEN_HOME_PATH)?.[0]}`);
  }
  return rewritten;
}

function wrapperContent(source, checkout, statePath) {
  return rewrittenGstackContent(source, checkout, statePath);
}

async function writeSkillWrapper(destination, content) {
  await ensureDir(destination);
  await fs.writeFile(path.join(destination, "SKILL.md"), content, "utf8");
}

async function snapshotGstackArtifacts(target, wrappers, assets, sidecars, statePath) {
  const paths = [
    ...wrappers.map(({ wrapper }) => path.join(target, wrapper, "SKILL.md")),
    ...assets.map(({ asset }) => path.join(target, ".claude", "skills", asset)),
    ...sidecars.map(({ sidecar }) => path.join(target, ".claude", "skills", sidecar)),
    path.join(statePath, "state.json"),
    path.join(target, ".claude", "settings.json")
  ];
  const statePathExisted = await fs.lstat(statePath).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  const snapshotRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-transaction-"));
  const entries = [];
  try {
    for (const destination of paths) {
      await assertNoSymlinkPath(target, path.relative(target, destination));
      try {
        await fs.lstat(destination);
        const snapshot = path.join(snapshotRoot, String(entries.length));
        await fs.cp(destination, snapshot, { recursive: true, force: true });
        entries.push({ destination, snapshot, exists: true });
      } catch (error) {
        if (error.code === "ENOENT") entries.push({ destination, exists: false });
        else throw error;
      }
    }
  } catch (error) {
    await fs.rm(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    async rollback() {
      for (const entry of [...entries].reverse()) {
        await assertNoSymlinkPath(target, path.relative(target, entry.destination));
        await fs.rm(entry.destination, { recursive: true, force: true });
        if (entry.exists) await fs.cp(entry.snapshot, entry.destination, { recursive: true, force: true });
      }
      if (!statePathExisted) await fs.rmdir(statePath).catch((error) => {
        if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
      });
    },
    async remove() {
      await fs.rm(snapshotRoot, { recursive: true, force: true });
    }
  };
}

async function expectedGstackWrappers(target, checkout, statePath) {
  const skillsRoot = path.dirname(checkout);
  const skillDirs = await skillDirectories(checkout);
  return Promise.all(skillDirs.map(async ({ source: sourceDir, relative }) => {
    const wrapper = path.relative(target, path.join(skillsRoot, relative || "_gstack-command"));
    const source = await fs.readFile(path.join(sourceDir, "SKILL.md"), "utf8");
    return { wrapper, content: wrapperContent(source, checkout, statePath) };
  })).then((wrappers) => wrappers.sort((left, right) => left.wrapper.localeCompare(right.wrapper)));
}

async function skillAssets(checkout, statePath, sourceDir, relative) {
  const assets = [];
  const sections = path.join(sourceDir, "sections");
  try {
    const stat = await fs.lstat(sections);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`gstack skill sections are invalid: ${sections}`);
  } catch (error) {
    if (error.code === "ENOENT") return assets;
    throw error;
  }
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const source = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`gstack skill asset must not be a symlink: ${source}`);
      if (entry.isDirectory()) await walk(source);
      else if (entry.isFile()) {
        const asset = path.join(relative || "_gstack-command", path.relative(sourceDir, source));
        assets.push({ asset, content: rewrittenGstackContent(await fs.readFile(source, "utf8"), checkout, statePath) });
      }
    }
  }
  await walk(sections);
  return assets;
}

async function expectedGstackAssets(target, checkout, statePath) {
  const skillDirs = await skillDirectories(checkout);
  const groups = await Promise.all(skillDirs.map(({ source, relative }) => skillAssets(checkout, statePath, source, relative)));
  return groups.flat().sort((left, right) => left.asset.localeCompare(right.asset));
}

async function expectedGstackSidecars(checkout) {
  return Promise.all(GSTACK_REVIEW_SIDECARS.map(async (sidecar) => {
    await assertNoSymlinkPath(checkout, sidecar);
    const source = path.join(checkout, sidecar);
    const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`gstack review sidecar is missing or invalid: ${sidecar}`);
    }
    return { sidecar, content: await fs.readFile(source, "utf8") };
  }));
}

export async function bootstrapGstack({ target, checkout = gstackCheckoutPath(target), statePath = gstackStatePath(target), dryRun = false }) {
  await assertNoSymlinkPath(target, path.relative(target, checkout));
  await assertNoSymlinkPath(target, path.relative(target, statePath));
  const wrappers = await expectedGstackWrappers(target, checkout, statePath);
  const assets = await expectedGstackAssets(target, checkout, statePath);
  const sidecars = await expectedGstackSidecars(checkout);
  for (const { wrapper } of wrappers) await assertNoSymlinkPath(target, wrapper);
  for (const { asset } of assets) await assertNoSymlinkPath(target, path.join(".claude", "skills", asset));
  for (const { sidecar } of sidecars) await assertNoSymlinkPath(target, path.join(".claude", "skills", sidecar));
  for (const { wrapper, content } of wrappers) {
    const destination = path.join(target, wrapper);
    if (dryRun) console.log(`[dry-run] write gstack skill wrapper ${destination}`);
    else await writeSkillWrapper(destination, content);
  }
  for (const { asset, content } of assets) {
    const destination = path.join(target, ".claude", "skills", asset);
    if (dryRun) console.log(`[dry-run] write gstack skill asset ${destination}`);
    else {
      await ensureDir(path.dirname(destination));
      await fs.writeFile(destination, content, "utf8");
    }
  }
  for (const { sidecar, content } of sidecars) {
    const destination = path.join(target, ".claude", "skills", sidecar);
    if (dryRun) console.log(`[dry-run] write gstack review sidecar ${destination}`);
    else {
      await ensureDir(path.dirname(destination));
      await fs.writeFile(destination, content, "utf8");
    }
  }
  if (!dryRun) {
    await ensureDir(statePath);
    const stateFile = path.join(statePath, "state.json");
    try {
      if ((await fs.lstat(stateFile)).isSymbolicLink()) {
        throw new Error(`gstack target path contains a symlink: ${stateFile}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await writeJson(stateFile, {
      checkout: path.relative(target, checkout),
      wrappers: wrappers.map(({ wrapper }) => wrapper),
      assets: assets.map(({ asset }) => asset),
      sidecars: sidecars.map(({ sidecar }) => sidecar),
      bootstrappedAt: new Date().toISOString()
    });
  }
  return wrappers.map(({ wrapper }) => wrapper);
}

function hookCommand(checkout, statePath, hookName) {
  return `GSTACK_HOME=${shellQuote(statePath)} GSTACK_ROOT=${shellQuote(checkout)} ${shellQuote(path.join(checkout, "hosts", "claude", "hooks", hookName))}`;
}

async function hasValidPlanTuneHook(checkout, hookName) {
  try {
    const hook = path.join(checkout, "hosts", "claude", "hooks", hookName);
    await assertNoSymlinkPath(checkout, path.relative(checkout, hook));
    const stat = await fs.lstat(hook);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    await fs.access(hook, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertPlanTuneHooks(checkout) {
  for (const hookName of ["question-log-hook", "question-preference-hook"]) {
    if (!await hasValidPlanTuneHook(checkout, hookName)) {
      throw new Error(`gstack plan-tune hook is missing or not executable: ${hookName}`);
    }
  }
}

function isManagedHook(entry) {
  return entry?._gstack_source === GSTACK_HOOK_SOURCE;
}

export function applyPlanTuneHooks(settings = {}, { checkout, statePath, enabled }) {
  const hooks = Object.fromEntries(Object.entries(settings.hooks || {}).map(([event, entries]) => [
    event,
    (entries || []).filter((entry) => !isManagedHook(entry))
  ]).filter(([, entries]) => entries.length > 0));
  if (enabled) {
    for (const [event, hookName] of [["PostToolUse", "question-log-hook"], ["PreToolUse", "question-preference-hook"]]) {
      hooks[event] = [...(hooks[event] || []), {
        _gstack_source: GSTACK_HOOK_SOURCE,
        hooks: [{ type: "command", command: hookCommand(checkout, statePath, hookName), timeout: 5 }]
      }];
    }
  }
  return { ...settings, hooks };
}

export async function writePlanTuneHooks({ target, planTuneHooks, dryRun = false }) {
  const checkout = gstackCheckoutPath(target);
  if (planTuneHooks && !dryRun) await assertPlanTuneHooks(checkout);
  const file = path.join(target, ".claude", "settings.json");
  await assertNoSymlinkPath(target, path.relative(target, file));
  const settings = await readJson(file, {});
  await writeJson(file, applyPlanTuneHooks(settings, {
    checkout: gstackCheckoutPath(target),
    statePath: gstackStatePath(target),
    enabled: planTuneHooks
  }), { dryRun });
}

export async function resolveGstackCheckout({
  target,
  dryRun = false,
  globalCheckout = globalGstackCheckoutPath(),
  run: runCommand = run,
  copy = fs.cp,
  clone = (destination) => runCommand("git", ["clone", "--single-branch", "--depth", "1", GSTACK_REPOSITORY, destination], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: Infinity }),
  withSpinner: runWithSpinner = withSpinner
}) {
  const localCheckout = gstackCheckoutPath(target);
  await assertNoSymlinkPath(target, path.relative(target, localCheckout));
  if (await isValidGstackCheckout(localCheckout, { run: runCommand })) {
    return {
      checkout: localCheckout,
      source: "local",
      async commit() {},
      async rollback() {}
    };
  }
  const globalValid = await isValidGstackCheckout(globalCheckout, { run: runCommand });
  if (dryRun) {
    console.log(`[dry-run] ${globalValid ? `copy ${globalCheckout} -> ${localCheckout}` : `git clone --single-branch --depth 1 ${GSTACK_REPOSITORY} ${localCheckout}`}`);
    return {
      checkout: localCheckout,
      source: globalValid ? "global-migration" : "clone",
      async commit() {},
      async rollback() {}
    };
  }

  const parent = path.dirname(localCheckout);
  await ensureDir(parent);
  const temporary = await fs.mkdtemp(path.join(parent, ".gstack-"));
  try {
    if (globalValid) await copy(globalCheckout, temporary, { recursive: true, force: true });
    else await runWithSpinner("Downloading gstack", async () => {
      try {
        await clone(temporary);
      } catch (error) {
        const cloneError = new Error(error.message, { cause: error });
        cloneError.gstackCloneFailure = true;
        cloneError.stderr = error.stderr;
        cloneError.stdout = error.stdout;
        cloneError.status = error.status;
        throw cloneError;
      }
    });
    if (!await isValidGstackCheckout(temporary, { run: runCommand })) {
      throw new Error("Resolved gstack checkout is invalid.");
    }
    const backup = await fs.mkdtemp(path.join(parent, ".gstack-backup-"));
    await fs.rmdir(backup);
    try {
      try {
        await fs.lstat(localCheckout);
        await fs.rename(localCheckout, backup);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await fs.rename(temporary, localCheckout);
    } catch (error) {
      await removeLocalPath(localCheckout);
      try {
        await fs.lstat(backup);
        await fs.rename(backup, localCheckout);
      } catch (restoreError) {
        if (restoreError.code !== "ENOENT") throw restoreError;
      }
      throw error;
    }
    return {
      checkout: localCheckout,
      source: globalValid ? "global-migration" : "clone",
      async commit() {
        await removeLocalPath(backup);
      },
      async rollback() {
        await removeLocalPath(localCheckout);
        try {
          await fs.lstat(backup);
          await fs.rename(backup, localCheckout);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    };
  } catch (error) {
    await removePath(temporary);
    throw error;
  }
}

export function gstackSummaryRows(target, planTuneHooks = false) {
  return [
    ["Scope", "project-local .claude/skills/gstack"],
    ["Plan-tune hooks", planTuneHooks ? "installed in .claude/settings.json" : "not installed"],
    ["Status", "ready"]
  ];
}

export function gstackEnvironment(bun, environment = process.env) {
  if (!path.isAbsolute(bun)) return { ...environment };
  return { ...environment, PATH: `${path.dirname(bun)}${path.delimiter}${environment.PATH || ""}` };
}

export async function setupGstack({ target, dryRun = false, planTuneHooks = false, resolveCheckout = resolveGstackCheckout }) {
  const checkout = gstackCheckoutPath(target);
  const statePath = gstackStatePath(target);
  let checkoutLease = null;
  let transaction = null;
  try {
    if (!dryRun) ensureBun();
    const install = async () => {
      const resolved = await resolveCheckout({ target, dryRun });
      checkoutLease = resolved;
      if (!dryRun) {
        const wrappers = await expectedGstackWrappers(target, checkout, statePath);
        const assets = await expectedGstackAssets(target, checkout, statePath);
        const sidecars = await expectedGstackSidecars(checkout);
        transaction = await snapshotGstackArtifacts(target, wrappers, assets, sidecars, statePath);
        await bootstrapGstack({ target, checkout, statePath, dryRun });
      } else console.log(`[dry-run] write gstack skill wrapper ${path.join(path.dirname(checkout), "_gstack-command")}`);
      await writePlanTuneHooks({ target, planTuneHooks, dryRun });
      if (!dryRun) {
        await checkoutLease.commit();
        try {
          await transaction.remove();
        } catch (error) {
          console.warn(`WARN: gstack rollback snapshot cleanup failed: ${error.message}`);
        }
        transaction = null;
      }
      return { status: dryRun ? "dry-run" : "installed", source: resolved.source, path: checkout, statePath };
    };
    const result = await install();
    if (!dryRun) printSummary("gstack", gstackSummaryRows(target, planTuneHooks));
    return result;
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.warn(`WARN: gstack artifact rollback failed: ${rollbackError.message}`);
      }
      try {
        await transaction.remove();
      } catch (rollbackError) {
        console.warn(`WARN: gstack rollback snapshot cleanup failed: ${rollbackError.message}`);
      }
    }
    if (checkoutLease) {
      try {
        await checkoutLease.rollback();
      } catch (rollbackError) {
        console.warn(`WARN: gstack checkout rollback failed: ${rollbackError.message}`);
      }
    }
    if (error.gstackCloneFailure) {
      const stderr = String(error.stderr || "");
      if (stderr) process.stderr.write(stderr);
    }
    return { status: "failed", path: checkout, statePath, error: redactedGstackDiagnostic(error) };
  }
}

export async function removeEccPluginSettings({ target, dryRun = false }) {
  if (isTracked(target, ".claude/settings.local.json")) throw new Error(".claude/settings.local.json is tracked. Untrack it before writing local plugin settings.");
  await writePrivateJson(path.join(target, ".claude", "settings.local.json"), (settings = {}) => {
    const enabledPlugins = { ...(settings.enabledPlugins || {}) };
    const extraKnownMarketplaces = { ...(settings.extraKnownMarketplaces || {}) };
    delete enabledPlugins["ecc@ecc"];
    delete extraKnownMarketplaces.ecc;
    return { ...settings, enabledPlugins, extraKnownMarketplaces };
  }, { dryRun, label: ".claude/settings.local.json", parentLabel: ".claude" });
  await appendGitignoreLine(target, ".claude/", { dryRun });
}

export async function validateProjectGstack(target) {
  const checkout = gstackCheckoutPath(target);
  const statePath = gstackStatePath(target);
  let pathsValid = true;
  try {
    await assertNoSymlinkPath(target, path.relative(target, checkout));
    await assertNoSymlinkPath(target, path.relative(target, statePath));
  } catch {
    pathsValid = false;
  }
  const checkoutValid = pathsValid && await isValidGstackCheckout(checkout);
  const stateFile = path.join(statePath, "state.json");
  let stateValid = pathsValid;
  let wrapperState = {};
  if (stateValid) {
    try {
      await assertNoSymlinkPath(target, path.relative(target, stateFile));
      const stateStat = await fs.lstat(stateFile);
      if (!stateStat.isFile() || stateStat.isSymbolicLink()) stateValid = false;
      else {
        wrapperState = await readJson(stateFile, {});
        if (!wrapperState ||
          !Array.isArray(wrapperState.wrappers) ||
          !Array.isArray(wrapperState.assets) ||
          !Array.isArray(wrapperState.sidecars) ||
          wrapperState.checkout !== path.relative(target, checkout) ||
          Number.isNaN(Date.parse(wrapperState.bootstrappedAt))) {
          stateValid = false;
          wrapperState = {};
        }
      }
    } catch {
      stateValid = false;
    }
  }
  const wrappers = wrapperState.wrappers || [];
  const assets = wrapperState.assets || [];
  const sidecars = wrapperState.sidecars || [];
  let expectedWrappers = [];
  let expectedAssets = [];
  let expectedSidecars = [];
  if (checkoutValid) {
    try {
      [expectedWrappers, expectedAssets, expectedSidecars] = await Promise.all([
        expectedGstackWrappers(target, checkout, statePath),
        expectedGstackAssets(target, checkout, statePath),
        expectedGstackSidecars(checkout)
      ]);
    } catch {
      stateValid = false;
    }
  }
  const wrappersMatch = JSON.stringify([...wrappers].sort()) === JSON.stringify(expectedWrappers.map(({ wrapper }) => wrapper));
  const assetsMatch = JSON.stringify([...assets].sort()) === JSON.stringify(expectedAssets.map(({ asset }) => asset));
  const sidecarsMatch = JSON.stringify([...sidecars].sort()) === JSON.stringify(expectedSidecars.map(({ sidecar }) => sidecar).sort());
  const wrappersValid = checkoutValid && stateValid && wrappers.length > 0 && wrappersMatch && await Promise.all(expectedWrappers.map(async ({ wrapper, content }) => {
    try {
      const file = path.join(target, wrapper, "SKILL.md");
      await assertNoSymlinkPath(target, path.relative(target, file));
      return exists(file) && await fs.readFile(file, "utf8") === content;
    } catch {
      return false;
    }
  })).then((valid) => valid.every(Boolean));
  const assetChecks = await Promise.all(expectedAssets.map(async ({ asset, content }) => {
    try {
      const file = path.join(target, ".claude", "skills", asset);
      await assertNoSymlinkPath(target, path.relative(target, file));
      const stat = await fs.lstat(file);
      const actual = await fs.readFile(file, "utf8");
      return stat.isFile() && !stat.isSymbolicLink() && actual === content;
    } catch {
      return false;
    }
  }));
  const assetsValid = checkoutValid && stateValid && assetsMatch && assetChecks.every(Boolean);
  const sidecarChecks = await Promise.all(expectedSidecars.map(async ({ sidecar, content }) => {
    try {
      const file = path.join(target, ".claude", "skills", sidecar);
      await assertNoSymlinkPath(target, path.relative(target, file));
      const stat = await fs.lstat(file);
      const actual = await fs.readFile(file, "utf8");
      return stat.isFile() && !stat.isSymbolicLink() && actual === content;
    } catch {
      return false;
    }
  }));
  const sidecarsValid = checkoutValid && stateValid && sidecarsMatch && sidecarChecks.every(Boolean);
  return { checkout, statePath, checkoutValid, stateValid, wrappers, wrappersValid, assets, assetsValid, sidecars, sidecarsValid };
}
