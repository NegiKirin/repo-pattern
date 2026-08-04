import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isTracked } from "./fs-utils.mjs";

const execFileAsync = promisify(execFile);

export const GRAPHIFY_GRAPH_PATH = "graphify-out/graph.json";
export const GRAPHIFY_MCP_COMMAND = "graphify-mcp";
export const GRAPHIFY_MCP_ARGS = [GRAPHIFY_GRAPH_PATH];
const GRAPHIFY_PACKAGE = "graphifyy[mcp]";

export function isCompatiblePythonVersion(output) {
  const match = String(output).match(/Python\s+(\d+)\.(\d+)/i);
  return Boolean(match) && (Number(match[1]) > 3 || (Number(match[1]) === 3 && Number(match[2]) >= 10));
}

export function assertGraphifyMcpDefinition(server) {
  if (server?.command !== GRAPHIFY_MCP_COMMAND) {
    throw new Error(`Graphify MCP command must be ${GRAPHIFY_MCP_COMMAND}.`);
  }
  if (JSON.stringify(server.args) !== JSON.stringify(GRAPHIFY_MCP_ARGS)) {
    throw new Error(`Graphify MCP arguments must be ${JSON.stringify(GRAPHIFY_MCP_ARGS)}.`);
  }
}

async function assertGraphifyOutputDirectory(target) {
  try {
    if ((await fs.lstat(path.join(target, "graphify-out"))).isSymbolicLink()) {
      throw new Error("graphify-out must not be a symlink.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function validateGraphFile(target) {
  await assertGraphifyOutputDirectory(target);
  const file = path.join(target, GRAPHIFY_GRAPH_PATH);
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Graphify graph does not exist: ${GRAPHIFY_GRAPH_PATH}. Run repo-pattern mcp --profile <profile>.`);
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Graphify graph must be a regular non-symlink file: ${GRAPHIFY_GRAPH_PATH}.`);
  }
  try {
    JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    throw new Error(`Graphify graph must contain valid JSON: ${GRAPHIFY_GRAPH_PATH}.`);
  }
}

async function defaultRunner(command, args, options = {}) {
  const stubDir = process.env.REPO_PATTERN_GRAPHIFY_STUB_DIR;
  const executable = stubDir ? path.join(stubDir, command) : command;
  return execFileAsync(executable, args, { ...options, encoding: "utf8" });
}

export async function assertCommand(command, { runner = defaultRunner } = {}) {
  try {
    await runner(command, ["--version"]);
  } catch {
    throw new Error(`${command} is required on PATH. Install it, then rerun repo-pattern mcp --profile <profile>.`);
  }
}

export async function prepareGraphify(target, { dryRun = false, runner = defaultRunner, silent = false } = {}) {
  await assertGraphifyOutputDirectory(target);
  if (isTracked(target, GRAPHIFY_GRAPH_PATH)) {
    throw new Error(`${GRAPHIFY_GRAPH_PATH} is tracked. Untrack it before regenerating Graphify.`);
  }
  const actions = [
    "verify uv and Python >=3.10",
    `uv tool install --upgrade ${GRAPHIFY_PACKAGE}`,
    "verify graphify and graphify-mcp",
    "graphify extract . --code-only"
  ];
  if (dryRun) {
    if (!silent) actions.forEach((action) => console.log(`[dry-run] Graphify: ${action}`));
    return { actions };
  }

  await assertCommand("uv", { runner });
  try {
    await runner("uv", ["python", "find", ">=3.10"], { cwd: target });
  } catch {
    throw new Error("A compatible Python runtime (>=3.10) is required. Install Python 3.10+ and rerun repo-pattern mcp --profile <profile>.");
  }
  try {
    await runner("uv", ["tool", "install", "--upgrade", GRAPHIFY_PACKAGE], { cwd: target });
  } catch {
    throw new Error("Graphify installation failed. Verify uv can install graphifyy[mcp], then rerun repo-pattern mcp --profile <profile>.");
  }
  await assertCommand("graphify", { runner });
  await assertCommand(GRAPHIFY_MCP_COMMAND, { runner });
  try {
    await runner("graphify", ["extract", ".", "--code-only"], { cwd: target });
  } catch {
    throw new Error("Graphify extraction failed. Fix the target workspace and rerun repo-pattern mcp --profile <profile>.");
  }
  await validateGraphFile(target);
  return { actions };
}
