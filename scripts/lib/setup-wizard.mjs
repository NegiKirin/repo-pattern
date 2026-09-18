import { createRequire } from "node:module";
import React, { useState } from "react";
import { Box, Text, render, useInput } from "ink";
import BigText from "ink-big-text";
import { EFFORT_LEVELS } from "./prompt.mjs";

const { version } = createRequire(import.meta.url)("../../package.json");

const PIPELINE_OPTIONS = [
  { value: "ecc", label: "ECC", hint: "project-scoped plugin with optional project rules" },
  { value: "gstack", label: "gstack", hint: "project-local at .claude/skills/gstack; requires Git and Bun" }
];

function usesEcc(pipeline) {
  return pipeline === "ecc" || pipeline === "both";
}

function usesGstack(pipeline) {
  return pipeline === "gstack" || pipeline === "both";
}

function pipelineValues(pipeline) {
  if (pipeline === "both") return ["ecc", "gstack"];
  return pipeline === "none" ? [] : [pipeline];
}

function selectedPipeline(values) {
  if (values.includes("ecc") && values.includes("gstack")) return "both";
  if (values.includes("ecc")) return "ecc";
  if (values.includes("gstack")) return "gstack";
  return "none";
}

function valueForPage(state, page) {
  if (page.id === "pipeline") return pipelineValues(state.setupPipeline);
  if (page.id === "mcpServers") return state.mcpServers || [];
  if (page.id === "rules") return state.rules;
  if (page.id === "optionalSkills") return state.optionalSkills;
  if (page.id === "planTuneHooks") return state.planTuneHooks ? "yes" : "no";
  if (page.id === "permission") return state.permissionConfig.bypass;
  if (page.id === "attribution") return state.attributionConfig.mode;
  if (page.id === "effort") return state.effortLevel;
  if (page.id.startsWith("mcp:")) return state.mcpValues[page.name] || "";
  if (page.id.startsWith("local:")) return state.localSettingsEnv[page.name] || "";
  if (page.id === "attributionCommit") return state.attributionConfig.commit || "";
  return state[page.id];
}

function mcpInputs(state, data) {
  return data.mcpInputs(state.profile, state.mcpServers || []);
}

function options(values) {
  return values.map((value) => typeof value === "string" ? { value, label: value } : value);
}

export function pruneWizardState(state, data) {
  const next = { ...state, rules: [...state.rules], mcpValues: { ...state.mcpValues }, attributionConfig: { ...state.attributionConfig } };
  next.planTuneHooks = usesGstack(next.setupPipeline);
  if (usesEcc(next.setupPipeline)) next.applyRules = true;
  if (!next.applyRules) {
    next.ruleMode = "auto";
    next.rules = [];
  }
  if (next.profile !== "custom") next.mcpServers = null;
  const required = new Set(mcpInputs(next, data).map((input) => input.name));
  next.mcpValues = Object.fromEntries(Object.entries(next.mcpValues).filter(([name]) => required.has(name)));
  if (next.attributionConfig.mode !== "custom") delete next.attributionConfig.commit;
  return next;
}

export function wizardPages(state, data) {
  const rulePages = state.applyRules
    ? [
      { id: "ruleMode", title: "Choose ECC rule detection mode", kind: "one", options: options(data.ruleModes) },
      ...(state.ruleMode === "manual" ? [{ id: "rules", title: "Choose ECC rule packs", kind: "many", options: options(data.rules) }] : [])
    ]
    : [];
  const configurationPages = [
    { id: "pipeline", title: "Choose setup workflow", kind: "many", options: PIPELINE_OPTIONS },
    ...(!usesEcc(state.setupPipeline) ? [{ id: "installRules", title: "Install project-local ECC rules?", kind: "one", options: [{ value: false, label: "No" }, { value: true, label: "Yes" }] }] : []),
    ...rulePages,
    { id: "profile", title: "Choose MCP profile", kind: "one", options: options(data.profiles) },
    ...(state.profile === "custom" ? [{ id: "mcpServers", title: "Choose MCP servers", kind: "many", options: options(data.mcpServers) }] : []),
    ...mcpInputs(state, data).map((input) => ({ id: `mcp:${input.name}`, name: input.name, title: `${input.kind === "secret" ? "MCP secret" : "MCP value"} — ${input.label}`, kind: "text", mask: input.kind === "secret", placeholder: input.defaultValue, validate: input.validate })),
    { id: "optionalSkills", title: "Optional external skills", kind: "many", options: options(data.optionalSkills) },
    ...data.localSettings.map((field) => ({ id: `local:${field.name}`, name: field.name, title: field.name, kind: "text", mask: field.mask, initial: field.initial, placeholder: field.placeholder, validate: field.validate })),
    { id: "effort", title: "Choose effort level", kind: "one", options: EFFORT_LEVELS.map((value) => ({ value, label: value })) },
    { id: "permission", title: "Allow bypass permissions mode?", kind: "one", options: [{ value: "deny", label: "No" }, { value: "allow", label: "Yes" }] },
    { id: "attribution", title: "Commit attribution?", kind: "one", options: [{ value: "off", label: "off" }, { value: "on", label: "on" }, { value: "custom", label: "custom" }] },
    ...(state.attributionConfig.mode === "custom" ? [{ id: "attributionCommit", title: "Custom commit attribution", kind: "text", initial: "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>", validate: (value) => String(value || "").trim() ? true : "Required" }] : [])
  ];
  return [
    ...(state.migrationChoice === "pending" ? [{ id: "migrationChoice", title: "Run migrate?", kind: "one", options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }] }] : []),
    ...(state.retryChoice === "pending" ? [{ id: "retryChoice", title: "Previous setup did not complete", kind: "one", options: [{ value: "retry", label: "Retry" }, { value: "edit", label: "Edit" }] }] : []),
    ...(state.retryChoice === "retry" ? [] : configurationPages),
    { id: "confirm", title: "Run setup now?", kind: "one", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }
  ];
}

