import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isTracked } from "./fs-utils.mjs";

const execFileAsync = promisify(execFile);

export const GRAPHIFY_OUTPUT_DIR = "graphify-out";
export const GRAPHIFY_GRAPH_PATH = `${GRAPHIFY_OUTPUT_DIR}/graph.json`;
export const GRAPHIFY_VENV_PATH = `${GRAPHIFY_OUTPUT_DIR}/.venv`;
export const GRAPHIFY_LAUNCHER_PATH = `${GRAPHIFY_OUTPUT_DIR}/graphify-mcp.py`;
export const GRAPHIFY_MCP_COMMAND = "python3";
export const GRAPHIFY_MCP_ARGS = [GRAPHIFY_LAUNCHER_PATH, GRAPHIFY_GRAPH_PATH];
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

function graphifyBin(target, name) {
  const isWindows = process.platform === "win32";
  return path.join(target, GRAPHIFY_VENV_PATH, isWindows ? "Scripts" : "bin", `${name}${isWindows ? ".exe" : ""}`);
}

async function assertRegularFile(target, relativePath, label) {
  try {
    const stat = await fs.lstat(path.join(target, relativePath));
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular non-symlink file: ${relativePath}.`);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${label} does not exist: ${relativePath}. Run repo-pattern mcp --profile <profile>.`);
    throw error;
  }
}

async function assertGraphifyOutputDirectory(target) {
  try {
    if ((await fs.lstat(path.join(target, GRAPHIFY_OUTPUT_DIR))).isSymbolicLink()) {
      throw new Error("graphify-out must not be a symlink.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function validateGraphFile(target) {
  await assertGraphifyOutputDirectory(target);
  await assertRegularFile(target, GRAPHIFY_GRAPH_PATH, "Graphify graph");
  try {
    JSON.parse(await fs.readFile(path.join(target, GRAPHIFY_GRAPH_PATH), "utf8"));
  } catch {
    throw new Error(`Graphify graph must contain valid JSON: ${GRAPHIFY_GRAPH_PATH}.`);
  }
}

async function defaultRunner(command, args, options = {}) {
  const stubDir = process.env.REPO_PATTERN_GRAPHIFY_STUB_DIR;
  const executable = stubDir ? path.join(stubDir, path.basename(command)) : command;
  return execFileAsync(executable, args, { ...options, encoding: "utf8" });
}

export async function assertCommand(command, args = ["--help"], { runner = defaultRunner, options = {} } = {}) {
  try {
    return await runner(command, args, options);
  } catch {
    throw new Error(`${command} is required. Install it, then rerun repo-pattern mcp --profile <profile>.`);
  }
}

async function writeGraphifyLauncher(target) {
  const file = path.join(target, GRAPHIFY_LAUNCHER_PATH);
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Graphify launcher must be a regular non-symlink file: ${GRAPHIFY_LAUNCHER_PATH}.`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const source = `from pathlib import Path\nimport os\nimport sys\n\nroot = Path(__file__).resolve().parent\nname = "graphify-mcp.exe" if os.name == "nt" else "graphify-mcp"\ncommand = root / ".venv" / ("Scripts" if os.name == "nt" else "bin") / name\nos.execv(str(command), [str(command), *sys.argv[1:]])\n`;
  await fs.writeFile(file, source, { mode: 0o755 });
}

export async function assertGraphifyLauncher(target, { runner = defaultRunner } = {}) {
  await assertRegularFile(target, GRAPHIFY_LAUNCHER_PATH, "Graphify launcher");
  try {
    await runner("python3", [GRAPHIFY_LAUNCHER_PATH, "--help"], { cwd: target });
  } catch {
    throw new Error(`Graphify launcher is required: ${GRAPHIFY_LAUNCHER_PATH}. Run repo-pattern mcp --profile <profile>.`);
  }
}

export async function prepareGraphify(target, { dryRun = false, runner = defaultRunner, silent = false } = {}) {
  await assertGraphifyOutputDirectory(target);
  if (isTracked(target, GRAPHIFY_GRAPH_PATH)) {
    throw new Error(`${GRAPHIFY_GRAPH_PATH} is tracked. Untrack it before regenerating Graphify.`);
  }
  const actions = [
    "verify python3 >=3.10",
    `create ${GRAPHIFY_VENV_PATH}`,
    `install ${GRAPHIFY_PACKAGE}`,
    "generate Graphify code graph"
  ];
  if (dryRun) {
    if (!silent) actions.forEach((action) => console.log(`[dry-run] Graphify: ${action}`));
    return { actions };
  }

  const python = await assertCommand("python3", ["--version"], { runner });
  if (!isCompatiblePythonVersion(python.stdout)) {
    throw new Error("Python 3.10+ is required. Install python3 3.10+ and rerun repo-pattern mcp --profile <profile>.");
  }
  try {
    await runner("python3", ["-m", "venv", GRAPHIFY_VENV_PATH], { cwd: target });
    await runner(graphifyBin(target, "python"), ["-m", "pip", "install", "--upgrade", GRAPHIFY_PACKAGE], { cwd: target });
  } catch {
    throw new Error("Graphify installation failed. Verify python3 can create virtual environments, then rerun repo-pattern mcp --profile <profile>.");
  }
  await assertCommand(graphifyBin(target, "graphify"), ["--help"], { runner });
  await assertCommand(graphifyBin(target, "graphify-mcp"), ["--help"], { runner });
  try {
    await runner(graphifyBin(target, "graphify"), ["extract", ".", "--code-only"], { cwd: target });
  } catch {
    throw new Error("Graphify extraction failed. Fix the target workspace and rerun repo-pattern mcp --profile <profile>.");
  }
  await validateGraphFile(target);
  await writeGraphifyLauncher(target);
  return { actions };
}
