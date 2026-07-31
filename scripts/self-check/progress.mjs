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
  assert.match(interactive.join("\n"), /Generating workspace \[[█░]+\] 50% · 1\/2 files/);
  assert.match(interactive.at(-1), /Generating workspace \[[█░]+\] 100% · completed/);
  assert(interactive.some((line) => line.includes("\x1b[2K\r")));
  const interleaved = [];
  const interleavedReporter = createProgressReporter({ interactive: true, ansi: true, write: (line) => interleaved.push(line) });
  const interleavedOperation = interleavedReporter.beginOperation({ id: "copy", label: "Copying files", totalUnits: 2 });
  interleavedOperation.update({ completedUnits: 1, detail: "1/2 files" });
  interleavedReporter.flush();
  interleaved.push("ordinary output\n");
  interleavedOperation.complete({ detail: "completed" });
  assert.equal(interleaved[3], "ordinary output\n");
  assert.match(interleaved[2], /\x1b\[2K\r\n$/);

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
  assert.equal(setupLines.at(-1), "Setup 100% · completed");
  assert.equal(setupLines.filter((line) => line === "Setup 100% · completed").length, 1);
  assert.equal(setupLines.some((line) => line.startsWith("Setup 100% · completed")), true);
  setup.complete({ detail: "completed" });

  const interactiveSetupLines = [];
  const interactiveSetup = createSetupProgress([
    { id: "workspace", label: "Generating workspace", weight: 1 },
    { id: "gstack", label: "Downloading gstack", weight: 1 }
  ], { interactive: true, ansi: true, write: (line) => interactiveSetupLines.push(line) });
  interactiveSetup.beginOperation({ id: "workspace", label: "Generating workspace", totalUnits: 1 }).complete();
  assert.match(interactiveSetupLines.at(-1), /Setup \[[█░]+\] 50% · Generating workspace\n$/);
  interactiveSetup.beginOperation({ id: "gstack", label: "Downloading gstack", totalUnits: 1 }).complete();
  assert.match(interactiveSetupLines.at(-1), /Setup \[[█░]+\] 100% · completed\n$/);
  setup.fail({ detail: "failed" });
  assert.equal(setupLines.filter((line) => line === "Setup 100% · completed").length, 1);
  assert.equal(setupLines.filter((line) => line === "Setup 100% · failed").length, 0);
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