export function previousPageIndex(pages, index) {
  return Math.max(0, index - 1);
}

function updatePage(state, page, value, data) {
  let next;
  if (page.id === "pipeline") next = { ...state, setupPipeline: selectedPipeline(value) };
  else if (page.id === "installRules") next = { ...state, applyRules: value };
  else if (page.id === "retryChoice") next = { ...state, retryChoice: value };
  else if (page.id === "migrationChoice") next = { ...state, migrationChoice: value };
  else if (page.id === "mcpServers") next = { ...state, mcpServers: value };
  else if (page.id === "ruleMode") next = { ...state, ruleMode: value, rules: value === "manual" ? state.rules : [] };
  else if (page.id === "rules" || page.id === "optionalSkills") next = { ...state, [page.id]: value };
  else if (page.id === "permission") next = { ...state, permissionConfig: { bypass: value } };
  else if (page.id === "attribution") next = { ...state, attributionConfig: { mode: value } };
  else if (page.id === "attributionCommit") next = { ...state, attributionConfig: { ...state.attributionConfig, commit: value } };
  else if (page.id === "effort") next = { ...state, effortLevel: value };
  else if (page.id.startsWith("mcp:")) next = { ...state, mcpValues: { ...state.mcpValues, [page.name]: value } };
  else if (page.id.startsWith("local:")) next = { ...state, localSettingsEnv: { ...state.localSettingsEnv, [page.name]: value } };
  else next = { ...state, [page.id]: value };
  return pruneWizardState(next, data);
}

function pageCursor(page, state) {
  if (page.kind !== "one") return 0;
  return Math.max(0, (page.options || []).findIndex((choice) => choice.value === valueForPage(state, page)));
}

export function nextMenuCursor(index, keyName, length) {
  if (length === 0) return 0;
  if (keyName === "up") return index === 0 ? length - 1 : index - 1;
  if (keyName === "down") return index === length - 1 ? 0 : index + 1;
  return index;
}

export function nextEffortCursor(index, keyName, length) {
  if (keyName === "left") return Math.max(0, index - 1);
  if (keyName === "right") return Math.min(length - 1, index + 1);
  return index;
}

export function effortColor(value) {
  return value === "ultracode" ? "magenta" : "cyan";
}

export function renderEffortOptions(values, active) {
  return values.map((value) => ({
    value,
    label: value === active ? `[${value}]` : value,
    color: value === active ? effortColor(value) : undefined
  }));
}

function display(value, page) {
  if (!value) return page.placeholder || page.initial || " ";
  return page.mask ? "•".repeat([...value].length) : value;
}

