import path from "node:path";
import { askPassword, askText, isInteractive } from "./prompt.mjs";

const PLACEHOLDER_RE = /^\$\{([A-Z0-9_]+)(?::-(.*))?\}$/;
const SECRET_RE = /(API_KEY|TOKEN|SECRET|PASSWORD)$/;
const PATH_RE = /(PROJECT_DIR|_DIR|_PATH)$/;
const context7Key = "CONTEXT7_API_KEY";
const tavilyKey = "TAVILY_API_KEY";
const SECRET_HELP_URLS = {
  [context7Key]: "https://context7.com/dashboard",
  [tavilyKey]: "https://app.tavily.com/home"
};
const SECRET_PLACEHOLDERS = {
  [context7Key]: "",
  [tavilyKey]: ""
};

export function parseMcpPlaceholder(value) {
  if (typeof value !== "string") return null;
  const match = value.match(PLACEHOLDER_RE);
  if (!match) return null;
  return { name: match[1], defaultValue: match[2] || "" };
}

export function validateRelativeMcpPath(value) {
  const input = String(value || "").trim();
  if (!input) return "Required";
  if (input.startsWith("~") || path.isAbsolute(input) || /^[A-Za-z]:[\\/]/.test(input)) return "Use a relative path, not an absolute machine path.";
  if (input.split(/[\\/]+/).includes("..")) return "Path must not contain '..'.";
  return true;
}

export function mcpSecretPrompt(input) {
  const helpUrl = SECRET_HELP_URLS[input.name];
  return helpUrl ? `MCP secret — ${input.label} (get key: ${helpUrl})` : `MCP secret — ${input.label}`;
}

export function mcpInputFields(mcpServers) {
  const inputs = [];
  const seen = new Set();

  function add(input) {
    if (seen.has(input.name)) return;
    seen.add(input.name);
    inputs.push(input);
  }

  for (const [serverName, server] of Object.entries(mcpServers)) {
    for (const [envName, envValue] of Object.entries(server.env || {})) {
      const placeholder = parseMcpPlaceholder(envValue);
      if (!placeholder) continue;
      add({
        ...placeholder,
        kind: SECRET_RE.test(placeholder.name) ? "secret" : "text",
        label: `${serverName}: ${envName}`,
        placeholder: SECRET_PLACEHOLDERS[placeholder.name],
        validate: (value) => String(value || "").trim() ? true : "Required"
      });
    }

    for (const arg of server.args || []) {
      const placeholder = parseMcpPlaceholder(arg);
      if (!placeholder) continue;
      add({
        ...placeholder,
        kind: PATH_RE.test(placeholder.name) ? "path" : "text",
        label: `${serverName}: ${placeholder.name}`,
        validate: PATH_RE.test(placeholder.name) ? validateRelativeMcpPath : undefined
      });
    }
  }

  return inputs;
}

export async function collectMcpValues(mcpServers, { yes = false, values = {} } = {}) {
  const inputs = mcpInputFields(mcpServers);
  const nextValues = { ...values };

  for (const input of inputs) {
    if (input.kind !== "path" || !nextValues[input.name]) continue;
    const validation = validateRelativeMcpPath(nextValues[input.name]);
    if (validation !== true) throw new Error(`${input.label}: ${validation}`);
  }

  if (yes || !isInteractive()) return nextValues;

  for (const input of inputs) {
    if (nextValues[input.name]) continue;
    const initial = process.env[input.name] || input.defaultValue;
    if (input.kind === "path") {
      nextValues[input.name] = await askText(`MCP path — ${input.label}`, {
        initial: initial || ".",
        validate: validateRelativeMcpPath
      });
    } else if (input.kind === "secret") {
      nextValues[input.name] = await askPassword(mcpSecretPrompt(input), {
        initial,
        validate: (value) => String(value || "").trim() ? true : "Required"
      });
    } else {
      nextValues[input.name] = await askText(`MCP value — ${input.label}`, {
        initial,
        validate: (value) => String(value || "").trim() ? true : "Required"
      });
    }
  }

  return nextValues;
}
