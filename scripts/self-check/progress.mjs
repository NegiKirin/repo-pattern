import assert from "node:assert/strict";
import { createProgressReporter, createSetupProgress } from "../lib/progress.mjs";

export async function runProgressChecks() {
  const durable = [];
  const reporter = createProgressReporter({ interactive: false, ansi: false, write: (line) => durable.push(line) });
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
  const completeAfterUpdateReporter = createProgressReporter({ interactive: false, ansi: false, write: (line) => completeAfterUpdate.push(line) });
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
  const failureReporter = createProgressReporter({ interactive: false, ansi: false, write: (line) => failed.push(line) });
  const failedOperation = failureReporter.beginOperation({ id: "copy", label: "Copying skill", totalUnits: 4 });
  failedOperation.update({ completedUnits: 3, detail: "3/4 files" });
  failedOperation.fail({ detail: "failed" });
  assert.deepEqual(failed, ["Copying skill 0%", "Copying skill 25% · 3/4 files", "Copying skill 50% · 3/4 files", "Copying skill 75% · 3/4 files", "Copying skill 75% · failed"]);
  assert.equal(failedOperation.percent, 75);

  const interactive = [];
  const interactiveReporter = createProgressReporter({ interactive: true, ansi: true, write: (line) => interactive.push(line) });
  const interactiveOperation = interactiveReporter.beginOperation({ id: "write", label: "Generating workspace", totalUnits: 2 });
  interactiveOperation.update({ completedUnits: 1, detail: "1/2 files" });
  interactiveOperation.complete({ detail: "completed" });
  assert.match(interactive.join(""), /Generating workspace \[[█░]+\] 0%/);
  assert.match(interactive.at(-1), /Generating workspace \[[█░]+\] 100% · completed/);
  assert(interactive.some((frame) => frame.includes("\x1b[2K\r")));

  const ordered = [];
  const orderedSetup = createSetupProgress([
    { id: "first", label: "First operation", weight: 1 },
    { id: "second", label: "Second operation", weight: 1 }
  ], { interactive: true, ansi: true, write: (frame) => ordered.push(frame) });
  const initialRows = ordered[0].split("\n").filter(Boolean).map((row) => row.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, ""));
  assert.deepEqual(initialRows, [
    "First operation [░░░░░░░░░░░░░░░░░░░░] 0%",
    "Second operation [░░░░░░░░░░░░░░░░░░░░] 0%",
    "Setup [░░░░░░░░░░░░░░░░░░░░] 0% · preparing resources"
  ]);
  const second = orderedSetup.beginOperation({ id: "second", label: "Second operation", totalUnits: 1 });
  second.complete({ detail: "completed" });
  const first = orderedSetup.beginOperation({ id: "first", label: "First operation", totalUnits: 2 });
  first.update({ completedUnits: 1, detail: "working" });
  orderedSetup.flush();
  const latestOrdered = ordered.at(-2);
  assert(latestOrdered.indexOf("First operation") < latestOrdered.indexOf("Second operation"));
  assert(latestOrdered.indexOf("Second operation") < latestOrdered.indexOf("Setup"));
  assert.match(latestOrdered, /Second operation \[[█░]+\] 100% · completed/);
  assert.match(latestOrdered, /First operation \[[█░]+\] 50% · working/);
  assert.match(latestOrdered, /\x1b\[3A\x1b\[0G/);
  assert.equal((latestOrdered.match(/\x1b\[2K\r/g) || []).length, 3);
  const framesBeforeCleanFlush = ordered.length;
  orderedSetup.flush();
  assert.equal(ordered.length, framesBeforeCleanFlush);
  assert.equal(ordered.at(-1), "\x1b[3A\x1b[0G\x1b[2K\r\n\x1b[2K\r\n\x1b[2K\r");

  const failedRows = [];
  const failedSetup = createSetupProgress([
    { id: "failure", label: "Failure operation", weight: 1 },
    { id: "skipped", label: "Skipped operation", weight: 1 }
  ], { interactive: true, ansi: true, write: (frame) => failedRows.push(frame) });
  const failure = failedSetup.beginOperation({ id: "failure", label: "Failure operation", totalUnits: 4 });
  failure.update({ completedUnits: 2, detail: "halfway" });
  failure.fail();
  failedSetup.skipOperation("skipped");
  const failedFrame = failedRows.at(-1);
  assert.match(failedFrame, /Failure operation \[[█░]+\] 50% · failed/);
  assert.match(failedFrame, /Skipped operation \[[█░]+\] 100% · skipped/);
  assert.equal((failedFrame.match(/Skipped operation/g) || []).length, 1);
  assert.match(failedFrame, /Setup \[[█░]+\] 25% · failed/);

  const interleaved = [];
  const interleavedReporter = createProgressReporter({ interactive: true, ansi: true, write: (line) => interleaved.push(line) });
  const interleavedOperation = interleavedReporter.beginOperation({ id: "copy", label: "Copying files", totalUnits: 2 });
  interleavedOperation.update({ completedUnits: 1, detail: "1/2 files" });
  interleavedReporter.flush();
  interleaved.push("ordinary output\n");
  interleavedOperation.complete({ detail: "completed" });
  assert.equal(interleaved[3], "ordinary output\n");
  assert.equal(interleaved[2], "\x1b[1A\x1b[0G\x1b[2K\r");
  assert.match(interleaved[1], /Copying files \[[█░]+\] 50% · 1\/2 files/);
  assert.match(interleaved.at(-1), /Copying files \[[█░]+\] 100% · completed/);

  const stdinOnlyTty = [];
  const stdinOnlyReporter = createProgressReporter({ interactive: false, ansi: true, write: (line) => stdinOnlyTty.push(line) });
  stdinOnlyReporter.beginOperation({ id: "stdin-only", label: "Redirected output", totalUnits: 1 }).complete();
  assert.equal(stdinOnlyTty.some((frame) => frame.includes("\x1b[")), false);

  const stdoutOnlyTty = [];
  const stdoutOnlyReporter = createProgressReporter({ interactive: true, ansi: false, write: (line) => stdoutOnlyTty.push(line) });
  stdoutOnlyReporter.beginOperation({ id: "stdout-only", label: "Redirected input", totalUnits: 1 }).complete();
  assert.equal(stdoutOnlyTty.some((frame) => frame.includes("\x1b[")), false);

  const throttled = [];
  const throttledReporter = createProgressReporter({ interactive: true, ansi: true, write: (frame) => throttled.push(frame) });
  const throttledOperation = throttledReporter.beginOperation({ id: "throttle", label: "Throttled operation", totalUnits: 10 });
  for (let completedUnits = 1; completedUnits <= 9; completedUnits++) throttledOperation.update({ completedUnits });
  assert(throttled.length < 10);
  throttledOperation.complete({ detail: "completed" });
  assert.match(throttled.at(-1), /Throttled operation \[[█░]+\] 100% · completed/);
  throttledOperation.update({ completedUnits: 1, detail: "late" });
  assert.match(throttled.at(-1), /Throttled operation \[[█░]+\] 100% · completed/);

  const setupLines = [];
  const setup = createSetupProgress([
    { id: "workspace", label: "Generating workspace", weight: 1 },
    { id: "gstack", label: "gstack", weight: 3 }
  ], { interactive: false, ansi: false, write: (line) => setupLines.push(line) });
  assert(setup);
  const workspace = setup.beginOperation({ id: "workspace", label: "Generating workspace", totalUnits: 1 });
  const gstack = setup.beginOperation({ id: "gstack", label: "Downloading gstack", totalUnits: 4 });
  workspace.complete({ detail: "completed" });
  gstack.update({ completedUnits: 4, detail: "Receiving objects" });
  assert.equal(setupLines.some((line) => line.startsWith("Setup 100%")), false);
  gstack.complete({ detail: "completed" });
  assert(setupLines.some((line) => line.startsWith("Setup 25% · Generating workspace")));
  assert(setupLines.some((line) => line.startsWith("Setup 50% · Downloading gstack")));
  setup.complete({ detail: "completed" });
  assert.equal(setupLines.at(-1), "Setup 100% · completed");
  assert.equal(setupLines.filter((line) => line === "Setup 100% · completed").length, 1);
  assert.equal(setupLines.some((line) => line.startsWith("Setup 100% · completed")), true);
  setup.complete({ detail: "completed" });

  const lateFailureLines = [];
  const lateFailure = createSetupProgress([
    { id: "workspace", label: "Generating workspace", weight: 1 }
  ], { interactive: false, ansi: false, write: (line) => lateFailureLines.push(line) });
  lateFailure.beginOperation({ id: "workspace", label: "Generating workspace", totalUnits: 1 }).complete();
  lateFailure.complete();
  lateFailure.fail({ detail: "doctor failed" });
  assert.equal(lateFailureLines.at(-1), "Setup 100% · doctor failed");

  const interactiveSetupLines = [];
  const interactiveSetup = createSetupProgress([
    { id: "workspace", label: "Generating workspace", weight: 1 },
    { id: "gstack", label: "Downloading gstack", weight: 1 }
  ], { interactive: true, ansi: true, write: (line) => interactiveSetupLines.push(line) });
  interactiveSetup.beginOperation({ id: "workspace", label: "Generating workspace", totalUnits: 1 }).complete();
  assert.match(interactiveSetupLines.at(-1), /Setup \[[█░]+\] 50% · Generating workspace\n$/);
  interactiveSetup.beginOperation({ id: "gstack", label: "Downloading gstack", totalUnits: 1 }).complete();
  interactiveSetup.complete();
  assert.match(interactiveSetupLines.at(-1), /Setup \[[█░]+\] 100% · completed\n$/);
  setup.fail({ detail: "failed" });
  assert.equal(setupLines.filter((line) => line === "Setup 100% · completed").length, 1);
  assert.equal(setupLines.filter((line) => line === "Setup 100% · failed").length, 1);
  const unstartedLines = [];
  const unstarted = createSetupProgress([
    { id: "workspace", label: "Generating workspace", weight: 1 },
    { id: "optional-backup", label: "Backing up optional files", weight: 1 }
  ], { interactive: false, ansi: false, write: (line) => unstartedLines.push(line) });
  unstarted.beginOperation({ id: "workspace", label: "Generating workspace", totalUnits: 1 }).complete();
  unstarted.skipOperation("optional-backup");
  unstarted.complete({ detail: "completed" });
  assert.equal(unstartedLines.at(-1), "Setup 100% · completed");
  assert.equal(unstartedLines.filter((line) => line === "Setup 100% · completed").length, 1);
  assert.equal(createSetupProgress([], { write: () => {} }), null);
}
