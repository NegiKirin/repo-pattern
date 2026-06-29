import prompts from "prompts";

export function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function onCancel() {
  throw new Error("Setup cancelled.");
}

export async function askText(message, { initial = "", validate = null } = {}) {
  const result = await prompts({
    type: "text",
    name: "value",
    message,
    initial,
    validate
  }, { onCancel });
  return result.value;
}

export async function askPassword(message, { initial = "", validate = null } = {}) {
  const result = await prompts({
    type: "password",
    name: "value",
    message,
    initial,
    validate
  }, { onCancel });
  return result.value;
}

export async function askConfirm(message, defaultYes = true) {
  const result = await prompts({
    type: "confirm",
    name: "value",
    message,
    initial: defaultYes
  }, { onCancel });
  return result.value === true;
}

function normalizeOptions(options) {
  return options.map((option) => {
    if (typeof option === "string") return { title: option, value: option };
    return {
      title: option.title || option.label || option.value,
      value: option.value,
      description: option.description || option.hint,
      selected: option.selected,
      disabled: option.disabled
    };
  });
}

export async function selectOne({ message, options, initialValue = null }) {
  const choices = normalizeOptions(options);
  const initial = Math.max(0, choices.findIndex((choice) => choice.value === initialValue));
  const result = await prompts({
    type: "select",
    name: "value",
    message,
    choices,
    initial
  }, { onCancel });
  return result.value;
}

export async function selectMany({ message, options, initialValues = [] }) {
  const selected = new Set(initialValues);
  const choices = normalizeOptions(options).map((choice) => ({
    ...choice,
    selected: selected.has(choice.value) || choice.selected === true
  }));
  const result = await prompts({
    type: "multiselect",
    name: "value",
    message,
    choices,
    instructions: "Use ↑/↓ to move, Space to toggle, Enter to continue."
  }, { onCancel });
  return result.value || [];
}

export async function askChoice(message, choices, defaultValue) {
  return selectOne({ message, options: choices, initialValue: defaultValue });
}

export function printBox(title, lines = []) {
  console.log(`\n== ${title} ==`);
  for (const line of lines) console.log(line);
}
