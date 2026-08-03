import { spinner } from "@clack/prompts";

const MILESTONES = [0, 25, 50, 75, 100];
const GROUPS = [
  { id: "components", label: "ECC & gstack" },
  { id: "skills", label: "Extended skills" },
  { id: "setup", label: "Setup" }
];

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function operationPercent(completedUnits, totalUnits) {
  if (totalUnits <= 0) return 0;
  return clampPercent(completedUnits * 100 / totalUnits);
}

function detailSuffix(detail) {
  return detail ? ` · ${detail}` : "";
}

function createRecord({ id, label, totalUnits = 0, unitLabel = "", weight = 1, detail = "" }) {
  return {
    id,
    label,
    totalUnits: Math.max(0, Number(totalUnits) || 0),
    unitLabel,
    weight: Math.max(0, Number(weight) || 0),
    completedUnits: 0,
    percent: 0,
    detail,
    renderedMilestones: new Set(),
    completed: false,
    failed: false,
    skipped: false,
    started: false
  };
}

function groupForOperation(id) {
  if (["ecc-cache", "ecc-sync", "ecc-backup", "gstack-checkout", "gstack-bootstrap", "gstack-hooks"].includes(id)) return "components";
  if (id === "skills-backup" || id.startsWith("skill-git-") || id.startsWith("skill-copy-")) return "skills";
  return "setup";
}

export function createProgressReporter({ write = null, plan = [], setupId = "setup" } = {}) {
  const operations = new Map();
  const output = write || ((line) => process.stdout.write(`${line}\n`));
  let orderedIds = [];

  for (const entry of plan) {
    if (entry.id && !operations.has(entry.id)) {
      operations.set(entry.id, createRecord(entry));
      orderedIds.push(entry.id);
    }
  }

  function render(operation, terminal = false) {
    const milestones = terminal
      ? [operation.percent]
      : MILESTONES.filter((milestone) => milestone < 100 && milestone <= operation.percent && !operation.renderedMilestones.has(milestone));
    for (const milestone of milestones) {
      operation.renderedMilestones.add(milestone);
      output(`${operation.label} ${milestone}%${detailSuffix(operation.detail)}`);
    }
  }

  function update(operation, { completedUnits = operation.completedUnits, totalUnits = operation.totalUnits, detail, terminal = false } = {}) {
    if (operation.completed || operation.failed || operation.skipped) return operation;
    operation.totalUnits = Math.max(0, Number(totalUnits) || 0);
    operation.completedUnits = Math.max(operation.completedUnits, Math.max(0, Number(completedUnits) || 0));
    operation.percent = Math.max(operation.percent, operationPercent(operation.completedUnits, operation.totalUnits));
    if (detail !== undefined) operation.detail = detail;
    render(operation, terminal);
    return operation;
  }

  function failOperation(id, detail = "failed") {
    const operation = operations.get(id);
    if (!operation || operation.failed) return operation;
    operation.completed = false;
    operation.failed = true;
    operation.detail = detail;
    render(operation, true);
    return operation;
  }

  function skipOperation(id) {
    const operation = operations.get(id);
    if (!operation || operation.completed || operation.failed || operation.skipped) return operation;
    operation.skipped = true;
    operation.percent = 100;
    operation.detail = "skipped";
    render(operation, true);
    return operation;
  }

  function beginOperation({ id, label, totalUnits = 0, unitLabel = "", weight = 1, detail = "" }) {
    if (!id) throw new Error("Progress operation id is required.");
    let operation = operations.get(id);
    if (!operation) {
      operation = createRecord({ id, label, totalUnits, unitLabel, weight, detail });
      const hasSetup = operations.has(setupId);
      operations.set(id, operation);
      orderedIds = [...orderedIds.filter((value) => value !== setupId), id, ...(hasSetup ? [setupId] : [])];
    } else {
      operation.label = label || operation.label;
      operation.totalUnits = Math.max(0, Number(totalUnits) || 0);
      operation.unitLabel = unitLabel;
      operation.weight = Math.max(0, Number(weight) || 0);
      if (detail !== undefined) operation.detail = detail;
    }
    operation.started = true;
    render(operation);
    return {
      get percent() { return operation.percent; },
      get state() { return { ...operation }; },
      update(values = {}) { return update(operation, values); },
      complete({ detail } = {}) {
        if (operation.completed || operation.failed || operation.skipped) return operation;
        operation.completedUnits = operation.totalUnits;
        operation.percent = 100;
        operation.completed = true;
        if (detail !== undefined) operation.detail = detail;
        render(operation, true);
        return operation;
      },
      fail({ detail = "failed" } = {}) {
        if (operation.completed || operation.failed || operation.skipped) return operation;
        operation.failed = true;
        operation.detail = detail;
        render(operation, true);
        return operation;
      }
    };
  }

  return { beginOperation, failOperation, skipOperation, operations, flush() {} };
}

