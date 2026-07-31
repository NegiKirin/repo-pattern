const MILESTONES = [0, 25, 50, 75, 100];

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function progressBar(percent, width = 20) {
  const filled = Math.round(percent * width / 100);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function operationPercent(completedUnits, totalUnits) {
  if (totalUnits <= 0) return 0;
  return clampPercent(completedUnits * 100 / totalUnits);
}

function detailSuffix(detail) {
  return detail ? ` · ${detail}` : "";
}

export function createProgressReporter({ interactive = false, ansi = false, write = null } = {}) {
  const operations = new Map();
  const output = write || ((line) => process.stdout.write(interactive && ansi ? line : `${line}\n`));
  let activeInteractive = false;

  function render(operation, { terminal = false } = {}) {
    const detail = detailSuffix(operation.detail);
    if (interactive && ansi) {
      const prefix = activeInteractive ? "\x1b[2K\r" : "";
      output(`${prefix}${operation.label} [${progressBar(operation.percent)}] ${operation.percent}%${detail}${terminal ? "\n" : ""}`);
      activeInteractive = !terminal;
      return;
    }

    const milestones = terminal
      ? [operation.percent]
      : MILESTONES.filter((milestone) => milestone <= operation.percent && !operation.renderedMilestones.has(milestone));
    for (const milestone of milestones) {
      operation.renderedMilestones.add(milestone);
      output(`${operation.label} ${milestone}%${detail}`);
    }
  }

  function update(operation, { completedUnits = operation.completedUnits, totalUnits = operation.totalUnits, detail } = {}) {
    operation.totalUnits = Math.max(0, Number(totalUnits) || 0);
    operation.completedUnits = Math.max(operation.completedUnits, Math.max(0, Number(completedUnits) || 0));
    operation.percent = Math.max(operation.percent, operationPercent(operation.completedUnits, operation.totalUnits));
    if (detail !== undefined) operation.detail = detail;
    render(operation);
    return operation;
  }

  function beginOperation({ id, label, totalUnits = 0, unitLabel = "", weight = 1, detail = "" }) {
    if (!id) throw new Error("Progress operation id is required.");
    const operation = {
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
      failed: false
    };
    operations.set(id, operation);
    render(operation);
    return {
      get percent() { return operation.percent; },
      get state() { return { ...operation }; },
      update(values = {}) { return update(operation, values); },
      complete({ detail } = {}) {
        if (operation.completed || operation.failed) return operation;
        operation.completedUnits = operation.totalUnits;
        operation.percent = 100;
        operation.completed = true;
        if (detail !== undefined) operation.detail = detail;
        render(operation, { terminal: true });
        return operation;
      },
      fail({ detail = "failed" } = {}) {
        if (operation.completed || operation.failed) return operation;
        operation.failed = true;
        operation.detail = detail;
        render(operation, { terminal: true });
        return operation;
      }
    };
  }

  return { beginOperation, operations };
}

export function createSetupProgress(plan = [], options = {}) {
  if (!plan.length) return null;
  const reporter = createProgressReporter(options);
  const weights = new Map(plan.map((entry) => [entry.id, Math.max(0, Number(entry.weight) || 0)]));
  const setup = reporter.beginOperation({ id: "setup", label: "Setup", totalUnits: 100, weight: 0, detail: "preparing resources" });
  const operations = new Map();
  let lastPercent = 0;
  let activeLabel = "preparing resources";

  function updateSetup(nextLabel = activeLabel) {
    activeLabel = nextLabel;
    const totalWeight = [...weights.values()].reduce((total, weight) => total + weight, 0);
    const weighted = totalWeight === 0 ? 0 : [...weights.keys()].reduce((total, id) => {
      return total + (weights.get(id) || 0) * (operations.get(id)?.percent || 0) / 100;
    }, 0) * 100 / totalWeight;
    const complete = [...weights.keys()].every((id) => {
      const operation = operations.get(id);
      return operation?.skipped || operation?.state?.completed;
    });
    const nextPercent = complete ? 100 : Math.min(99, clampPercent(weighted));
    lastPercent = Math.max(lastPercent, nextPercent);
    if (complete) setup.complete({ detail: "completed" });
    else setup.update({ completedUnits: lastPercent, totalUnits: 100, detail: activeLabel });
  }

  return {
    beginOperation(spec) {
      const operation = reporter.beginOperation(spec);
      operations.set(spec.id, operation);
      const wrap = (method) => (values = {}) => {
        const result = operation[method](values);
        updateSetup(spec.label);
        return result;
      };
      return {
        get percent() { return operation.percent; },
        get state() { return operation.state; },
        update: wrap("update"),
        complete: wrap("complete"),
        fail: (values = {}) => {
          const result = operation.fail(values);
          setup.fail({ detail: values.detail || "failed" });
          return result;
        }
      };
    },
    complete({ detail = "completed" } = {}) {
      updateSetup(detail);
      const operation = reporter.operations.get("setup");
      if (!operation.completed && !operation.failed) operation.detail = detail;
    },
    skipOperation(id) {
      if (!weights.has(id) || operations.has(id)) return;
      operations.set(id, { percent: 100, skipped: true });
      updateSetup();
    },
    fail({ detail = "failed" } = {}) {
      setup.fail({ detail });
    },
    operations: reporter.operations
  };
}
