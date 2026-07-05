import fs from "node:fs/promises";
import path from "node:path";
import { appendGitignoreLine, ensureDir, exists, isTracked, readJson, writeJson } from "./fs-utils.mjs";
import { askPassword, askText, isInteractive, printSummary } from "./prompt.mjs";

const PLACEHOLDER_RE = /^\$\{([A-Z0-9_]+)(?::-(.*))?\}$/;
const SECRET_RE = /(API_KEY|TOKEN|SECRET|PASSWORD)$/;
const PATH_RE = /(PROJECT_DIR|_DIR|_PATH)$/;

export async function listAvailableMcpServers(sourceRoot) {
  const serverDir = path.join(sourceRoot, "mcp", "servers");
  const entries = await fs.readdir(serverDir);
  return entries.filter((name) => name.endsWith(".json")).map((name) => path.basename(name, ".json")).sort();
}

function parsePlaceholder(value) {
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

function findMcpInputs(mcpServers) {
  const inputs = [];
  const seen = new Set();

  function add(input) {
    if (seen.has(input.name)) return;
    seen.add(input.name);
    inputs.push(input);
  }

  for (const [serverName, server] of Object.entries(mcpServers)) {
    for (const [envName, envValue] of Object.entries(server.env || {})) {
      const placeholder = parsePlaceholder(envValue);
      if (!placeholder) continue;
      add({
        ...placeholder,
        kind: SECRET_RE.test(placeholder.name) ? "secret" : "text",
        label: `${serverName} ${envName}`
      });
    }

    for (const arg of server.args || []) {
      const placeholder = parsePlaceholder(arg);
      if (!placeholder) continue;
      add({
        ...placeholder,
        kind: PATH_RE.test(placeholder.name) ? "path" : "text",
        label: `${serverName} ${placeholder.name}`
      });
    }
  }

  return inputs;
}

function missingRequiredInputs(inputs, values) {
  return inputs.filter((input) => !input.defaultValue && !values[input.name]);
}

function replacePlaceholders(value, values) {
  if (Array.isArray(value)) return value.map((item) => replacePlaceholders(item, values));
  if (!value || typeof value !== "object") {
    const placeholder = parsePlaceholder(value);
    return placeholder && values[placeholder.name] ? values[placeholder.name] : value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, replacePlaceholders(nested, values)])
  );
}

export function applyMcpValues(mcpServers, values = {}) {
  return replacePlaceholders(mcpServers, values);
}

export async function readMcpConfig({ sourceRoot, profile = "web", mcpServers: selectedServers = null }) {
  const profileData = selectedServers ? null : await readJson(path.join(sourceRoot, "mcp", "profiles", `${profile}.json`));
  const profileServers = selectedServers || profileData?.servers;
  if (!profileServers) throw new Error(`MCP profile not found: ${profile}`);
  if (profile === "custom" && profileServers.length === 0) throw new Error("Custom MCP profile requires at least one server.");

  const mcpServers = {};

  for (const name of profileServers) {
    const serverPath = path.join(sourceRoot, "mcp", "servers", `${name}.json`);
    if (!exists(serverPath)) throw new Error(`MCP server definition not found: ${name}`);
    const serverData = await readJson(serverPath);
    Object.assign(mcpServers, serverData);
  }

  return { profileServers, mcpServers };
}

export async function collectMcpValues(mcpServers, { yes = false, values = {} } = {}) {
  const inputs = findMcpInputs(mcpServers);
  const nextValues = { ...values };

  if (yes || !isInteractive()) return nextValues;

  for (const input of inputs) {
    if (nextValues[input.name]) continue;
    const initial = process.env[input.name] || input.defaultValue;
    if (input.kind === "path") {
      nextValues[input.name] = await askText(`MCP path for ${input.label}`, {
        initial: initial || ".",
        validate: validateRelativeMcpPath
      });
    } else if (input.kind === "secret") {
      nextValues[input.name] = await askPassword(`MCP secret for ${input.label}`, {
        initial,
        validate: (value) => String(value || "").trim() ? true : "Required"
      });
    } else {
      nextValues[input.name] = await askText(`MCP value for ${input.label}`, {
        initial,
        validate: (value) => String(value || "").trim() ? true : "Required"
      });
    }
  }

  return nextValues;
}

function warnMissingMcpValues(mcpServers, values) {
  const missing = missingRequiredInputs(findMcpInputs(mcpServers), { ...process.env, ...values });
  if (missing.length === 0) return [];
  const names = missing.map((input) => input.name);
  console.warn(`MCP values not provided; update .mcp.json or export env vars for: ${names.join(", ")}`);
  return names;
}

async function syncEnabledMcpServers(target, servers, { dryRun = false } = {}) {
  const settingsPath = path.join(target, ".claude", "settings.json");
  const settings = await readJson(settingsPath, {
    "$schema": "https://json.schemastore.org/claude-code-settings.json",
    "permissions": {
      "allow": [],
      "ask": [],
      "deny": [],
      "additionalDirectories": [],
      "defaultMode": "default",
      "disableBypassPermissionsMode": "disable"
    },
    "hooks": {}
  });

  settings.enabledMcpjsonServers = servers;

  await writeJson(settingsPath, settings, { dryRun });
}

export async function generateMcp({ sourceRoot, target, profile = "web", mcpServers: selectedServers = null, mcpValues = {}, yes = false, dryRun = false }) {
  const { profileServers, mcpServers } = await readMcpConfig({ sourceRoot, profile, mcpServers: selectedServers });
  if (isTracked(target, ".mcp.json")) throw new Error(".mcp.json is tracked. Untrack it before generating MCP config with local values.");
  if (isTracked(target, ".claude/settings.json")) throw new Error(".claude/settings.json is tracked. Untrack it before enabling MCP servers.");
  const values = await collectMcpValues(mcpServers, { yes, values: mcpValues });
  const resolvedMcpServers = applyMcpValues(mcpServers, values);

  await ensureDir(target, { dryRun });
  await writeJson(path.join(target, ".mcp.json"), { mcpServers: resolvedMcpServers }, { dryRun });
  await appendGitignoreLine(target, ".mcp.json", { dryRun });

  await syncEnabledMcpServers(target, profileServers, { dryRun });

  const lockPath = path.join(target, ".repo-pattern.lock.json");
  const lock = await readJson(lockPath, {});
  lock.mcp = lock.mcp || {};
  lock.mcp.profile = profile;
  lock.mcp.enabledServers = profileServers;
  lock.mcp.generatedAt = new Date().toISOString();
  await writeJson(lockPath, lock, { dryRun });

  const missingValues = warnMissingMcpValues(mcpServers, values);
  printSummary("MCP generated", [
    ["Profile", profile],
    ["Enabled servers", Object.keys(mcpServers).join(", ")],
    ["Claude enabled", profileServers.join(", ")]
  ]);
  return { missingValues };
}
