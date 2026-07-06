import { confirm, isCancel, multiselect, note, password, select, spinner, text } from "@clack/prompts";

export function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function handleCancel(value) {
  if (isCancel(value)) throw new Error("Setup cancelled.");
  return value;
}

function clackValidate(validate, fallback = null) {
  if (!validate) return undefined;
  return (value) => {
    const result = validate(value || fallback || "");
    if (result === true) return undefined;
    if (result === false) return "Invalid";
    return result;
  };
}

export async function askText(message, { initial = "", validate = null } = {}) {
  return handleCancel(await text({
    message,
    initialValue: initial,
    validate: clackValidate(validate)
  }));
}

export async function askPassword(message, { initial = "", validate = null } = {}) {
  const value = handleCancel(await password({
    message: initial ? `${message} (leave empty to keep current value)` : message,
    validate: clackValidate(validate, initial)
  }));
  return value || initial;
}

export async function askConfirm(message, defaultYes = true) {
  return handleCancel(await confirm({
    message,
    initialValue: defaultYes
  })) === true;
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

export async function selectOne({ message, options, initialValue = null }) {
  const normalized = normalizeOptions(options);
  if (normalized.some((choice) => choice.disabled && choice.value === initialValue)) {
    throw new Error(`Initial option is disabled: ${initialValue}`);
  }

  const choices = enabledOptions(normalized);
  return handleCancel(await select({
    message,
    options: choices,
    initialValue
  }));
}

export async function selectMany({ message, options, initialValues = [] }) {
  const choices = enabledOptions(normalizeOptions(options));
  const enabledValues = new Set(choices.map((choice) => choice.value));
  const selected = new Set(initialValues.filter((value) => enabledValues.has(value)));
  for (const choice of choices) {
    if (choice.selected) selected.add(choice.value);
  }

  return handleCancel(await multiselect({
    message,
    options: choices,
    initialValues: [...selected],
    required: false
  }));
}

export function printBox(title, lines = []) {
  if (isInteractive()) {
    note(lines.join("\n"), title);
    return;
  }

  console.log(`\n== ${title} ==`);
  for (const line of lines) console.log(line);
}

const ANSI_RESET = "\x1b[0m";
const ANSI_STYLES = {
  dim: "\x1b[2m",
  error: "\x1b[31m",
  info: "\x1b[34m",
  success: "\x1b[32m"
};
const LOGO_PALETTE = ["\x1b[38;5;39m", "\x1b[38;5;81m", "\x1b[38;5;141m", "\x1b[38;5;213m"];
const LOGO_LINES = [
  "  ____  ____ ",
  " |  _ \\|  _ \\",
  " | |_) | |_) |",
  " |  _ <|  __/ ",
  " |_| \\_\\_|    ",
  "repo-pattern"
];

function supportsAnsiColor() {
  return isInteractive() && !process.env.NO_COLOR && process.env.TERM !== "dumb";
}

export function style(kind, value) {
  const color = ANSI_STYLES[kind];
  return color && supportsAnsiColor() ? `${color}${value}${ANSI_RESET}` : String(value);
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

export function printLogo() {
  printBox("repo-pattern", renderLogo({ color: supportsAnsiColor() }));
}

const SUMMARY_VALUE_WIDTH = 72;

function wrapValue(value) {
  const text = String(value);
  if (text.length <= SUMMARY_VALUE_WIDTH) return [text];

  const rawParts = text.includes(", ") ? text.split(", ") : text.split(" ");
  const parts = rawParts.map((part, index) => text.includes(", ") && index < rawParts.length - 1 ? `${part},` : part);
  const lines = [];
  let line = "";

  function pushLine(value) {
    lines.push(value);
  }

  for (const part of parts) {
    if (part.length > SUMMARY_VALUE_WIDTH) {
      if (line) {
        pushLine(line);
        line = "";
      }
      for (let i = 0; i < part.length; i += SUMMARY_VALUE_WIDTH) {
        pushLine(part.slice(i, i + SUMMARY_VALUE_WIDTH));
      }
      continue;
    }

    const next = line ? `${line} ${part}` : part;
    if (next.length > SUMMARY_VALUE_WIDTH && line) {
      pushLine(line);
      line = part;
    } else {
      line = next;
    }
  }

  if (line) pushLine(line);
  return lines;
}

function summaryLines(rows) {
  const width = Math.max(...rows.map(([label]) => label.length), 0);
  const lines = [];
  for (const [label, value] of rows) {
    const wrapped = wrapValue(value);
    lines.push(`${label.padEnd(width)}  ${wrapped[0]}`);
    for (const continuation of wrapped.slice(1)) {
      lines.push(`${"".padEnd(width)}  ${continuation}`);
    }
  }
  return lines;
}

export function printSummary(title, rows = []) {
  const lines = summaryLines(rows);
  if (!isInteractive()) {
    printBox(title, lines);
    return;
  }
  note(lines.join("\n"), title);
}

export async function withSpinner(message, task) {
  if (!isInteractive()) return task();

  const s = spinner();
  s.start(message);
  try {
    const result = await task();
    s.stop(`${message} done`);
    return result;
  } catch (error) {
    s.stop(`${message} failed`);
    throw error;
  }
}

export function printSection(title) {
  console.log(isInteractive() ? `\n◆ ${title}` : `\n== ${title} ==`);
}
