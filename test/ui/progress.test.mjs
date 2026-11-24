import assert from "node:assert/strict";
import { createProgressReporter, createSetupProgress } from "../../src/ui/progress.mjs";
import { test } from "node:test";

test("progress presentation preserves durable and setup progress contracts", async () => {
  // protects=progress percentages, operation ordering, completion, failure, and empty-plan behavior; fails_when=durable lines or terminal percentages change; no_claim=ANSI rendering or live terminal capability.
  await runProgressChecks();
});

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

  // IR-5: protects=progress and report callbacks each complete once when progress completes first; fails_when=completion ordering duplicates or hides the final report; no_claim=concurrent execution safety beyond this callback case.
  const progressFirst = [];
  const progressFirstEvents = [];
  const progressFirstReporter = createProgressReporter({ write: (line) => progressFirst.push(line) });
  const progressFirstOperation = progressFirstReporter.beginOperation({ id: "report", label: "Report", totalUnits: 1 });
  const onProgressComplete = (detail) => {
    const wasCompleted = progressFirstOperation.state.completed;
    progressFirstOperation.complete({ detail });
    if (!wasCompleted && progressFirstOperation.state.completed) progressFirstEvents.push("progress");
  };
  const onReportComplete = () => progressFirstEvents.push("report");
  onProgressComplete("completed");
  onReportComplete();
  onProgressComplete("stale");
  assert.deepEqual(progressFirstEvents, ["progress", "report"]);
  assert.deepEqual(progressFirst, ["Report 0%", "Report 100% · completed"]);
  assert.equal(progressFirstOperation.state.detail, "completed");
  assert.equal(progressFirstOperation.state.completed, true);

  // IR-6: protects=report authority when report completes first and stale progress cannot overwrite final status; fails_when=stale progress overwrites final status or duplicates completion; no_claim=renderer bytes.
  const reportFirst = [];
  const reportFirstEvents = [];
  const reportFirstReporter = createProgressReporter({ write: (line) => reportFirst.push(line) });
  const reportFirstOperation = reportFirstReporter.beginOperation({ id: "report", label: "Report", totalUnits: 1 });
  const onAuthoritativeReport = (detail) => {
    const wasCompleted = reportFirstOperation.state.completed;
    reportFirstOperation.complete({ detail });
    if (!wasCompleted && reportFirstOperation.state.completed) reportFirstEvents.push("report");
  };
  const onStaleProgress = (detail) => {
    reportFirstEvents.push("progress");
    reportFirstOperation.update({ completedUnits: 0, detail });
  };
  onAuthoritativeReport("authoritative");
  onStaleProgress("stale progress");
  assert.deepEqual(reportFirstEvents, ["report", "progress"]);
  assert.deepEqual(reportFirst, ["Report 0%", "Report 100% · authoritative"]);
  assert.equal(reportFirstOperation.state.detail, "authoritative");
  assert.equal(reportFirstOperation.state.completed, true);
}
