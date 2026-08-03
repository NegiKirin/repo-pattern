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

  const calls = [];
  let spinnerCount = 0;
  const spinnerFactory = () => {
    spinnerCount += 1;
    return {
      start(message) { calls.push(`start ${message}`); },
      stop(message) { calls.push(`stop ${message}`); }
    };
  };
  const interactive = createSetupProgress([
    { id: "workspace", label: "Generating workspace", weight: 1 },
    { id: "ecc-cache", label: "Syncing ECC cache", weight: 1 },
    { id: "skills-backup", label: "Backing up local skills", weight: 1 },
    { id: "skill-git-document-specialist", label: "Syncing document-specialist", weight: 1 }
  ], { interactive: true, ansi: true, spinnerFactory });
  assert.equal(spinnerCount, 3);
  assert.deepEqual(calls, []);
  interactive.beginOperation({ id: "workspace", label: "Generating workspace", totalUnits: 1 }).complete();
  assert.deepEqual(calls, ["start Setup"]);
  interactive.beginOperation({ id: "ecc-cache", label: "Syncing ECC cache", totalUnits: 1 }).complete();
  assert.deepEqual(calls, ["start Setup", "start ECC & gstack", "stop ECC & gstack completed"]);
  interactive.beginOperation({ id: "skills-backup", label: "Backing up local skills", totalUnits: 1 }).complete();
  assert.deepEqual(calls, ["start Setup", "start ECC & gstack", "stop ECC & gstack completed", "start Extended skills"]);
  interactive.beginOperation({ id: "skill-git-document-specialist", label: "Syncing document-specialist", totalUnits: 1 }).complete();
  interactive.complete({ detail: "preview" });
  assert.deepEqual(calls.slice(-2), ["stop Extended skills completed", "stop Setup preview"]);
  assert(calls.includes("stop ECC & gstack completed"));
  assert.equal(calls.some((call) => /Generating workspace|Syncing ECC cache|Backing up local skills|%|\[/.test(call)), false);

  const skippedCalls = [];
  const skipped = createSetupProgress([{ id: "workspace", label: "Generating workspace", weight: 1 }], {
    interactive: true,
    ansi: true,
    spinnerFactory: () => ({ start(message) { skippedCalls.push(`start ${message}`); }, stop(message) { skippedCalls.push(`stop ${message}`); } })
  });
  assert.deepEqual(skippedCalls, [
    "start ECC & gstack",
    "stop ECC & gstack Skipped",
    "start Extended skills",
    "stop Extended skills Skipped"
  ]);
  skipped.beginOperation({ id: "workspace", label: "Generating workspace", totalUnits: 1 }).complete();
  skipped.complete();
  assert.deepEqual(skippedCalls.slice(-2), ["start Setup", "stop Setup completed"]);

  const failureCalls = [];
  const failure = createSetupProgress([{ id: "gstack-checkout", label: "Downloading gstack", weight: 1 }], {
    interactive: true,
    ansi: true,
    spinnerFactory: () => ({ start(message) { failureCalls.push(`start ${message}`); }, stop(message) { failureCalls.push(`stop ${message}`); } })
  });
  failure.beginOperation({ id: "gstack-checkout", label: "Downloading gstack", totalUnits: 1 }).fail();
  failure.flush();
  assert.deepEqual(failureCalls.slice(-2), ["stop ECC & gstack Downloading gstack failed", "stop Setup failed"]);
  assert.equal(failureCalls.filter((call) => call.startsWith("stop ")).length, 3);

  const activeGroupFailureCalls = [];
  const activeGroupFailure = createSetupProgress([{ id: "gstack-checkout", label: "Downloading gstack", weight: 1 }], {
    interactive: true,
    ansi: true,
    spinnerFactory: () => ({ start(message) { activeGroupFailureCalls.push(`start ${message}`); }, stop(message) { activeGroupFailureCalls.push(`stop ${message}`); } })
  });
  activeGroupFailure.beginOperation({ id: "gstack-checkout", label: "Downloading gstack", totalUnits: 1 });
  activeGroupFailure.fail();
  assert.deepEqual(activeGroupFailureCalls.slice(-2), ["stop ECC & gstack failed", "stop Setup failed"]);

  const pluginCalls = [];
  const plugin = createSetupProgress([{ id: "workspace", label: "Generating workspace", weight: 1 }], {
    interactive: true,
    ansi: true,
    hasExtendedSkills: true,
    spinnerFactory: () => ({ start(message) { pluginCalls.push(`start ${message}`); }, stop(message) { pluginCalls.push(`stop ${message}`); } })
  });
  plugin.beginGroup("skills");
  plugin.completeGroup("skills");
  plugin.beginOperation({ id: "workspace", label: "Generating workspace", totalUnits: 1 }).complete();
  plugin.complete();
  assert(pluginCalls.includes("stop Extended skills completed"));
  assert.equal(createSetupProgress([], { write: () => {} }), null);
}
