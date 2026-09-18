import React, { useState } from "react";
import { Box, Text, render, useInput } from "ink";
import BigText from "ink-big-text";

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max", "ultracode"];
export const DEFAULT_EFFORT_LEVEL = "medium";
const NARROW_EFFORT_PICKER_WIDTH = 80;

export function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI);
}

function cancelled() {
  return new Error("Setup cancelled.");
}

function normalizeOptions(options) {
  return options.map((option) => {
    if (typeof option === "string") return { label: option, value: option };
    return {
      label: option.title || option.label || option.value,
      value: option.value,
      hint: option.description || option.hint,
      selected: option.selected,
      disabled: option.disabled
    };
  });
}

function enabledOptions(options) {
  return options.filter((option) => !option.disabled);
}

function runPrompt(Component, props = {}, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    let instance;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      instance?.unmount();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    try {
      instance = render(React.createElement(Component, { ...props, done }), {
        stdin: input,
        stdout: output,
        exitOnCtrlC: false
      });
    } catch (error) {
      done(error);
    }
  });
}

function Frame({ message, children, help = "Enter to continue · Esc to cancel" }) {
  return React.createElement(Box, { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1 },
    React.createElement(Text, { bold: true, color: "cyan" }, "repo-pattern"),
    React.createElement(Text, null, message),
    children,
    React.createElement(Text, { dimColor: true }, help)
  );
}

function TextPrompt({ message, initial = "", placeholder = "", validate = null, mask = false, done }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) return done(cancelled());
    if (key.return) {
      const candidate = value || initial || placeholder;
      const result = validate?.(candidate);
      if (result === false) return setError("Invalid");
      if (typeof result === "string") return setError(result);
      return done(mask ? value || initial : candidate);
    }
    if (key.backspace || key.delete) return setValue((previous) => previous.slice(0, -1));
    if (input && !key.ctrl && !key.meta) setValue((previous) => previous + input);
  });
  const display = value
    ? (mask ? "•".repeat([...value].length) : value)
    : (mask && initial ? "•".repeat([...initial].length) : initial || placeholder);
  const isPlaceholder = !value && !initial && Boolean(placeholder);
  return React.createElement(Frame, { message },
    React.createElement(Text, { color: isPlaceholder ? "gray" : "green" }, `› ${display || " "}`),
    error ? React.createElement(Text, { color: "red" }, error) : null
  );
}

function ConfirmPrompt({ message, defaultYes, done }) {
  const [answer, setAnswer] = useState(defaultYes);
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) return done(cancelled());
    if (key.leftArrow || key.rightArrow || input.toLowerCase() === "y" || input.toLowerCase() === "n") {
      setAnswer(input.toLowerCase() === "y" ? true : input.toLowerCase() === "n" ? false : !answer);
    }
    if (key.return) done(answer);
  });
  return React.createElement(Frame, { message, help: "←/→ to choose · Enter to confirm · Esc to cancel" },
    React.createElement(Text, { color: "green" }, `› ${answer ? "Yes" : "No"}`)
  );
}

function SelectPrompt({ message, options, initialValue, many = false, done }) {
  const choices = enabledOptions(normalizeOptions(options));
  const initialIndex = Math.max(0, choices.findIndex((choice) => choice.value === initialValue));
  const [index, setIndex] = useState(initialIndex);
  const [selected, setSelected] = useState(() => new Set(many ? choices.filter((choice) => choice.selected).map((choice) => choice.value) : []));
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) return done(cancelled());
    if (key.upArrow) return setIndex((previous) => Math.max(0, previous - 1));
    if (key.downArrow) return setIndex((previous) => Math.min(choices.length - 1, previous + 1));
    if (many && input === " ") return setSelected((previous) => {
      const next = new Set(previous);
      const value = choices[index].value;
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
    if (key.return) return done(many ? choices.filter((choice) => selected.has(choice.value)).map((choice) => choice.value) : choices[index].value);
  });
  return React.createElement(Frame, { message, help: many ? "↑/↓ to move · Space to toggle · Enter to confirm · Esc to cancel" : "↑/↓ to move · Enter to confirm · Esc to cancel" },
    ...choices.map((choice, choiceIndex) => React.createElement(Text, { key: String(choice.value), color: choiceIndex === index ? "cyan" : undefined },
      `${choiceIndex === index ? "›" : " "} ${many ? (selected.has(choice.value) ? "◉" : "○") : " "} ${choice.label}${choice.hint ? ` — ${choice.hint}` : ""}`
    ))
  );
}

function EffortPrompt({ done }) {
  const [index, setIndex] = useState(EFFORT_LEVELS.indexOf(DEFAULT_EFFORT_LEVEL));
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) return done(cancelled());
    if (key.leftArrow) return setIndex((previous) => Math.max(0, previous - 1));
    if (key.rightArrow) return setIndex((previous) => Math.min(EFFORT_LEVELS.length - 1, previous + 1));
    if (key.return) done(EFFORT_LEVELS[index]);
  });
  return React.createElement(Frame, { message: "Choose effort level", help: "←/→ to choose · Enter to confirm · Esc to cancel" },
    React.createElement(Text, { color: "green" }, renderEffortPicker(EFFORT_LEVELS[index], { color: false }))
  );
}

export function resolveTextValue(value, { initial = "", placeholder = "" } = {}) {
  return value || initial || placeholder;
}

export async function askText(message, { initial = "", placeholder = "", validate = null } = {}) {
  return runPrompt(TextPrompt, { message, initial, placeholder, validate });
}

export async function askPassword(message, { initial = "", validate = null } = {}) {
  return runPrompt(TextPrompt, { message: initial ? `${message} (leave empty to keep current value)` : message, initial, validate, mask: true });
}

