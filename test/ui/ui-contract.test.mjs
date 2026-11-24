import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_EFFORT_LEVEL, EFFORT_LEVELS, nextEffortIndex, renderEffortPicker } from "../../src/ui/prompt.mjs";
import { createProgressReporter, createSetupProgress } from "../../src/ui/progress.mjs";
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
