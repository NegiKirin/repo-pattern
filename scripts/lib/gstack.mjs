import { execFileSync as childExecFileSync } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendGitignoreLine, copyRecursiveWithProgress, ensureDir, exists, isTracked, readJson, removePath, writeJson, writePrivateJson } from "./fs-utils.mjs";
import { assertGstackSafety } from "./gstack-safety.mjs";
import { prepareGstackRuntime, validateGstackRuntime, runRuntimeCommand } from "./gstack-runtime.mjs";
import { printSummary } from "./prompt.mjs";
import { quoteGstackShellPaths } from "./gstack-shell-paths.mjs";
import { GSTACK_DOCUMENT_MANIFEST, discoverGstackDocuments, normalizeGstackDocuments, verifyGstackDocuments, restoreGstackDocuments } from "./gstack-documents.mjs";

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

const GSTACK_SAFE_STAGES = new Set(["Bun validation", "checkout resolution", "checkout preparation", "gstack safety checks", "gstack bootstrap", "plan-tune hooks", "final validation"]);

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

export function replaceGstackPaths(source, checkout, statePath, safetyRewrite = true) {
  const shellReplacements = [];
  for (const home of ["~", "$HOME", "${HOME}"]) {
    for (const [suffix, destination] of [["/.claude/skills/gstack", checkout], ["/.gstack", statePath], ["/.claude.json", path.join(statePath, "claude.json")], ["/.claude", path.join(statePath, "claude")], ["/.codex", path.join(statePath, "codex")], ["/.bun", path.join(statePath, "bun")]]) {
      if (/[\s'"$`\\]/.test(destination)) shellReplacements.push([home + suffix, destination]);
    }
  }
  if (/[\s'"$`\\]/.test(statePath)) shellReplacements.unshift(["${GSTACK_HOME:-$HOME/.gstack}", statePath]);
  source = quoteGstackShellPaths(source, shellReplacements);
  const converted = safetyRewrite ? source
    .replace(/^([\t ]*command:[\t ]*)'bash -c "exec bash \\"\$HOME\/\.claude\/skills\/gstack\/((?:careful|freeze)\/bin\/check-(?:careful|freeze)\.sh)\\""'[\t ]*$/gm,
      (_, prefix, script) => `${prefix}${JSON.stringify(`GSTACK_HOME=${shellQuote(statePath)} bash ${shellQuote(path.join(checkout, script))}`)}`)
    .replace(/^([\t ]*command:[\t ]*)"(bash )?(?:~|\$HOME)\/\.claude\/skills\/gstack\/((?:scripts|(?:careful|freeze)\/bin)\/check-(?:careful|freeze)\.sh)"[\t ]*$/gm,
      (_, prefix, interpreter, script) => `${prefix}${JSON.stringify(`GSTACK_HOME=${shellQuote(statePath)} ${interpreter || ""}${shellQuote(path.join(checkout, script))}`)}`)
    .replace(/(?:~|\$HOME)\/\.claude\/skills\/gstack\/bin\/gstack-paths(?=[)\s])/g,
      `GSTACK_HOME=${shellQuote(statePath)} ${shellQuote(path.join(checkout, "bin", "gstack-paths"))}`) : source;
  return converted
    .replace(/^(```(?:bash|sh|shell)\r?\n)(?!export PLAYWRIGHT_BROWSERS_PATH=)/gm, `$1export PLAYWRIGHT_BROWSERS_PATH=${shellQuote(path.join(checkout, ".repo-pattern-runtime", "chromium"))}\n`)
    .replaceAll("~/.claude/skills/gstack", checkout)
    .replaceAll("$HOME/.claude/skills/gstack", checkout)
    .replaceAll("${HOME}/.claude/skills/gstack", checkout)
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

function rewrittenGstackContent(source, checkout, statePath) {
  const rewritten = replaceGstackPaths(source, checkout, statePath)
    .replace(new RegExp(`${checkout.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^/\\s\x60\"']+)/sections/`, "g"), `${path.dirname(checkout)}/$1/sections/`);
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
    path.join(statePath, GSTACK_DOCUMENT_MANIFEST),
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
    snapshotRoot,
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
    let source = await fs.readFile(path.join(sourceDir, "SKILL.md"), "utf8");
    if (relative === "gstack-upgrade") {
      const frontmatter = source.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
      if (!frontmatter) throw new Error("gstack upgrade frontmatter is invalid.");
      const body = await fs.readFile(new URL("./gstack-upgrade.md", import.meta.url), "utf8");
      source = `${frontmatter}\n${body.replaceAll("{{TARGET}}", shellQuote(target))}`;
    }
    return { wrapper, content: wrapperContent(source, checkout, statePath) };
  })).then((wrappers) => wrappers.sort((left, right) => left.wrapper.localeCompare(right.wrapper)));
}

async function skillAssets(checkout, statePath, sourceDir, relative) {
  const assets = [];
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
  for (const root of ["sections", "templates", "references"]) {
    const directory = path.join(sourceDir, root);
    try {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`gstack skill ${root} are invalid: ${directory}`);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    await walk(directory);
  }
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

export async function bootstrapGstack({ target, checkout = gstackCheckoutPath(target), statePath = gstackStatePath(target), previousWrappers = [], previousAssets = [], previousSidecars = [], dryRun = false, progress = null, silent = false }) {
  await assertNoSymlinkPath(target, path.relative(target, checkout));
  await assertNoSymlinkPath(target, path.relative(target, statePath));
  if (dryRun) {
    const operation = progress?.beginOperation?.({ id: "gstack-bootstrap", label: "Bootstrapping gstack", totalUnits: 1, unitLabel: "items", weight: 2 });
    if (!silent) console.log(`[dry-run] write gstack skill wrappers and sidecars under ${path.join(target, ".claude", "skills")}`);
    operation?.complete({ detail: "preview" });
    return [];
  }
  const wrappers = await expectedGstackWrappers(target, checkout, statePath);
  for (const { wrapper, content } of wrappers) {
    const skill = path.relative(path.join(".claude", "skills"), wrapper);
    const file = path.join(target, wrapper, "SKILL.md");
    await assertNoSymlinkPath(target, path.relative(target, file));
    try {
      const actual = await fs.readFile(file, "utf8");
      const upstream = await fs.readFile(path.join(checkout, skill === "_gstack-command" ? "" : skill, "SKILL.md"), "utf8");
      const legacy = replaceGstackPaths(upstream, checkout, statePath, false).replace(/^export PLAYWRIGHT_BROWSERS_PATH=.*\r?\n/gm, "");
      const previousGeneration = replaceGstackPaths(upstream, checkout, statePath).replace(/^export PLAYWRIGHT_BROWSERS_PATH=.*\r?\n/gm, "");
      const previous = previousWrappers.find((entry) => entry.wrapper === wrapper)?.content;
      if (actual !== content && actual !== upstream && actual !== legacy && actual !== previousGeneration && actual !== content.replace(/^export PLAYWRIGHT_BROWSERS_PATH=.*\r?\n/gm, "") && actual !== previous) throw new Error(`gstack safety skill ownership conflict: ${wrapper}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const assets = await expectedGstackAssets(target, checkout, statePath);
  const sidecars = await expectedGstackSidecars(checkout);
  for (const { wrapper } of wrappers) await assertNoSymlinkPath(target, wrapper);
  for (const { asset } of assets) await assertNoSymlinkPath(target, path.join(".claude", "skills", asset));
  for (const { sidecar } of sidecars) await assertNoSymlinkPath(target, path.join(".claude", "skills", sidecar));
  const work = [
    ...wrappers.map(({ wrapper, content }) => ({ label: "Writing gstack wrappers", destination: path.join(target, wrapper), content, kind: "wrapper" })),
    ...assets.map(({ asset, content }) => ({ label: "Writing gstack assets", destination: path.join(target, ".claude", "skills", asset), content, kind: "asset" })),
    ...sidecars.map(({ sidecar, content }) => ({ label: "Writing gstack sidecars", destination: path.join(target, ".claude", "skills", sidecar), content, kind: "sidecar" }))
  ];
  for (const item of work.filter(({ kind }) => kind !== "wrapper")) {
    await assertNoSymlinkPath(target, path.relative(target, item.destination));
    try {
      const actual = await fs.readFile(item.destination, "utf8");
      const previous = item.kind === "asset"
        ? previousAssets.find(({ asset }) => path.join(target, ".claude", "skills", asset) === item.destination)?.content
        : previousSidecars.find(({ sidecar }) => path.join(target, ".claude", "skills", sidecar) === item.destination)?.content;
      const previousGeneration = item.kind === "asset"
        ? replaceGstackPaths(await fs.readFile(path.join(checkout, path.relative(path.join(target, ".claude", "skills"), item.destination)), "utf8"), checkout, statePath).replace(/^export PLAYWRIGHT_BROWSERS_PATH=.*\r?\n/gm, "")
        : item.content;
      if (actual !== item.content && actual !== previous && actual !== previousGeneration && actual !== item.content.replace(/^export PLAYWRIGHT_BROWSERS_PATH=.*\r?\n/gm, "")) throw new Error(`gstack safety skill ownership conflict: ${path.relative(target, item.destination)}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const operation = progress?.beginOperation?.({ id: "gstack-bootstrap", label: "Bootstrapping gstack", totalUnits: work.length + 1, unitLabel: "items", weight: 2 });
  try {
    let completed = 0;
    for (const item of work) {
      if (dryRun) {
        if (!silent) console.log(`[dry-run] write gstack ${item.kind} ${item.destination}`);
      } else if (item.kind === "wrapper") await writeSkillWrapper(item.destination, item.content);
      else {
        await ensureDir(path.dirname(item.destination));
        await fs.writeFile(item.destination, item.content, "utf8");
      }
      operation?.update({ completedUnits: ++completed, totalUnits: work.length + 1, detail: `${completed}/${work.length + 1} items` });
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
      }, { silent });
    }
    operation?.update({ completedUnits: ++completed, totalUnits: work.length + 1, detail: `${completed}/${work.length + 1} items` });
    operation?.complete({ detail: "completed" });
  } catch (error) {
    operation?.fail({ detail: "failed" });
    throw error;
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
    const managed = managedDocuments ? new Set(managedDocuments.files.map((entry) => entry.path)) : null;
    const foreign = changes.split("\0").filter(Boolean).filter((entry) => {
      const status = entry.slice(0, 2);
      const file = entry.slice(3);
      return managedDocuments
        ? (upgrade && !managed.has(file)) || (managed.has(file) && status !== " M")
        : Boolean(upgrade);
    });
    if (foreign.length) throw new Error(`gstack safety skill ownership conflict: .claude/skills/gstack checkout has local changes: ${foreign.map((entry) => entry.slice(3)).join(", ")}. Preserve and resolve them before setup or upgrading.`);
  }
  const globalValid = !upgrade && await isValidGstackCheckout(globalCheckout, { run: runCommand });
  if (dryRun) {
    const operation = progress?.beginOperation?.({ id: "gstack-checkout", label: globalValid ? "Copying gstack checkout" : "Downloading gstack", totalUnits: 1, weight: 3 });
    if (!silent) console.log(`[dry-run] ${globalValid ? `copy ${globalCheckout} -> ${localCheckout}` : `git clone --single-branch --depth 1 ${GSTACK_REPOSITORY} ${localCheckout}`}`);
    operation?.complete({ detail: "preview" });
    return {
      checkout: localCheckout,
      source: localValid ? "local" : globalValid ? "global-migration" : "clone",
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
    if (managedDocuments && localValid) await restoreGstackDocuments(temporary, managedDocuments);
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
      source: localValid ? "local" : globalValid ? "global-migration" : "clone",
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

export async function setupGstack({ target, dryRun = false, planTuneHooks = false, upgrade = false, resolveCheckout = resolveGstackCheckout, progress = null, silent = false }) {
  const checkout = gstackCheckoutPath(target);
  const statePath = gstackStatePath(target);
  let checkoutLease = null;
  let transaction = null;
  let currentStage = "Bun validation";
  try {
    if (!dryRun) ensureBun();
    const install = async () => {
      currentStage = "checkout resolution";
      const previousValid = !dryRun && await exists(path.join(statePath, "state.json")) && await isValidGstackCheckout(checkout);
      if (previousValid) {
        const manifestFile = path.join(statePath, GSTACK_DOCUMENT_MANIFEST);
        await assertNoSymlinkPath(target, path.relative(target, manifestFile));
        const manifest = await readJson(manifestFile, null);
        if (manifest) {
          const conflicts = await verifyGstackDocuments(checkout, manifest);
          if (conflicts.length) throw Object.assign(new Error("gstack document ownership conflict"), { gstackDocumentPaths: conflicts.map((message) => message.split(":")[0]) });
        }
      }
      const previousWrappers = previousValid ? await expectedGstackWrappers(target, checkout, statePath) : [];
      const previousAssets = previousValid ? await expectedGstackAssets(target, checkout, statePath) : [];
      const previousSidecars = previousValid ? await expectedGstackSidecars(checkout) : [];
      const browserSkipped = process.env.GSTACK_SKIP_PLAYWRIGHT === "1";
      currentStage = "checkout resolution";
      let documentManifest = null;
      const resolved = await resolveCheckout({ target, dryRun, upgrade, progress, silent, prepare: async (staged) => {
        currentStage = "checkout preparation";
        const upstreamSeeds = (await skillDirectories(staged)).map(({ source }) => path.relative(staged, path.join(source, "SKILL.md")));
        await normalizeGstackDocuments(staged, upstreamSeeds, (source) => source);
        await prepareGstackRuntime(staged, { browserSkipped });
        const seeds = (await skillDirectories(staged)).map(({ source }) => path.relative(staged, path.join(source, "SKILL.md")));
        documentManifest = await normalizeGstackDocuments(staged, seeds, (source) => replaceGstackPaths(source, checkout, statePath));
      } });
      checkoutLease = resolved;
      if (!dryRun) {
        currentStage = "gstack safety checks";
        const wrappers = await expectedGstackWrappers(target, checkout, statePath);
        await assertGstackSafety({ checkout, wrappers, statePath });
        const assets = await expectedGstackAssets(target, checkout, statePath);
        const sidecars = await expectedGstackSidecars(checkout);
        transaction = await snapshotGstackArtifacts(target, wrappers, assets, sidecars, statePath);
      }
      currentStage = "gstack bootstrap";
      await bootstrapGstack({ target, checkout, statePath, previousWrappers, previousAssets, previousSidecars, dryRun, progress, silent });
      currentStage = "plan-tune hooks";
      await writePlanTuneHooks({ target, planTuneHooks, dryRun, progress, silent });
      if (!dryRun) {
        const stateFile = path.join(statePath, "state.json");
        await writeJson(stateFile, { ...await readJson(stateFile, {}), browserSkipped }, { silent });
        if (documentManifest) await writeJson(path.join(statePath, GSTACK_DOCUMENT_MANIFEST), documentManifest, { silent });
        currentStage = "final validation";
        const validation = await validateProjectGstack(target);
        if (![validation.checkoutValid, validation.stateValid, validation.wrappersValid, validation.assetsValid, validation.sidecarsValid, validation.documentsValid, validation.runtimeValid, ["ready", "skipped"].includes(validation.browserStatus)].every(Boolean)) throw new Error(`gstack ${upgrade ? "upgrade" : "setup"} validation failed.`);
        await checkoutLease.commit();
        try {
          await transaction.remove();
        } catch (error) {
          if (!silent) console.warn(`WARN: gstack rollback snapshot cleanup failed: ${error.message}`);
        }
        transaction = null;
      }
      return { status: dryRun ? "dry-run" : "installed", source: resolved.source, path: checkout, statePath, browserSkipped, browserStatus: dryRun ? "not-run" : browserSkipped ? "skipped" : "ready" };
    };
    const result = await install();
    if (!dryRun && !silent) printSummary("gstack", gstackSummaryRows(target, planTuneHooks, result.browserStatus), { progress });
    return result;
  } catch (error) {
    if (!error.gstackStage && GSTACK_SAFE_STAGES.has(currentStage)) error.gstackStage = currentStage;
    const rollbackErrors = [];
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        rollbackErrors.push(`gstack artifact rollback failed: ${rollbackError.message}`);
        if (!silent) console.warn(`WARN: ${rollbackErrors.at(-1)}`);
      }
      if (rollbackErrors.length === 0) {
        try {
          await transaction.remove();
        } catch (rollbackError) {
          rollbackErrors.push(`gstack rollback snapshot cleanup failed: ${rollbackError.message}`);
          if (!silent) console.warn(`WARN: ${rollbackErrors.at(-1)}`);
        }
      }
    }
    if (checkoutLease) {
      try {
        await checkoutLease.rollback();
      } catch (rollbackError) {
        rollbackErrors.push(`gstack checkout rollback failed: ${rollbackError.message}`);
        if (!silent) console.warn(`WARN: ${rollbackErrors.at(-1)}`);
      }
    }
    if (error.gstackCloneFailure && !silent) {
      const stderr = String(error.stderr || "");
      if (stderr) process.stderr.write(stderr);
    }
    return {
      status: "failed",
      path: checkout,
      statePath,
      error: redactedGstackDiagnostic(error),
      ...(rollbackErrors.length > 0 ? { rollbackErrors, ...(transaction && rollbackErrors.some((message) => message.startsWith("gstack artifact rollback failed:")) ? { recoverySnapshot: transaction.snapshotRoot } : {}) } : {})
    };
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
      await assertGstackSafety({ checkout, wrappers: expectedWrappers, statePath });
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
  const runtime = checkoutValid ? await validateGstackRuntime(checkout, { browserSkipped: wrapperState.browserSkipped === true }) : { runtimeValid: false, browserStatus: "missing", runtimeChecks: [] };
  let documentErrors = [];
  const documentWarnings = [];
  if (checkoutValid && pathsValid) {
    try {
      const manifestFile = path.join(statePath, GSTACK_DOCUMENT_MANIFEST);
      await assertNoSymlinkPath(target, path.relative(target, manifestFile));
      documentErrors = await verifyGstackDocuments(checkout, await readJson(manifestFile, null));
      const seeds = (await skillDirectories(checkout)).map(({ source }) => path.relative(checkout, path.join(source, "SKILL.md")));
      const inventory = await discoverGstackDocuments(checkout, seeds, { clean: true, diagnostics: documentWarnings });
      const manifest = await readJson(manifestFile, null);
      if (JSON.stringify(inventory) !== JSON.stringify(manifest?.files?.map((entry) => entry.path).sort())) documentErrors.push("documents.json: managed document inventory mismatch; rerun repo-pattern setup");
      for (const relative of inventory) {
        const lines = (await fs.readFile(path.join(checkout, relative), "utf8")).split(/\r?\n/);
        for (const [index, line] of lines.entries()) {
          if (FORBIDDEN_HOME_PATH.test(line) || /(?:~|\$HOME|\$\{HOME\})\/\.claude\.json/.test(line)) documentErrors.push(`${relative}:${index + 1}: global document path; rerun repo-pattern setup`);
        }
      }
    } catch (error) { documentErrors.push(`gstack documents: ${error.message}; rerun repo-pattern setup`); }
  } else documentErrors = ["gstack document checkout is unavailable; rerun repo-pattern setup"];
  return { checkout, statePath, checkoutValid, stateValid, wrappers, wrappersValid, assets, assetsValid, sidecars, sidecarsValid, documentsValid: documentErrors.length === 0, documentErrors, documentWarnings, ...runtime };
}