function createInteractiveSetupProgress(plan, { spinnerFactory = spinner, hasExtendedSkills = false } = {}) {
  const operations = new Map(plan.map((entry) => [entry.id, { ...entry, started: false, completed: false, failed: false, skipped: false }]));
  const groups = new Map(GROUPS.map(({ id, label }) => [id, {
    id,
    label,
    spinner: spinnerFactory(),
    operationIds: plan.filter((entry) => groupForOperation(entry.id) === id).map((entry) => entry.id),
    hasWork: id === "setup" || (id === "skills" && hasExtendedSkills) || plan.some((entry) => groupForOperation(entry.id) === id),
    started: false,
    stopped: false,
    managed: false
  }]));

  function startGroup(id) {
    const group = groups.get(id);
    if (!group || group.started || group.stopped) return;
    group.spinner.start(group.label);
    group.started = true;
  }

  function stopGroup(id, detail) {
    const group = groups.get(id);
    if (!group || group.stopped) return;
    startGroup(id);
    group.spinner.stop(`${group.label} ${detail}`);
    group.stopped = true;
  }

  for (const group of groups.values()) {
    if (!group.hasWork) stopGroup(group.id, "Skipped");
  }

  function finishGroupWhenReady(id) {
    const group = groups.get(id);
    if (!group || group.stopped || group.managed || id === "setup") return;
    if (group.operationIds.every((operationId) => {
      const operation = operations.get(operationId);
      return operation?.completed || operation?.skipped;
    })) stopGroup(id, "completed");
  }

  function failGroup(id, detail = "failed") {
    stopGroup(id, detail === "failed" ? "failed" : `${detail} failed`);
    stopGroup("setup", "failed");
  }

  function operationHandle(operation) {
    return {
      get percent() { return operation.percent || 0; },
      get state() { return { ...operation }; },
      update({ completedUnits = operation.completedUnits, totalUnits = operation.totalUnits } = {}) {
        operation.totalUnits = Math.max(0, Number(totalUnits) || 0);
        operation.completedUnits = Math.max(operation.completedUnits || 0, Math.max(0, Number(completedUnits) || 0));
        operation.percent = Math.max(operation.percent || 0, operationPercent(operation.completedUnits, operation.totalUnits));
        return operation;
      },
      complete() {
        if (operation.completed || operation.failed || operation.skipped) return operation;
        operation.completed = true;
        operation.percent = 100;
        finishGroupWhenReady(groupForOperation(operation.id));
        return operation;
      },
      fail() {
        if (operation.completed || operation.failed || operation.skipped) return operation;
        operation.failed = true;
        failGroup(groupForOperation(operation.id), operation.label);
        return operation;
      }
    };
  }

  return {
    beginOperation(spec) {
      if (!spec.id) throw new Error("Progress operation id is required.");
      const operation = operations.get(spec.id) || { ...spec, completedUnits: 0, percent: 0, completed: false, failed: false, skipped: false };
      operation.label = spec.label || operation.label;
      operation.started = true;
      operation.totalUnits = Math.max(0, Number(spec.totalUnits) || 0);
      operations.set(spec.id, operation);
      startGroup(groupForOperation(spec.id));
      startGroup("setup");
      return operationHandle(operation);
    },
    skipOperation(id) {
      const operation = operations.get(id);
      if (!operation || operation.completed || operation.failed || operation.skipped) return;
      operation.skipped = true;
      operation.percent = 100;
      finishGroupWhenReady(groupForOperation(id));
    },
    beginGroup(id) {
      const group = groups.get(id);
      if (group) group.managed = true;
      startGroup(id);
    },
    completeGroup(id) {
      stopGroup(id, "completed");
    },
    failGroup,
    complete({ detail = "completed" } = {}) {
      for (const group of groups.values()) {
        if (!group.stopped && group.id !== "setup") stopGroup(group.id, "completed");
      }
      stopGroup("setup", detail);
    },
    fail() {
      for (const group of groups.values()) {
        if (group.id !== "setup" && group.started && !group.stopped) stopGroup(group.id, "failed");
      }
      stopGroup("setup", "failed");
    },
    flush() {},
    operations
  };
}

