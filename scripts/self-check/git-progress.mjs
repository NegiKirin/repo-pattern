import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { parseGitProgress, runGitWithProgress } from "../lib/git-progress.mjs";

function fakeChild({ stdout = [], stderr = [], status = 0, error = null }) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    for (const chunk of stdout) child.stdout.emit("data", chunk);
    for (const chunk of stderr) child.stderr.emit("data", chunk);
    if (error) child.emit("error", error);
    else child.emit("close", status);
  });
  return child;
}

export async function runGitProgressChecks() {
  assert.deepEqual(parseGitProgress("Receiving objects: 42% (1/2)"), { detail: "Receiving objects", percent: 42 });
  assert.deepEqual(parseGitProgress("Resolving deltas: 100% (2/2)"), { detail: "Resolving deltas", percent: 99 });
  assert.deepEqual(parseGitProgress("remote: Enumerating objects"), { detail: "Starting", percent: 5 });
  assert.equal(parseGitProgress("unrelated output"), null);

  const progress = [];
  const result = await runGitWithProgress(["clone", "--progress", "origin", "target"], {
    cwd: "/fixture",
    onProgress: (event) => progress.push(event),
    spawnCommand(command, args, options) {
      assert.equal(command, "git");
      assert.deepEqual(args, ["clone", "--progress", "origin", "target"]);
      assert.deepEqual(options, { cwd: "/fixture", stdio: ["ignore", "pipe", "pipe"] });
      return fakeChild({
        stdout: ["stdout"],
        stderr: ["Receiving objects: 4", "2%\rResolving deltas: 100%\r"]
      });
    }
  });
  assert.deepEqual(result, {
    stdout: "stdout",
    stderr: "Receiving objects: 42%\rResolving deltas: 100%\r",
    status: 0
  });
  assert.deepEqual(progress, [
    { detail: "Starting", percent: 0 },
    { detail: "Receiving objects", percent: 42 },
    { detail: "Resolving deltas", percent: 99 }
  ]);

  await assert.rejects(() => runGitWithProgress(["fetch"], {
    spawnCommand: () => fakeChild({ stdout: ["out"], stderr: ["fatal: failed\n"], status: 128 })
  }), (error) => error.status === 128 && error.stdout === "out" && error.stderr === "fatal: failed\n");
}
