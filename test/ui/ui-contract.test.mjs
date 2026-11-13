import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { DEFAULT_EFFORT_LEVEL, EFFORT_LEVELS, nextEffortIndex, renderEffortPicker } from "../../src/ui/prompt.mjs";
import { createProgressReporter, createSetupProgress } from "../../src/ui/progress.mjs";
import { doctorProject } from "../../src/doctor.mjs";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const cliPath = path.join(repoRoot, "bin/repo-pattern.mjs");

function runCli(args, env = process.env) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: repoRoot, env, encoding: "utf8" });
}

test("progress formatting preserves bounded reporter output", () => {
  // protects=progress percentages, detail retention, completion/failure emission, and empty setup progress; fails_when=progress lines, percentages, or terminal states change; no_claim=TTY animation or external command timing.
  const durable = [];
  const reporter = createProgressReporter({ write: (line) => durable.push(line) });
  const operation = reporter.beginOperation({ id: "clone", label: "Downloading gstack", totalUnits: 4, unitLabel: "files", weight: 2, detail: "Starting" });
  operation.update({ completedUnits: -2, detail: "Starting" });
  operation.update({ completedUnits: 2, detail: "Receiving objects" });
  operation.update({ completedUnits: 1, detail: "stale" });
  operation.complete({ detail: "completed" });
  assert.deepEqual(durable, [
    "Downloading gstack 0% · Starting",
    "Downloading gstack 25% · Receiving objects",
    "Downloading gstack 50% · Receiving objects",
    "Downloading gstack 100% · completed"
  ]);
  assert.equal(operation.percent, 100);

  const completeAfterUpdate = [];
  const completeAfterUpdateReporter = createProgressReporter({ write: (line) => completeAfterUpdate.push(line) });
  const completeAfterUpdateOperation = completeAfterUpdateReporter.beginOperation({ id: "copy", label: "Copying files", totalUnits: 1 });
  completeAfterUpdateOperation.update({ completedUnits: 1, detail: "1/1 files" });
  completeAfterUpdateOperation.complete({ detail: "completed" });
  assert.deepEqual(completeAfterUpdate, [
    "Copying files 0%",
    "Copying files 25% · 1/1 files",
    "Copying files 50% · 1/1 files",
    "Copying files 75% · 1/1 files",
    "Copying files 100% · completed"
  ]);

  const failed = [];
  const failureReporter = createProgressReporter({ write: (line) => failed.push(line) });
  const failedOperation = failureReporter.beginOperation({ id: "copy", label: "Copying skill", totalUnits: 4 });
  failedOperation.update({ completedUnits: 3, detail: "3/4 files" });
  failedOperation.fail({ detail: "failed" });
  assert.deepEqual(failed, ["Copying skill 0%", "Copying skill 25% · 3/4 files", "Copying skill 50% · 3/4 files", "Copying skill 75% · 3/4 files", "Copying skill 75% · failed"]);
  assert.equal(failedOperation.percent, 75);
  assert.equal(createSetupProgress([], { write: () => {} }), null);
});

test("effort picker preserves defaults, movement, and ANSI boundaries", () => {
  // protects=effort defaults, cursor bounds, unsupported actions, responsive labels, and color selection; fails_when=effort order, picker text, or ANSI behavior changes; no_claim=physical keyboard input or terminal rendering beyond formatter output.
  assert.equal(DEFAULT_EFFORT_LEVEL, "medium");
  assert.deepEqual(EFFORT_LEVELS, ["low", "medium", "high", "xhigh", "max", "ultracode"]);
  assert.equal(nextEffortIndex(0, "left"), 0);
  assert.equal(nextEffortIndex(EFFORT_LEVELS.length - 1, "right"), EFFORT_LEVELS.length - 1);
  assert.equal(nextEffortIndex(1, "unsupported"), 1);
  assert.equal(nextEffortIndex(1, "right"), 2);
  assert.equal(renderEffortPicker("medium", { columns: 20, color: false }), "Effort: [medium] recommended · ←/→ · Enter");
  assert.match(renderEffortPicker("medium", { columns: 120, color: false }), /\[medium\].*recommended/);
  assert.doesNotMatch(renderEffortPicker("medium", { columns: 20, color: false }), /\x1b\[/);
  assert.match(renderEffortPicker("medium", { columns: 20, color: true }), /\x1b\[/);
});

test("doctor output preserves deterministic summaries and silence", async () => {
  // protects=doctor failure summaries, verbose counts, silent output, CLI diagnostics, and quoted target paths; fails_when=doctor output or status changes, output leaks in silent mode, or fixtures persist; no_claim=successful doctor state or live tools.
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-output-native-"));
  try {
    const before = await fs.readdir(target);
    let output = [];
    const previousLog = console.log;
    console.log = (line = "") => output.push(String(line));
    try {
      await assert.rejects(() => doctorProject(target), /Doctor failed/);
      assert(output.join("\n").includes("Workspace"));
      assert(output.join("\n").includes("FAIL"));
      assert(output.join("\n").includes("Repair:"));
      assert(output.join("\n").includes("Information"));
      assert(!output.join("\n").includes("Warnings and information"));
      output = [];
      await assert.rejects(() => doctorProject(target, { verbose: true }), /Doctor failed/);
      const verboseText = output.join("\n");
      assert(verboseText.includes("Detailed checks"));
      assert.equal((verboseText.match(/✗ \.claude exists/g) || []).length, 2);
      const summaryCounts = [...verboseText.matchAll(/(?:Workspace|Settings & MCP|ECC|gstack)  (?:PASS|WARN|FAIL|N\/A) · (\d+) passed, (\d+) failed, (\d+) total/g)];
      assert.equal(summaryCounts.length, 4);
      assert.equal(summaryCounts.reduce((sum, [, , , total]) => sum + Number(total), 0), 19);
      output = [];
      await assert.rejects(() => doctorProject(target, { silent: true, verbose: true }), /Doctor failed/);
      assert.deepEqual(output, []);
      assert.deepEqual(await fs.readdir(target), before);
    } finally {
      console.log = previousLog;
    }

    const wrongCommand = runCli(["audit", "--verbose"]);
    assert.equal(wrongCommand.status, 2);
    const help = runCli(["help"]);
    assert.match(help.stdout, /doctor \[--target <path>\] \[--verbose\]/);
    const plain = runCli(["doctor", "--target", target], { ...process.env, CI: "1", NO_COLOR: "1", TERM: "dumb" });
    assert.notEqual(plain.status, 0);
    assert.doesNotMatch(plain.stdout, /\x1b\[/);
    const verbose = runCli(["doctor", "--target", target, "--verbose"]);
    assert.notEqual(verbose.status, 0);
    assert.match(verbose.stdout, /Detailed checks/);
    assert.match(verbose.stdout, /Repair:/);
    const quoted = await fs.mkdtemp(path.join(os.tmpdir(), "doctor space ' quote-native-"));
    try {
      const result = runCli(["doctor", "--target", quoted]);
      assert.notEqual(result.status, 0);
      assert(result.stdout.includes(quoted));
    } finally {
      await fs.rm(quoted, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});
