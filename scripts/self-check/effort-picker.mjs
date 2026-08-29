import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { askEffortLevel, DEFAULT_EFFORT_LEVEL, EFFORT_LEVELS, nextEffortIndex, renderEffortPicker } from "../lib/prompt.mjs";

function terminal() {
  const input = new EventEmitter();
  const output = { isTTY: true, columns: 20, write: () => true };
  const rawModes = [];
  input.isTTY = true;
  input.setRawMode = (value) => rawModes.push(value);
  input.resume = () => {};
  input.pause = () => {};
  return { input, output, rawModes };
}

export async function runEffortPickerChecks() {
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

  const { input, output, rawModes } = terminal();
  const picked = askEffortLevel({ input, output });
  input.emit("keypress", "", { name: "right" });
  input.emit("keypress", "", { name: "return" });
  assert.equal(await picked, "high");
  assert.deepEqual(rawModes, [true, false]);
  assert.equal(input.listenerCount("keypress"), 0);
}
