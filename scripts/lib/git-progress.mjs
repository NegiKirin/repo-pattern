import { spawn } from "node:child_process";

const PHASES = [[/remote:|enumerating objects/i, "Starting", 5], [/connecting/i, "Connecting", 10], [/receiving objects/i, "Receiving objects", 70], [/resolving deltas/i, "Resolving deltas", 90], [/updating files|checking connectivity/i, "Finalizing", 95]];

export function parseGitProgress(text = "") {
  const match = String(text).match(/(Receiving objects|Resolving deltas|Updating files|Compressing objects):\s*(\d+)%/i);
  if (match) return { detail: match[1], percent: Math.max(0, Math.min(99, Number(match[2]))) };
  const phase = PHASES.find(([pattern]) => pattern.test(text));
  return phase ? { detail: phase[1], percent: phase[2] } : null;
}

export async function runGitWithProgress(args, { cwd, onProgress = () => {}, spawnCommand = spawn } = {}) {
  onProgress({ detail: "Starting", percent: 0 });
  return await new Promise((resolve, reject) => {
    const child = spawnCommand("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let buffer = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      buffer += text;
      const lines = buffer.split(/[\r\n]/);
      buffer = lines.pop();
      for (const line of lines) {
        const progress = parseGitProgress(line);
        if (progress) onProgress(progress);
      }
    });
    child.once("error", reject);
    child.once("close", (status) => {
      const progress = parseGitProgress(buffer);
      if (progress) onProgress(progress);
      if (status === 0) return resolve({ stdout, stderr, status });
      const error = new Error(`git ${args[0]} failed with exit code ${status}`);
      error.stdout = stdout;
      error.stderr = stderr;
      error.status = status;
      reject(error);
    });
  });
}