export function createSetupProgress(plan = [], options = {}) {
  if (!plan.length) return null;
  if (options.interactive && options.ansi) return createInteractiveSetupProgress(plan, options);

  const reporter = createProgressReporter({ ...options, plan });
  const weights = new Map(plan.map((entry) => [entry.id, Math.max(0, Number(entry.weight) || 0)]));
  const setup = reporter.beginOperation({ id: "setup", label: "Setup", totalUnits: 100, weight: 0, detail: "preparing resources" });
  const operations = new Map();
  let lastPercent = 0;
  let activeLabel = "preparing resources";
  let setupFailed = false;

  function updateSetup(nextLabel = activeLabel, { terminal = false } = {}) {
    activeLabel = nextLabel;
    const totalWeight = [...weights.values()].reduce((total, weight) => total + weight, 0);
    const weighted = totalWeight === 0 ? 0 : [...weights.keys()].reduce((total, id) => {
      return total + (weights.get(id) || 0) * (operations.get(id)?.percent || 0) / 100;
    }, 0) * 100 / totalWeight;
    const nextPercent = Math.min(99, clampPercent(weighted));
    lastPercent = Math.max(lastPercent, nextPercent);
    if (!setupFailed) setup.update({ completedUnits: lastPercent, totalUnits: 100, detail: activeLabel, terminal });
  }

  return {
    flush: reporter.flush,
    beginOperation(spec) {
      const operation = reporter.beginOperation(spec);
      operations.set(spec.id, operation);
      const wrap = (method) => (values = {}) => {
        const result = operation[method](values);
        updateSetup(spec.label, { terminal: method === "complete" });
        return result;
      };
      return {
        get percent() { return operation.percent; },
        get state() { return operation.state; },
        update: wrap("update"),
        complete: wrap("complete"),
        fail: (values = {}) => {
          const result = operation.fail(values);
          if (result.failed) {
            setupFailed = true;
            reporter.failOperation("setup", values.detail || "failed");
          }
          return result;
        }
      };
    },
    complete({ detail = "completed" } = {}) {
      if (setupFailed) return;
      updateSetup(detail);
      setup.complete({ detail });
    },
    skipOperation(id) {
      if (!weights.has(id) || operations.get(id)?.skipped || operations.get(id)?.state?.completed) return;
      reporter.skipOperation(id);
      operations.set(id, { percent: 100, skipped: true });
      updateSetup();
    },
    fail({ detail = "failed" } = {}) {
      setupFailed = true;
      reporter.failOperation("setup", detail);
    },
    operations: reporter.operations
  };
}
