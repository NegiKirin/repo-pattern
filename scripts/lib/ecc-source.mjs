import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { exists, ensureDir } from "./fs-utils.mjs";
import { inspectRegularTree } from "./ecc-agent-manifest.mjs";
import { isInteractive, withSpinner } from "./prompt.mjs";

export const ECC_REPO_URL = "https://github.com/affaan-m/ECC.git";
const REVISION_RE = /^[a-f0-9]{40}$/;
const execFileAsync = promisify(execFile);

function runGit(args, cwd, { quiet = false } = {}) {
  execFileSync("git", args, { cwd, stdio: quiet ? "ignore" : "inherit" });
}

async function runGitAsync(args, cwd) {
  await execFileAsync("git", args, { cwd });
}

function gitOutput(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function hasGitUpstream(cwd) {
  try {
    gitOutput(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd);
    return true;
  } catch {
    return false;
  }
}

function errorText(error) {
  return [error?.stderr, error?.stdout, error?.message].filter(Boolean).join("\n").trim();
}

export function formatEccCloneError(error) {
  const detail = errorText(error) || "git clone failed";
  return `Could not sync ECC rules from ${ECC_REPO_URL}. GitHub HTTPS access on github.com:443 may be blocked by your proxy, firewall, or VPN. Check with: git ls-remote ${ECC_REPO_URL}\nOriginal error: ${detail}`;
}

export async function ensureEccCache(target, { dryRun = false } = {}) {
  const cacheRoot = path.join(target, ".repo-pattern", "cache");
  const eccCache = path.join(cacheRoot, "ECC");
  if (exists(path.join(eccCache, "rules")) || exists(path.join(eccCache, "agents"))) {
    if (!dryRun && exists(path.join(eccCache, ".git")) && hasGitUpstream(eccCache)) {
      try {
        runGit(["pull", "--ff-only", "--quiet"], eccCache);
      } catch {
        console.warn("WARN: ECC cache exists but git pull failed. Using existing cache.");
      }
    }
    return eccCache;
  }
  if (dryRun) {
    console.log(`[dry-run] git clone --depth 1 ${ECC_REPO_URL} ${eccCache}`);
    return eccCache;
  }
  await ensureDir(cacheRoot);
  try {
    if (isInteractive()) {
      await withSpinner("Syncing ECC rules and agents", async () => {
        await runGitAsync(["clone", "--depth", "1", "--quiet", ECC_REPO_URL, eccCache], target);
      });
    } else {
      console.log(`Syncing ECC rules and agents from ${ECC_REPO_URL}`);
      runGit(["clone", "--depth", "1", ECC_REPO_URL, eccCache], target);
    }
  } catch (error) {
    throw new Error(formatEccCloneError(error));
  }
  return eccCache;
}

export async function validateEccAgentSource(eccCache) {
  const gitDir = path.join(eccCache, ".git");
  if (!exists(gitDir)) throw new Error("ECC cache is not a Git repository.");
  let revision;
  let source;
  try {
    revision = gitOutput(["rev-parse", "--verify", "HEAD^{commit}"], eccCache);
    source = gitOutput(["remote", "get-url", "origin"], eccCache);
  } catch {
    throw new Error("ECC cache must have an origin remote and a HEAD resolved to a commit.");
  }
  if (source !== ECC_REPO_URL) throw new Error(`ECC cache origin must be ${ECC_REPO_URL}.`);
  if (!REVISION_RE.test(revision)) throw new Error("ECC cache HEAD is not a full Git commit revision.");
  const agentsRoot = path.join(eccCache, "agents");
  await inspectRegularTree(agentsRoot, { requireNonEmpty: true });
  return { agentsRoot, revision };
}

export function assertEccSourceMatchesHead(eccCache) {
  if (gitOutput(["status", "--porcelain", "--untracked-files=all", "--", "rules", "agents"], eccCache)) {
    throw new Error("ECC cache rules and agents must match Git HEAD.");
  }
}
