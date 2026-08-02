const MILESTONES = [0, 25, 50, 75, 100];
const REDRAW_INTERVAL_MS = 66;

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

function formatInteractiveOperation(operation) {
  const detail = operation.skipped ? "skipped" : operation.detail;
  return `${operation.label} [${progressBar(operation.percent)}] ${operation.percent}%${detailSuffix(detail)}`;
}

export function createProgressReporter({ interactive = false, ansi = false, write = null, plan = [], setupId = "setup" } = {}) {
  const operations = new Map();
  const output = write || ((line) => process.stdout.write(interactive && ansi ? line : `${line}\n`));
  let orderedIds = [];
  let liveActive = false;
  let liveLineCount = 0;
  let lastRenderAt = 0;
  let redrawTimer = null;
  let dirty = false;

  for (const entry of plan) {
    if (entry.id && !operations.has(entry.id)) {
      operations.set(entry.id, createRecord(entry));
      orderedIds.push(entry.id);
    }
  }

  function orderedOperations() {
    return orderedIds.map((id) => operations.get(id)).filter(Boolean);
  }

  function renderDurable(operation, terminal) {
    const milestones = terminal
      ? [operation.percent]
      : MILESTONES.filter((milestone) => milestone < 100 && milestone <= operation.percent && !operation.renderedMilestones.has(milestone));
    for (const milestone of milestones) {
      operation.renderedMilestones.add(milestone);
      output(`${operation.label} ${milestone}%${detailSuffix(operation.detail)}`);
    }
  }

  function renderLive(force = false) {
    if (!interactive || !ansi || (!dirty && !force)) return;
    const rows = orderedOperations().map(formatInteractiveOperation);
    const previousRows = liveLineCount;
    const rowCount = Math.max(previousRows, rows.length);
    const frame = liveActive
      ? `\x1b[${previousRows}A\x1b[0G${Array.from({ length: rowCount }, (_, index) => `\x1b[2K\r${rows[index] || ""}\n`).join("")}`
      : `${rows.map((row) => `${row}\n`).join("")}`;
    output(frame);
    liveActive = rows.length > 0;
    liveLineCount = rows.length;
    lastRenderAt = Date.now();
    dirty = false;
  }

  function scheduleRender() {
    if (redrawTimer !== null) return;
    const delay = Math.max(0, REDRAW_INTERVAL_MS - (Date.now() - lastRenderAt));
    redrawTimer = setTimeout(() => {
      redrawTimer = null;
      renderLive();
    }, delay);
  }

  function render(operation, { terminal = false } = {}) {
    if (interactive && ansi) {
      dirty = true;
      if (terminal) {
        if (redrawTimer !== null) clearTimeout(redrawTimer);
        redrawTimer = null;
        renderLive(true);
      } else if (!liveActive || Date.now() - lastRenderAt >= REDRAW_INTERVAL_MS) {
        renderLive(true);
      } else {
        scheduleRender();
      }
      return;
    }
    renderDurable(operation, terminal);
  }

  function update(operation, { completedUnits = operation.completedUnits, totalUnits = operation.totalUnits, detail, terminal = false } = {}) {
    if (operation.completed || operation.failed || operation.skipped) return operation;
    operation.totalUnits = Math.max(0, Number(totalUnits) || 0);
    operation.completedUnits = Math.max(operation.completedUnits, Math.max(0, Number(completedUnits) || 0));
    operation.percent = Math.max(operation.percent, operationPercent(operation.completedUnits, operation.totalUnits));
    if (detail !== undefined) operation.detail = detail;
    render(operation, { terminal });
    return operation;
  }

  function flush() {
    if (redrawTimer !== null) clearTimeout(redrawTimer);
    redrawTimer = null;
    if (!liveActive) return;
    renderLive();
    const frame = `\x1b[${liveLineCount}A\x1b[0G${Array.from({ length: liveLineCount }, () => "\x1b[2K\r\n").join("")}`.slice(0, -1);
    output(frame);
    liveActive = false;
    liveLineCount = 0;
    dirty = false;
  }

  function failOperation(id, detail = "failed") {
    const operation = operations.get(id);
    if (!operation || operation.failed) return operation;
    operation.completed = false;
    operation.failed = true;
    operation.detail = detail;
    render(operation, { terminal: true });
    return operation;
  }

  function skipOperation(id) {
    const operation = operations.get(id);
    if (!operation || operation.completed || operation.failed || operation.skipped) return operation;
    operation.skipped = true;
    operation.percent = 100;
    operation.detail = "skipped";
    render(operation, { terminal: true });
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
        render(operation, { terminal: true });
        return operation;
      },
      fail({ detail = "failed" } = {}) {
        if (operation.completed || operation.failed || operation.skipped) return operation;
        operation.failed = true;
        operation.detail = detail;
        render(operation, { terminal: true });
        return operation;
      }
    };
  }

  return { beginOperation, failOperation, skipOperation, operations, flush };
}

export function createSetupProgress(plan = [], options = {}) {
  if (!plan.length) return null;
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