export async function askConfirm(message, defaultYes = true) {
  return runPrompt(ConfirmPrompt, { message, defaultYes });
}

export async function selectOne({ message, options, initialValue = null }) {
  const normalized = normalizeOptions(options);
  if (normalized.some((choice) => choice.disabled && choice.value === initialValue)) throw new Error(`Initial option is disabled: ${initialValue}`);
  return runPrompt(SelectPrompt, { message, options: normalized, initialValue });
}

export async function selectMany({ message, options, initialValues = [] }) {
  const choices = enabledOptions(normalizeOptions(options));
  const enabledValues = new Set(choices.map((choice) => choice.value));
  const selected = new Set(initialValues.filter((value) => enabledValues.has(value)));
  for (const choice of choices) if (choice.selected) selected.add(choice.value);
  return runPrompt(SelectPrompt, { message, options: choices.map((choice) => ({ ...choice, selected: selected.has(choice.value) })), many: true });
}

export function printBox(title, lines = [], { progress = null } = {}) {
  progress?.flush?.();
  console.log(`\n== ${title} ==`);
  for (const line of lines) console.log(line);
}

const ANSI_RESET = "\x1b[0m";
const ANSI_STYLES = { dim: "\x1b[2m", error: "\x1b[31m", info: "\x1b[34m", success: "\x1b[32m" };
const LOGO_PALETTE = ["\x1b[38;5;39m", "\x1b[38;5;81m", "\x1b[38;5;141m", "\x1b[38;5;213m"];
const LOGO_LINES = ["  ____  ____ ", " |  _ \\|  _ \\", " | |_) | |_) |", " |  _ <|  __/ ", " |_| \\_\\|_|    ", "repo-pattern"];

function supportsAnsiColor() {
  return isInteractive() && !process.env.NO_COLOR && process.env.TERM !== "dumb";
}

export function style(kind, value) {
  const color = ANSI_STYLES[kind];
  return color && supportsAnsiColor() ? `${color}${value}${ANSI_RESET}` : String(value);
}

export function nextEffortIndex(index, keyName) {
  if (keyName === "left") return Math.max(0, index - 1);
  if (keyName === "right") return Math.min(EFFORT_LEVELS.length - 1, index + 1);
  return index;
}

export function renderEffortPicker(value, { columns = process.stdout.columns, color = supportsAnsiColor() } = {}) {
  const active = color ? `${ANSI_STYLES.info}${value}${ANSI_RESET}` : value;
  const recommended = color ? `${ANSI_STYLES.success}recommended${ANSI_RESET}` : "recommended";
  if (!columns || columns < NARROW_EFFORT_PICKER_WIDTH) return `Effort: [${active}] ${recommended} · ←/→ · Enter`;
  return `Effort: ${EFFORT_LEVELS.map((level) => level === value ? `[${color ? `${ANSI_STYLES.info}${level}${ANSI_RESET}` : level}]` : level).join(" ─ ")}  ${recommended} · ←/→ · Enter`;
}

export function askEffortLevel({ input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) return Promise.resolve(DEFAULT_EFFORT_LEVEL);
  return runPrompt(EffortPrompt, {}, { input, output });
}

function gradient(line) {
  let painted = 0;
  const total = [...line].filter((char) => char !== " ").length || 1;
  return [...line].map((char) => {
    if (char === " ") return char;
    const color = LOGO_PALETTE[Math.floor(painted++ * LOGO_PALETTE.length / total)];
    return `${color}${char}`;
  }).join("") + ANSI_RESET;
}

export function renderLogo({ color = false } = {}) {
  const lines = color ? LOGO_LINES.map(gradient) : LOGO_LINES;
  return [...lines, "ECC-first Claude Code setup"];
}

function BrandHeader() {
  return React.createElement(Box, { flexDirection: "column", marginBottom: 1 },
    React.createElement(BigText, { text: "RP", font: "block", colors: ["cyan"] }),
    React.createElement(Text, { bold: true, color: "cyan" }, "repo-pattern"),
    React.createElement(Text, { dimColor: true }, "Claude Code workspace setup")
  );
}

export function printLogo() {
  if (!isInteractive()) return printBox("repo-pattern", renderLogo());
  const instance = render(React.createElement(BrandHeader));
  instance.unmount();
}

const SUMMARY_VALUE_WIDTH = 72;
function wrapValue(value) {
  const text = String(value);
  if (text.length <= SUMMARY_VALUE_WIDTH) return [text];
  const rawParts = text.includes(", ") ? text.split(", ") : text.split(" ");
  const parts = rawParts.map((part, index) => text.includes(", ") && index < rawParts.length - 1 ? `${part},` : part);
  const lines = [];
  let line = "";
  for (const part of parts) {
    if (part.length > SUMMARY_VALUE_WIDTH) {
      if (line) lines.push(line);
      line = "";
      for (let i = 0; i < part.length; i += SUMMARY_VALUE_WIDTH) lines.push(part.slice(i, i + SUMMARY_VALUE_WIDTH));
      continue;
    }
    const next = line ? `${line} ${part}` : part;
    if (next.length > SUMMARY_VALUE_WIDTH && line) { lines.push(line); line = part; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function summaryLines(rows) {
  const width = Math.max(...rows.map(([label]) => label.length), 0);
  return rows.flatMap(([label, value]) => wrapValue(value).map((line, index) => `${index ? "" : label}`.padEnd(width) + `  ${line}`));
}
export function printSummary(title, rows = [], { progress = null } = {}) {
  progress?.flush?.();
  printBox(title, summaryLines(rows));
}
export async function withSpinner(_message, task) { return task(); }
export function printSection(title) { console.log(`\n== ${title} ==`); }
