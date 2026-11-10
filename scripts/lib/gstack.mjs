import { execFileSync as childExecFileSync } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendGitignoreLine, copyRecursiveWithProgress, ensureDir, exists, isTracked, readJson, removePath, writeJson, writePrivateJson } from "./fs-utils.mjs";
import { validateGstackRuntime, runRuntimeCommand } from "./gstack-runtime.mjs";
import { GSTACK_DOCUMENT_MANIFEST, normalizeGstackDocuments, normalizeGstackRenderedDocuments, recordGstackDocuments, restoreGstackDocuments, rewriteGstackPaths, verifyGstackDocuments } from "./gstack-documents.mjs";
import { GSTACK_UPSTREAM_MANIFEST, GSTACK_UPSTREAM_OWNER, manifestForPaths, runUpstreamLocalSetup, snapshotUpstreamTransaction, verifyUpstreamManifest } from "./gstack-upstream.mjs";

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

function run(command, args, options = {}) {
  return childExecFileSync(command, args, { encoding: "utf8", ...options });
}

function parseBunVersion(output) {
  const match = String(output).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  const version = match?.slice(1).map(Number);
  const belowMinimum = !version || version[0] < 1 || (version[0] === 1 && (version[1] < 4 || (version[1] === 4 && version[2] < 2)));
  if (belowMinimum) {
    throw new Error(`Bun v1.4.2+ is required; found ${String(output).trim() || "an invalid version"}. Install Bun manually and rerun setup.`);
  }
}