export function SetupWizard({ initialState, data, done, initialPageId = null }) {
  const [state, setState] = useState(initialState);
  const [pageId, setPageId] = useState(initialPageId);
  const [cursor, setCursor] = useState(() => initialPageId === "effort" ? Math.max(0, EFFORT_LEVELS.indexOf(initialState.effortLevel)) : 0);
  const [buffer, setBuffer] = useState("");
  const [error, setError] = useState("");
  const pages = wizardPages(state, data);
  const pageIndex = Math.max(0, pages.findIndex((page) => page.id === pageId));
  const page = pages[pageIndex];
  const choices = page.options || [];
  const current = page.kind === "text" ? (buffer || valueForPage(state, page)) : valueForPage(state, page);
  const selectedValues = Array.isArray(current) ? current : [];
  const effortValue = choices[cursor]?.value || current;
  const goBack = () => {
    const previous = pages[previousPageIndex(pages, pageIndex)];
    setPageId(previous.id); setCursor(pageCursor(previous, state)); setBuffer(""); setError("");
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") return done(new Error("Setup cancelled."));
    if (key.escape && page.id === "effort") return goBack();
    if (key.escape) return done(new Error("Setup cancelled."));
    if (page.id === "effort" && key.leftArrow) return setCursor((previous) => nextEffortCursor(previous, "left", choices.length));
    if (page.id === "effort" && key.rightArrow) return setCursor((previous) => nextEffortCursor(previous, "right", choices.length));
    if (key.leftArrow) return goBack();
    if (page.kind === "text") {
      if (key.backspace || key.delete) return setBuffer((previous) => (previous || valueForPage(state, page)).slice(0, -1));
      if (key.return) {
        const value = buffer || valueForPage(state, page) || page.initial || page.placeholder || "";
        const result = page.validate?.(value);
        if (result !== true && result !== undefined) return setError(result === false ? "Invalid" : result);
        const next = updatePage(state, page, value, data);
        const nextPages = wizardPages(next, data);
        const nextPage = nextPages[Math.min(pageIndex + 1, nextPages.length - 1)];
        setState(next); setPageId(nextPage.id); setCursor(pageCursor(nextPage, next)); setBuffer(""); setError(""); return;
      }
      if (input && !key.ctrl && !key.meta) setBuffer((previous) => previous + input);
      return;
    }
    if (key.upArrow) return setCursor((previous) => nextMenuCursor(previous, "up", choices.length));
    if (key.downArrow) return setCursor((previous) => nextMenuCursor(previous, "down", choices.length));
    if (page.kind === "many" && input === " ") {
      if (choices.length === 0) return;
      const selected = new Set(selectedValues);
      const value = choices[cursor].value;
      selected.has(value) ? selected.delete(value) : selected.add(value);
      return setState(updatePage(state, page, [...selected], data));
    }
    if (!key.return) return;
    if (page.id === "mcpServers" && choices.length === 0) return setError("Custom MCP profile requires at least one server.");
    if (page.kind === "one" && choices.length === 0) return setError("No options available.");
    const value = page.kind === "many" ? selectedValues : page.id === "effort" ? effortValue : choices[cursor].value;
    if (page.id === "migrationChoice" && value === "no") return done(new Error("Setup cancelled."));
    if (page.id === "confirm") return value === "yes" ? done(state) : done(new Error("Setup cancelled."));
    if (page.id === "mcpServers" && value.length === 0) return setError("Custom MCP profile requires at least one server.");
    const next = updatePage(state, page, value, data);
    const nextPages = wizardPages(next, data);
    const nextPage = nextPages[Math.min(pageIndex + 1, nextPages.length - 1)];
    setState(next); setPageId(nextPage.id); setCursor(pageCursor(nextPage, next)); setError("");
  });

  return React.createElement(Box, { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1 },
    React.createElement(Box, { alignItems: "flex-start", gap: 2 },
      React.createElement(BigText, { text: "RP", font: "block", colors: ["cyan"] }),
      React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true, color: "cyan" }, `repo-pattern v${version}`),
        data.claudeCodeVersion ? React.createElement(Text, { dimColor: true }, `Claude Code · ${data.claudeCodeVersion}`) : null
      )
    ),
    React.createElement(Text, { bold: true, color: "cyan" }, `Step ${pageIndex + 1} of ${pages.length}`),
    React.createElement(Text, null, page.title),
    React.createElement(Text, null, " "),
    page.kind === "text"
      ? React.createElement(Text, { color: "green" }, `› ${display(current, page)}`)
      : page.id === "effort"
        ? React.createElement(Box, null, ...renderEffortOptions(choices.map((choice) => choice.value), effortValue).map((choice) => React.createElement(Text, { key: choice.value, color: choice.color, dimColor: !choice.color }, `${choice.label}  `)))
        : choices.map((choice, index) => React.createElement(Text, { key: String(choice.value), color: index === cursor ? "cyan" : undefined }, `${index === cursor ? "›" : " "} ${page.kind === "many" ? (selectedValues.includes(choice.value) ? "◉" : "○") : " "} ${choice.label}${choice.hint ? ` — ${choice.hint}` : ""}`)),
    error ? React.createElement(Box, { marginTop: 1 }, React.createElement(Text, { color: "red" }, error)) : null,
    React.createElement(Text, null, " "),
    React.createElement(Text, { dimColor: true }, page.id === "effort"
      ? "←/→ move · Enter next · Esc back · Ctrl+C cancel"
      : `${pageIndex ? "← Back · " : ""}${page.kind === "text" ? "Enter next" : `↑/↓ move${page.kind === "many" ? " · Space toggle" : ""} · Enter next`} · Esc cancel`)
  );
}

export function runSetupWizard(initialState, data, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    let instance;
    const done = (result) => {
      instance?.unmount();
      if (result instanceof Error) reject(result); else resolve(result);
    };
    try {
      instance = render(React.createElement(SetupWizard, { initialState, data, done }), { stdin: input, stdout: output, exitOnCtrlC: false });
    } catch (error) {
      done(error);
    }
  });
}
