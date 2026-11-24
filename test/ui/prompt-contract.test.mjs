import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { test } from "node:test";
import { askConfirm, askEffortLevel, askPassword, askText, printLogo, printSection, printSummary, promptTestComponents, selectMany, selectOne, style, withPromptRenderer } from "../../src/ui/prompt.mjs";

async function waitForFrame(renderer, pattern) {
  for (let i = 0; i < 100; i++) {
    if (pattern.test(renderer.lastFrame())) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.match(renderer.lastFrame(), pattern);
}


test("prompt components preserve text, confirm, selection, cancellation, and masking contracts", async () => {
  const text = render(React.createElement(promptTestComponents.TextPrompt, { message: "Name", placeholder: "name", done: () => {} }));
  assert.match(text.lastFrame(), /name/);
  text.stdin.write("abc");
  await waitForFrame(text, /abc/);
  text.stdin.write("\r");
  text.unmount();

  const confirmed = [];
  const confirm = render(React.createElement(promptTestComponents.ConfirmPrompt, { message: "Continue", defaultYes: true, done: (value) => confirmed.push(value) }));
  await waitForFrame(confirm, /Yes/);
  confirm.stdin.write("\r");
  await waitForFrame(confirm, /Yes/);
  assert.deepEqual(confirmed, [true]);
  confirm.unmount();

  const selected = [];
  const select = render(React.createElement(promptTestComponents.SelectPrompt, { message: "Pick", options: [{ group: true, label: "Group" }, { value: "a", label: "A" }, { value: "b", label: "B", disabled: true }, { value: "c", label: "C" }], done: (value) => selected.push(value) }));
  select.stdin.write("\u001b[B");
  await waitForFrame(select, /C/);
  select.stdin.write("\r");
  await waitForFrame(select, /C/);
  assert.deepEqual(selected, ["a"]);
  select.unmount();

  const many = [];
  const multi = render(React.createElement(promptTestComponents.SelectPrompt, { message: "Many", many: true, options: [{ value: "a", label: "A", selected: true }, { value: "b", label: "B" }], done: (value) => many.push(value) }));
  multi.stdin.write(" ");
  multi.stdin.write("\u001b[B");
  multi.stdin.write(" ");
  multi.stdin.write("\r");
  await waitForFrame(multi, /B/);
  assert.deepEqual(many, [["a"]]);
  multi.unmount();

  const cancelled = [];
  const password = render(React.createElement(promptTestComponents.TextPrompt, { message: "Secret", mask: true, done: (value) => cancelled.push(value) }));
  password.stdin.write("secret");
  await waitForFrame(password, /••••••/);
  password.stdin.write("\u001b");
  await waitForFrame(password, /Secret/);
  assert.equal(cancelled.length, 1);
  assert.match(cancelled[0].message, /Setup cancelled/);
  password.unmount();
});

test("prompt public helpers preserve noninteractive defaults and output formatting", async () => {
  const input = { isTTY: false };
  const output = { isTTY: false };
  assert.equal(await askEffortLevel({ input, output }), "medium");
  assert.equal(await withPromptRenderer(() => { throw new Error("renderer should not run"); }, () => askEffortLevel({ input, output })), "medium");
  assert.equal(style("unknown", "text"), "text");
  const logo = (await import("../../src/ui/prompt.mjs")).renderLogo();
  assert.equal(logo.at(-1), "ECC-first Claude Code setup");
  assert.equal(logo.at(-2), "repo-pattern");
  assert.equal(logo.length, 7);

  const lines = [];
  const previousLog = console.log;
  console.log = (line = "") => lines.push(String(line));
  try {
    printSection("Section");
    printLogo();
    printSummary("Summary", [["short", "value"], ["long", "x".repeat(80)]], { progress: { flush: () => lines.push("flushed") } });
  } finally {
    console.log = previousLog;
  }
  assert(lines.some((line) => line.includes("Section")));
  assert(lines.some((line) => line.includes("Summary")));
  assert(lines.some((line) => line.includes("flushed")));
});

test("prompt selection rejects disabled initial options before rendering", async () => {
  await assert.rejects(() => selectOne({ message: "Pick", options: [{ value: "x", disabled: true }], initialValue: "x" }), /Initial option is disabled/);
});

test("text prompts validate input and resolve initial or placeholder values", async () => {
  const submitted = [];
  const renderer = render(React.createElement(promptTestComponents.TextPrompt, {
    message: "Name", validate: (value) => value ? true : "Required", done: (value) => submitted.push(value)
  }));
  renderer.stdin.write("\r");
  await waitForFrame(renderer, /Required/);
  renderer.stdin.write("ok");
  await waitForFrame(renderer, /ok/);
  // gstack-timing-ok: Ink applies stdin state before accepting the next key.
  await new Promise((resolve) => setTimeout(resolve, 20));
  renderer.stdin.write("\r");
  // gstack-timing-ok: Ink commits the submitted prompt on its next timer tick.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(submitted, ["ok"]);
  renderer.unmount();

  const initial = [];
  const initialRenderer = render(React.createElement(promptTestComponents.TextPrompt, {
    message: "Existing", initial: "saved", done: (value) => initial.push(value)
  }));
  initialRenderer.stdin.write("\r");
  await waitForFrame(initialRenderer, /saved/);
  assert.deepEqual(initial, ["saved"]);
  initialRenderer.unmount();
});

test("password prompts preserve untouched values and mask replacements", async () => {
  const untouched = await withPromptRenderer((element) => {
    assert.equal(element.props.mask, true);
    assert.match(element.props.message, /leave empty to keep current value/);
    element.props.done(element.props.initial);
    return { unmount() {} };
  }, () => askPassword("Token", { initial: "old-secret" }));
  assert.equal(untouched, "old-secret");

  const renderer = render(React.createElement(promptTestComponents.TextPrompt, {
    message: "Token", initial: "old-secret", mask: true, done: () => {}
  }));
  renderer.stdin.write("new");
  await waitForFrame(renderer, /•••/);
  assert.doesNotMatch(renderer.lastFrame(), /old-secret|new/);
  renderer.unmount();
});

test("confirm prompt handles explicit keys and arrow toggles", async () => {
  const values = [];
  const renderer = render(React.createElement(promptTestComponents.ConfirmPrompt, {
    message: "Continue", defaultYes: true, done: (value) => values.push(value)
  }));
  renderer.stdin.write("n");
  await waitForFrame(renderer, /No/);
  renderer.stdin.write("\r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(values, [true]);
  renderer.unmount();
});

test("multi-select normalizes initial, selected, disabled, and group options", async () => {
  let captured;
  const result = await withPromptRenderer((element) => {
    captured = element.props;
    element.props.done(["a", "b"]);
    return { unmount() {} };
  }, () => selectMany({
    message: "Choose",
    initialValues: ["a", "disabled", "missing"],
    options: [
      { group: true, label: "Group" },
      { value: "a", label: "A" },
      { value: "b", label: "B", selected: true },
      { value: "disabled", label: "Disabled", disabled: true }
    ]
  }));
  assert.deepEqual(result, ["a", "b"]);
  assert.equal(captured.many, true);
  assert.deepEqual(captured.options.map((option) => option.selected), [undefined, true, true, false]);
});

test("prompt renderer is restored after a renderer failure", async () => {
  const first = () => { throw new Error("renderer failed"); };
  await assert.rejects(() => withPromptRenderer(first, () => askText("Name")), /renderer failed/);
  const value = await withPromptRenderer((element) => {
    element.props.done("second");
    return { unmount() {} };
  }, () => askText("Name"));
  assert.equal(value, "second");
});