export function ensureBun({ run: runCommand = run } = {}) {
  try {
    const version = runCommand("bun", ["--version"], { stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
    parseBunVersion(version);
    return "bun";
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Bun v1.4.2+ is required. Install Bun manually from https://bun.sh/docs/installation and rerun setup.");
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
    const insideWorkTree = runCommand("git", ["-C", checkout, "rev-parse", "--is-inside-work-tree"], { stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
    const workTreeRoot = runCommand("git", ["-C", checkout, "rev-parse", "--show-toplevel"], { stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
    return String(insideWorkTree).trim() === "true" &&
      path.resolve(String(workTreeRoot).trim()) === path.resolve(checkout);
  } catch {
    return false;
  }
}

const GSTACK_SAFE_STAGES = new Set(["Bun validation", "checkout resolution", "checkout preparation", "gstack safety checks", "gstack bootstrap", "plan-tune hooks", "final validation", "upstream local setup"]);

function redactedGstackDiagnostic(error) {
  const output = [error.stderr, error.stdout, error.message]
    .map((value) => String(value || "").slice(-65536))
    .join("\n");
  const diagnostics = [
    "gstack output: [redacted].",
    ...(Array.isArray(error.gstackDocumentPaths) ? [`gstack document ownership conflict: ${error.gstackDocumentPaths.map((file) => JSON.stringify(file)).join(", ")}. Preserve user changes and rerun repo-pattern setup.`] : []),
    ...(typeof error.gstackStage === "string" && (GSTACK_SAFE_STAGES.has(error.gstackStage) || /^(?:dependency install|runtime build|Chromium install|Chromium launch|dependencies|(?:browse\/dist\/(?:browse|find-browse)|design\/dist\/design|make-pdf\/dist\/pdf) execution)$/.test(error.gstackStage)) ? [`Failed stage: ${error.gstackStage}. Rerun repo-pattern setup to repair.`] : []),
    ...(/Missing Linux system libraries/.test(error.message || "") ? ["Missing Linux system libraries. Ask your administrator to install Playwright Chromium prerequisites; no OS packages were installed."] : []),
    ...(/^gstack safety skill ownership conflict: \.claude\/skills\//.test(error.message || "") ? ["gstack safety skill ownership conflict. Preserve the foreign skill; resolve ownership before rerunning setup."] : []),
    ...(/^gstack safety skills are missing:/.test(error.message || "") ? ["gstack safety skills are incomplete. Install careful, guard, and freeze together, then rerun setup."] : []),
    ...(/^gstack safety helper is missing required function:/.test(error.message || "") ? ["gstack safety helper is incompatible. Refresh the gstack checkout, then rerun setup."] : []),
    ...(/^gstack safety (?:frontmatter|hook event|hook structure|hook matchers|hook commands) (?:is invalid|are invalid|are missing):/.test(error.message || "") ? ["gstack safety hook structure is incompatible. Refresh the gstack checkout, then rerun setup."] : []),
    ...(/^gstack safety hook command is not project-local:/.test(error.message || "") ? ["gstack safety hook command is invalid. Refresh the gstack checkout, then rerun setup."] : []),
    ...(/^gstack plan-tune hook is missing or not executable:/.test(error.message || "") ? ["gstack plan-tune hook is missing or not executable. Rerun setup to repair local hooks."] : []),
    ...(/^gstack review sidecar is missing or invalid:/.test(error.message || "") ? ["gstack review sidecar is missing or invalid. Refresh the gstack checkout, then rerun setup."] : []),
    ...(process.env.REPO_PATTERN_DEBUG_GSTACK === "1" && error.gstackOutput ? [`Debug output: ${String(error.gstackOutput).slice(-4000)}`] : []),
    ...(Number.isInteger(error.status) ? [`Exit code: ${error.status}.`] : []),
    ...(/unsupported legacy gstack state\.json has no upstream manifest/.test(error.message || "") ? ["Unsupported legacy gstack state.json has no upstream manifest. Preserve existing files; reinstall using upstream setup. Automatic migration is not supported."] : []),
    ...(error.gstackCloneFailure ? ["gstack clone failed. Check Git access and network connectivity, then rerun setup."] : []),
    ...(!error.gstackCloneFailure && /\b(?:bun)\b/i.test(output) ? ["Bun prerequisite failed."] : []),
    ...(!error.gstackCloneFailure && /\b(?:git|checkout)\b/i.test(output) ? ["Git checkout operation failed."] : []),
    ...(!error.gstackCloneFailure && /\b(?:network|download|fetch|connection|dns|tls|certificate)\b/i.test(output) ? ["Network operation failed."] : []),
    ...(!error.gstackCloneFailure && /\b(?:permission|denied|access)\b/i.test(output) ? ["Permission or access check failed."] : []),
    ...(!error.gstackStage && !error.gstackCloneFailure && /\b(?:missing|required|not found|prerequisite)\b/i.test(output) ? ["A required prerequisite is missing or invalid."] : []),
    ...(!error.gstackStage && !error.gstackCloneFailure && /\b(?:error|fatal|fail(?:ed|ure)?)\b/i.test(output) ? ["gstack bootstrap failed."] : [])
  ];
  return diagnostics.join("\n").slice(0, GSTACK_DIAGNOSTIC_MAX_CHARS);
}

/* legacy path rewriting removed */

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
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

export async function writePlanTuneHooks({ target, planTuneHooks, dryRun = false, progress = null, silent = false }) {
  const operation = progress?.beginOperation?.({ id: "gstack-hooks", label: "Writing gstack hooks", totalUnits: 1, weight: 1 });
  try {
    const checkout = gstackCheckoutPath(target);
    if (planTuneHooks && !dryRun) await assertPlanTuneHooks(checkout);
    const file = path.join(target, ".claude", "settings.json");
    await assertNoSymlinkPath(target, path.relative(target, file));
    const settings = await readJson(file, {});
    await writeJson(file, applyPlanTuneHooks(settings, {
      checkout: gstackCheckoutPath(target),
      statePath: gstackStatePath(target),
      enabled: planTuneHooks
    }), { dryRun, silent });
    operation?.complete({ detail: dryRun ? "preview" : "completed" });
  } catch (error) {
    operation?.fail({ detail: "failed" });
    throw error;
  }
}

export async function resolveGstackCheckout({
  target,
  dryRun = false,
  globalCheckout = globalGstackCheckoutPath(),
  run: runCommand = run,
  copy = copyRecursiveWithProgress,
  clone = null,
  prepare = null,
  upgrade = false,
  progress = null,
  silent = false
}) {
  const localCheckout = gstackCheckoutPath(target);
  await assertNoSymlinkPath(target, path.relative(target, localCheckout));
  const localValid = !upgrade && await isValidGstackCheckout(localCheckout, { run: runCommand });
  if (localValid && !prepare) {
    const operation = progress?.beginOperation?.({ id: "gstack-checkout", label: "Using gstack checkout", totalUnits: 1, weight: 2 });
    operation?.complete({ detail: "local checkout ready" });
    return {
      checkout: localCheckout,
      source: "local",
      async commit() {},
      async rollback() {}
    };
  }
  if (await exists(localCheckout) && !await isValidGstackCheckout(localCheckout, { run: runCommand })) throw new Error("Existing gstack checkout is invalid. Preserve its contents and resolve ownership before setup.");
  let managedDocuments = null;
  if ((upgrade || prepare) && await exists(localCheckout)) {
    const manifestFile = path.join(gstackStatePath(target), GSTACK_DOCUMENT_MANIFEST);
    await assertNoSymlinkPath(target, path.relative(target, manifestFile));
    managedDocuments = await readJson(manifestFile, null);
    if (managedDocuments) {
      const conflicts = await verifyGstackDocuments(localCheckout, managedDocuments);
      if (conflicts.length) throw Object.assign(new Error(`gstack document ownership conflict: ${conflicts.join("; ")}`), { gstackDocumentPaths: conflicts.map((message) => message.split(":")[0]) });
    }
    const changes = childExecFileSync("git", ["-C", localCheckout, "status", "--porcelain", "-z", "--untracked-files=all"], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, timeout: 30000 });
    const normalizedPaths = new Set(managedDocuments?.version === 1 ? managedDocuments.files.map((entry) => entry.path) : []);
    const foreign = upgrade ? changes.split("\0").filter((entry) => entry && !(entry.startsWith(" M ") && normalizedPaths.has(entry.slice(3)))) : [];
    if (foreign.length) throw new Error(`gstack safety skill ownership conflict: .claude/skills/gstack checkout has local changes: ${foreign.map((entry) => entry.slice(3)).join(", ")}. Preserve and resolve them before setup or upgrading.`);
  }
  const globalValid = !upgrade && await isValidGstackCheckout(globalCheckout, { run: runCommand });
  if (dryRun) {
    const operation = progress?.beginOperation?.({ id: "gstack-checkout", label: globalValid ? "Copying gstack checkout" : "Downloading gstack", totalUnits: 1, weight: 3 });
    if (!silent) console.log(`[dry-run] ${globalValid ? `copy ${globalCheckout} -> ${localCheckout}` : `git clone --single-branch --depth 1 ${GSTACK_REPOSITORY} ${localCheckout}`}`);
    operation?.complete({ detail: "preview" });
    return {
      checkout: localCheckout,
      source: localValid ? "local" : globalValid ? "global" : "clone",
      async commit() {},
      async rollback() {}
    };
  }

  const parent = path.dirname(localCheckout);
  await ensureDir(parent, { silent });
  const stagingRoot = await fs.mkdtemp(path.join(parent, ".gstack-"));
  // Stop Bun's workspace discovery before it reaches the target project's package.json.
  await fs.writeFile(path.join(stagingRoot, "package.json"), JSON.stringify({ private: true, workspaces: [] }));
  const temporary = path.join(stagingRoot, "checkout");
  await fs.mkdir(temporary);
  try {
    if (globalValid || localValid) {
      const operation = progress?.beginOperation?.({ id: "gstack-checkout", label: "Copying gstack checkout", totalUnits: 0, unitLabel: "files", weight: 2 });
      try {
        await copy(localValid ? localCheckout : globalCheckout, temporary, {
          recursive: true,
          force: true,
          silent,
          onProgress: ({ completedFiles, totalFiles, completedBytes, totalBytes }) => {
            const detail = totalBytes > 0
              ? `${completedFiles}/${totalFiles} files · ${completedBytes}/${totalBytes} bytes`
              : `${completedFiles}/${totalFiles} files`;
            operation?.update({ completedUnits: completedFiles, totalUnits: totalFiles, detail });
          }
        });
        operation?.complete({ detail: "completed" });
      } catch (error) {
        operation?.fail({ detail: "failed" });
        throw error;
      }
    } else {
      const operation = progress?.beginOperation?.({ id: "gstack-checkout", label: "Downloading gstack", totalUnits: 100, weight: 3 });
      try {
        if (clone) await clone(temporary);
        else await runRuntimeCommand("git", ["clone", "--progress", "--single-branch", "--depth", "1", GSTACK_REPOSITORY, temporary], { cwd: target, timeout: 600000, stage: "checkout clone" });
        operation?.complete({ detail: "completed" });
      } catch (error) {
        operation?.fail({ detail: "failed" });
        const cloneError = new Error(error.message, { cause: error });
        cloneError.gstackCloneFailure = true;
        cloneError.stderr = error.stderr;
        cloneError.stdout = error.stdout;
        cloneError.status = error.status;
        throw cloneError;
      }
    }
    if (!await isValidGstackCheckout(temporary, { run: runCommand })) {
      throw new Error("Resolved gstack checkout is invalid.");
    }
    if (prepare) await prepare(temporary);
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
      source: localValid ? "local" : globalValid ? "global" : "clone",
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
  } finally {
    await removePath(stagingRoot);
  }
}

export function gstackSummaryRows(target, planTuneHooks = false, browserStatus = "ready") {
  return [
    ["Scope", "project-local .claude/skills/gstack"],
    ["Plan-tune hooks", planTuneHooks ? "installed in .claude/settings.json" : "not installed"],
    ["Status", browserStatus === "skipped" ? "runtime ready; browser skipped" : browserStatus]
  ];
}

export function gstackEnvironment(bun, environment = process.env) {
  if (!path.isAbsolute(bun)) return { ...environment };
  return { ...environment, PATH: `${path.dirname(bun)}${path.delimiter}${environment.PATH || ""}` };
}

async function listSkillRoots(target) {
  const root = path.join(target, ".claude", "skills");
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".") && entry.name !== "gstack")
      .map((entry) => path.join(".claude", "skills", entry.name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function setupUpstreamGstack({ target, checkout, statePath, dryRun, planTuneHooks = false, upgrade, resolveCheckout, progress, silent }) {
  await assertNoSymlinkPath(target, path.relative(target, statePath));
  for (const relative of [".repo-pattern-runtime", ".repo-pattern-runtime/home", ".repo-pattern-runtime/claude-config", ".repo-pattern-runtime/state-root", ".repo-pattern-runtime/renders", ".repo-pattern-runtime/codex", ".repo-pattern-runtime/state", ".claude/skills/gstack/.repo-pattern-runtime/tmp", ".claude/skills/gstack/.repo-pattern-runtime/chromium", ".claude/skills/gstack/.repo-pattern-runtime/bun-cache", ".claude/skills/gstack/.repo-pattern-runtime/bun"]) await assertNoSymlinkPath(target, relative);
  const publicationBefore = await listSkillRoots(target);
  const publicationNames = publicationBefore.map((relative) => path.basename(relative));
  const manifestFile = path.join(statePath, GSTACK_UPSTREAM_MANIFEST);
  const previous = await readJson(manifestFile, null);
  if (previous) {
    const errors = await verifyUpstreamManifest(target, previous);
    const documents = await readJson(path.join(statePath, GSTACK_DOCUMENT_MANIFEST), null);
    if (documents) errors.push(...await verifyGstackDocuments(checkout, documents));
    else errors.push("documents.json: missing upstream document integrity record");
    if (errors.length) throw Object.assign(new Error(errors.join("; ")), { gstackDocumentPaths: errors.map((error) => error.split(":")[0]) });
  }
  if (!previous && await exists(path.join(statePath, "state.json"))) {
    throw new Error("unsupported legacy gstack state.json has no upstream manifest; preserve files and reinstall using upstream setup; automatic migration is not supported");
  }
  const settingsFile = path.join(target, ".claude", "settings.json");
  await assertNoSymlinkPath(target, path.relative(target, settingsFile));
  await readJson(settingsFile, {});
  let lease;
  let transaction;
  if (dryRun) {
    try {
      lease = await resolveCheckout({ target, dryRun: true, upgrade, progress, silent, prepare: async () => {} });
    } catch (error) {
      error.gstackStage ||= "checkout resolution";
      throw error;
    }
    if (!silent) console.log(`[dry-run] run ${path.join(checkout, "setup")} --local --host claude --no-prefix --no-harness-auto --no-team`);
    return { status: "dry-run", source: lease.source || "upstream-local", path: checkout, statePath, browserSkipped: process.env.GSTACK_SKIP_PLAYWRIGHT === "1", browserStatus: "not-run" };
  }
  try {
    try { ensureBun(); }
    catch (error) { error.gstackStage = "Bun validation"; throw error; }
    transaction = await snapshotUpstreamTransaction({ target, checkout, statePath, publicationRoots: publicationNames });
    const priorDocuments = await readJson(path.join(statePath, GSTACK_DOCUMENT_MANIFEST), null);
    if (priorDocuments?.version === 1) await restoreGstackDocuments(checkout, priorDocuments);
    try {
      lease = await resolveCheckout({ target, dryRun: false, upgrade, progress, silent, prepare: async () => {} });
    } catch (error) {
      error.gstackStage ||= "checkout resolution";
      throw error;
    }
    const candidateRoots = [...new Set((await skillDirectories(checkout)).map(({ relative }) => relative ? path.basename(relative) : "_gstack-command"))];
    const publicationRoots = previous
      ? [...new Set(previous.entries.map(({ root }) => path.basename(root)))]
      : [];
    for (const root of candidateRoots) {
      if (publicationBefore.some((existing) => path.basename(existing) === root) && !publicationRoots.includes(root)) throw new Error(`gstack publication ownership conflict: ${root}`);
      await assertNoSymlinkPath(target, path.join(".claude", "skills", root));
    }
    for (const root of publicationRoots) await fs.rm(path.join(target, ".claude", "skills", root), { recursive: true, force: true });
    const browserSkipped = process.env.GSTACK_SKIP_PLAYWRIGHT === "1";
    const result = await runUpstreamLocalSetup({ target, checkout, statePath, publicationRoots, browserSkipped });
    const autoplanSkill = path.join(target, ".claude", "skills", "autoplan", "SKILL.md");
    const renderedSkill = await fs.realpath(autoplanSkill).catch(() => null);
    const renderRoot = renderedSkill && renderedSkill !== autoplanSkill && !renderedSkill.startsWith(`${checkout}${path.sep}`)
      ? path.dirname(path.dirname(renderedSkill)) : null;
    const documentSeeds = (await skillDirectories(checkout)).map(({ source }) => path.relative(checkout, path.join(source, "SKILL.md")));
    const documents = await normalizeGstackDocuments(checkout, documentSeeds, (source) => rewriteGstackPaths(source, checkout, result.env.GSTACK_HOME));
    if (renderRoot) {
      const runtimeRoot = await fs.realpath(path.join(target, ".repo-pattern-runtime"));
      if (!renderRoot.startsWith(`${runtimeRoot}${path.sep}`)) throw new Error("gstack render root escapes project runtime");
      await normalizeGstackRenderedDocuments(renderRoot, checkout, result.env.GSTACK_HOME);
    }
    await writePlanTuneHooks({ target, planTuneHooks, silent });
    const settings = await readJson(settingsFile, {});
    const runtimeEnv = { GSTACK_ROOT: checkout, GSTACK_STATE_ROOT: result.env.GSTACK_STATE_ROOT, GSTACK_HOME: result.env.GSTACK_HOME, PLAYWRIGHT_BROWSERS_PATH: result.env.PLAYWRIGHT_BROWSERS_PATH };
    if (renderRoot) runtimeEnv.GSTACK_USER_RENDER_DIR = renderRoot;
    for (const [key, value] of Object.entries(runtimeEnv)) {
      if (settings.env?.[key] && settings.env[key] !== value) throw new Error(`gstack runtime environment ownership conflict: ${key}`);
    }
    await writeJson(settingsFile, { ...settings, env: { ...settings.env, ...runtimeEnv } }, { silent });
    const published = (await listSkillRoots(target)).map((root) => path.basename(root)).filter((root) => candidateRoots.includes(root) || !publicationNames.includes(root));
    if (!published.includes("_gstack-command") && !published.includes("autoplan")) throw new Error("gstack upstream setup did not publish skills");
    const readiness = await validateGstackRuntime(checkout, { browserSkipped });
    if (!readiness.runtimeValid || !["ready", "skipped"].includes(readiness.browserStatus)) throw new Error("gstack upstream runtime validation failed");
    const manifest = await manifestForPaths(target, published);
    await fs.mkdir(statePath, { recursive: true });
    await writeJson(path.join(statePath, GSTACK_DOCUMENT_MANIFEST), documents, { silent });
    await writeJson(path.join(statePath, GSTACK_UPSTREAM_MANIFEST), manifest, { silent });
    await writeJson(path.join(statePath, "state.json"), { installOwner: GSTACK_UPSTREAM_OWNER, checkout: path.relative(target, checkout), statePath: path.relative(target, statePath), manifest: GSTACK_UPSTREAM_MANIFEST, wrappers: published.map((root) => path.join(".claude", "skills", root)), browserSkipped, installedAt: new Date().toISOString() }, { silent });
    await lease.commit();
    await transaction.remove().catch(() => {});
    return { status: "installed", source: lease.source || "upstream-local", path: checkout, statePath, browserSkipped, browserStatus: readiness.browserStatus };
  } catch (error) {
    const rollbackErrors = [];
    if (!transaction) {
      error.rollbackErrors = rollbackErrors;
      throw error;
    }
    try { await lease?.rollback(); } catch (rollbackError) { rollbackErrors.push(`gstack checkout rollback failed: ${rollbackError.message}`); }
    try {
      for (const root of await listSkillRoots(target)) {
        if (!publicationBefore.includes(root)) await fs.rm(path.join(target, root), { recursive: true, force: true });
      }
      await transaction.rollback();
    } catch (rollbackError) { rollbackErrors.push(`gstack artifact rollback failed: ${rollbackError.message}`); }
    error.rollbackErrors = rollbackErrors;
    if (rollbackErrors.length) error.recoverySnapshot = transaction.root;
    else await transaction.remove().catch(() => {});
    throw error;
  }
}

export async function setupGstack({ target, dryRun = false, planTuneHooks = false, upgrade = false, resolveCheckout = resolveGstackCheckout, progress = null, silent = false }) {
  const checkout = gstackCheckoutPath(target);
  const statePath = gstackStatePath(target);
  try { return await setupUpstreamGstack({ target, checkout, statePath, dryRun, planTuneHooks, upgrade, resolveCheckout, progress, silent }); }
  catch (error) { return { status: "failed", path: checkout, statePath, error: redactedGstackDiagnostic(error), rollbackErrors: error.rollbackErrors || [], recoverySnapshot: error.recoverySnapshot }; }
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
  const upstreamManifest = await readJson(path.join(statePath, GSTACK_UPSTREAM_MANIFEST), null);
  if (upstreamManifest?.owner === GSTACK_UPSTREAM_OWNER) {
    const checkoutValid = await isValidGstackCheckout(checkout);
    const manifestErrors = checkoutValid ? await verifyUpstreamManifest(target, upstreamManifest) : ["gstack upstream checkout is invalid"];
    let state = {};
    try {
      await assertNoSymlinkPath(target, path.relative(target, checkout));
      await assertNoSymlinkPath(target, path.relative(target, statePath));
      await assertNoSymlinkPath(target, path.relative(target, path.join(statePath, "state.json")));
      state = await readJson(path.join(statePath, "state.json"), {});
      if (state?.installOwner !== GSTACK_UPSTREAM_OWNER || state.checkout !== path.relative(target, checkout) || state.manifest !== GSTACK_UPSTREAM_MANIFEST) throw new Error("invalid upstream installation state");
    } catch { manifestErrors.push("invalid upstream installation state"); }
    const documents = await readJson(path.join(statePath, GSTACK_DOCUMENT_MANIFEST), null);
    if (checkoutValid && documents) manifestErrors.push(...await verifyGstackDocuments(checkout, documents));
    if (!documents) manifestErrors.push("documents.json: missing upstream document integrity record");
    const runtime = checkoutValid ? await validateGstackRuntime(checkout, { browserSkipped: state?.browserSkipped === true }) : { runtimeValid: false, browserStatus: "missing", runtimeChecks: [] };
    return { checkout, statePath, checkoutValid, stateValid: manifestErrors.length === 0, wrappers: [...new Set((Array.isArray(upstreamManifest.entries) ? upstreamManifest.entries : []).map((entry) => entry?.root).filter((root) => typeof root === "string"))], wrappersValid: manifestErrors.length === 0, assets: [], assetsValid: manifestErrors.length === 0, sidecars: [], sidecarsValid: manifestErrors.length === 0, documentsValid: manifestErrors.length === 0, documentErrors: manifestErrors, documentWarnings: [], ...runtime };
  }
  const checkoutValid = await isValidGstackCheckout(checkout);
  const manifestErrors = ["gstack upstream manifest is missing or invalid"];
  const state = await readJson(path.join(statePath, "state.json"), {});
  const runtime = { runtimeValid: false, browserStatus: "missing", runtimeChecks: [] };
  return { checkout, statePath, checkoutValid, stateValid: false, wrappers: [], wrappersValid: false, assets: [], assetsValid: false, sidecars: [], sidecarsValid: false, documentsValid: false, documentErrors: manifestErrors, documentWarnings: [], ...runtime };
}
