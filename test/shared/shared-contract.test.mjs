import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseGitProgress, runGitWithProgress } from "../../src/shared/git-progress.mjs";
import { backupPaths, copyRecursiveWithProgress, scanCopyTree } from "../../src/shared/fs-utils.mjs";

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

test("Git progress parsing and subprocess capture preserve deterministic contracts", async () => {
  // protects=Git progress parsing, bounded percent behavior, subprocess arguments, stream capture, and failure propagation; fails_when=progress events, captured streams, status, or errors change; no_claim=real Git, network, or terminal progress.
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
      return fakeChild({ stdout: ["stdout"], stderr: ["Receiving objects: 4", "2%\rResolving deltas: 100%\r"] });
    }
  });
  assert.deepEqual(result, { stdout: "stdout", stderr: "Receiving objects: 42%\rResolving deltas: 100%\r", status: 0 });
  assert.deepEqual(progress, [
    { detail: "Starting", percent: 0 },
    { detail: "Receiving objects", percent: 42 },
    { detail: "Resolving deltas", percent: 99 }
  ]);

  await assert.rejects(() => runGitWithProgress(["fetch"], {
    spawnCommand: () => fakeChild({ stdout: ["out"], stderr: ["fatal: failed\n"], status: 128 })
  }), (error) => error.status === 128 && error.stdout === "out" && error.stderr === "fatal: failed\n");
});

test("filesystem copy and backup helpers preserve files, modes, symlink safety, and dry-run behavior", async () => {
  // protects=filesystem tree accounting, copy progress, file modes, symlink rejection, backup dry-run, concurrent backups, and missing-source skips; fails_when=counts, modes, safety boundaries, backup creation, or skip signaling change; no_claim=full provisioning transactions or platform-specific filesystem behavior.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-shared-native-"));
  try {
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    await fs.mkdir(path.join(source, "nested"), { recursive: true });
    await fs.writeFile(path.join(source, "one.txt"), "one", { mode: 0o640 });
    await fs.writeFile(path.join(source, "nested", "zero.txt"), "");
    const tree = await scanCopyTree(source);
    assert.deepEqual({ files: tree.files, bytes: tree.bytes }, { files: 2, bytes: 3 });
    const events = [];
    assert.deepEqual(await copyRecursiveWithProgress(source, destination, { onProgress: (event) => events.push(event) }), { files: 2, bytes: 3 });
    assert.deepEqual(events.at(0), { completedFiles: 0, totalFiles: 2, completedBytes: 0, totalBytes: 3 });
    assert.deepEqual(events.at(-1), { completedFiles: 2, totalFiles: 2, completedBytes: 3, totalBytes: 3 });
    assert.equal((await fs.stat(path.join(destination, "one.txt"))).mode & 0o777, 0o640);

    const outside = path.join(root, "outside.txt");
    const symlinkDestination = path.join(root, "symlink-destination");
    await fs.mkdir(symlinkDestination);
    await fs.writeFile(outside, "unchanged");
    await fs.symlink(outside, path.join(symlinkDestination, "one.txt"));
    await assert.rejects(() => copyRecursiveWithProgress(source, symlinkDestination), /copy destination must not be a symlink/);
    assert.equal(await fs.readFile(outside, "utf8"), "unchanged");

    const backupEvents = [];
    const progress = { beginOperation(spec) {
      backupEvents.push({ type: "begin", ...spec });
      return {
        update: (values) => backupEvents.push({ type: "update", ...values }),
        complete: (values) => backupEvents.push({ type: "complete", ...values }),
        fail: (values) => backupEvents.push({ type: "fail", ...values })
      };
    } };
    const previewEntries = await fs.readdir(root);
    const preview = await backupPaths(root, ["source"], { dryRun: true, silent: true });
    assert.equal(preview, null);
    assert.deepEqual(await fs.readdir(root), previewEntries);
    await assert.rejects(fs.access(path.join(root, ".repo-pattern")), { code: "ENOENT" });
    assert.equal(await fs.readFile(path.join(source, "one.txt"), "utf8"), "one");
    await backupPaths(root, ["source"], { progress, progressId: "fixture-backup" });
    assert.equal(backupEvents[0].id, "fixture-backup");
    assert.equal(backupEvents.at(-1).type, "complete");
    await fs.symlink("one.txt", path.join(source, "dependency-link"));
    const [firstBackup, secondBackup] = await Promise.all([
      backupPaths(root, ["source"], { silent: true }),
      backupPaths(root, ["source"], { silent: true })
    ]);
    assert.notEqual(firstBackup, secondBackup);
    for (const backup of [firstBackup, secondBackup]) assert.equal(await fs.readlink(path.join(backup, "source", "dependency-link")), "one.txt");
    let skipped = false;
    await backupPaths(root, ["missing"], { progress: { skipOperation: () => { skipped = true; } } });
    assert.equal(skipped, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
