import assert from "node:assert/strict";
import { createProgressReporter, createSetupProgress } from "../lib/progress.mjs";

export async function runProgressChecks() {
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
}
