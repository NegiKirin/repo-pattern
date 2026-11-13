import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SHA256_RE = /^[a-f0-9]{64}$/;
const REVISION_RE = /^[a-f0-9]{40}$/;

function posixRelative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function compareAgentPaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function inspectRegularTree(root, { requireNonEmpty = false, label = "ECC agents source" } = {}) {
  let rootStat;
  try {
    rootStat = await fs.lstat(root);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${label} not found: ${root}`);
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`${label} must be a directory: ${root}`);
  const files = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const current = path.join(directory, entry.name);
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`${label} must not contain symlinks: ${posixRelative(root, current)}`);
      if (stat.isDirectory()) await visit(current);
      else if (stat.isFile()) files.push(current);
      else throw new Error(`${label} contains unsupported entry: ${posixRelative(root, current)}`);
    }
  }
  await visit(root);
  if (requireNonEmpty && files.length === 0) throw new Error(`${label} is empty.`);
  return files.sort((left, right) => compareAgentPaths(posixRelative(root, left), posixRelative(root, right)));
}

async function sha256(file) {
  const content = await fs.readFile(file);
  return createHash("sha256").update(content).digest("hex");
}

export function validateAgentManifest(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0) return false;
  let previous = null;
  for (const entry of manifest) {
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string" || typeof entry.sha256 !== "string") return false;
    if (!entry.path || entry.path.startsWith("/") || entry.path.includes("\\") || entry.path.split("/").some((part) => !part || part === "." || part === "..") || !SHA256_RE.test(entry.sha256)) return false;
    if (previous !== null && compareAgentPaths(previous, entry.path) >= 0) return false;
    previous = entry.path;
  }
  return true;
}

export async function buildAgentManifest(root) {
  const files = await inspectRegularTree(root, { requireNonEmpty: true });
  return await Promise.all(files.map(async (file) => ({ path: posixRelative(root, file), sha256: await sha256(file) })));
}

export async function verifyAgentInventory(root, manifest) {
  if (!validateAgentManifest(manifest)) return false;
  try {
    return JSON.stringify(await buildAgentManifest(root)) === JSON.stringify(manifest);
  } catch {
    return false;
  }
}

export function isValidEccAgentProvenance(ecc, eccRepoUrl) {
  return ecc?.agentsSyncedBy === "repo-pattern-auto-cache" &&
    ecc?.agentsSource === eccRepoUrl &&
    REVISION_RE.test(ecc?.agentsRevision || "") &&
    validateAgentManifest(ecc?.appliedAgents);
}

export { inspectRegularTree };
