import fs from "node:fs/promises";
import path from "node:path";
import { appendGitignoreLine, ensureDir, ensureRepoPatternGitignore, exists, isTracked, readJson, readPrivateJson, readRepoLock, repoLockPath, writeJson, writePrivateJson } from "./shared/fs-utils.mjs";
import { collectMcpValues, mcpInputFields, mcpSecretPrompt, parseMcpPlaceholder as parsePlaceholder } from "./ui/mcp-interaction.mjs";
import { printBox, printSummary, style } from "./ui/prompt.mjs";
export { collectMcpValues, mcpInputFields, mcpSecretPrompt, validateRelativeMcpPath } from "./ui/mcp-interaction.mjs";

const SECRET_HELP_URLS = {
  CONTEXT7_API_KEY: "https://context7.com/dashboard",
  TAVILY_API_KEY: "https://app.tavily.com/home"
};
const PERSISTED_MCP_VALUES = new Set(Object.keys(SECRET_HELP_URLS));

export function persistedMcpValues(values = {}) {
  return Object.fromEntries(Object.entries(values).filter(([name]) => PERSISTED_MCP_VALUES.has(name)));
}

export function withoutPersistedMcpValues(values = {}) {
  return Object.fromEntries(Object.entries(values).filter(([name]) => !PERSISTED_MCP_VALUES.has(name)));
}

export async function readGeneratedMcpValues(target) {
  const config = await readPrivateJson(path.join(target, ".mcp.json"), {}, { label: ".mcp.json" });
  const values = {};
  for (const server of Object.values(config.mcpServers || {})) {
    if (!server || typeof server !== "object" || Array.isArray(server)) throw new Error(".mcp.json contains an invalid MCP server entry.");
    for (const [name, value] of Object.entries(server.env || {})) {
      if (PERSISTED_MCP_VALUES.has(name) && value && !parsePlaceholder(value)) values[name] = value;
    }
  }
  return values;
}

export async function listAvailableMcpServers(sourceRoot) {
  const serverDir = path.join(sourceRoot, "mcp", "servers");
  const entries = await fs.readdir(serverDir);
  return entries.filter((name) => name.endsWith(".json")).map((name) => path.basename(name, ".json")).sort();
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
  const { ANTHROPIC_AUTH_TOKEN: _ignored, ...safeValues } = values;
  return replacePlaceholders(mcpServers, safeValues);
}

export async function readMcpConfig({ sourceRoot, mcpServers: selectedServers = [] }) {
  const availableServers = await listAvailableMcpServers(sourceRoot);
  const enabledServers = [...new Set(selectedServers || [])];
  const invalid = enabledServers.filter((name) => !availableServers.includes(name));
  if (invalid.length > 0) throw new Error(`Unknown MCP server(s): ${invalid.join(", ")}. Available: ${availableServers.join(", ")}`);

  const mcpServers = {};
  for (const name of enabledServers) {
    const serverData = await readJson(path.join(sourceRoot, "mcp", "servers", `${name}.json`));
    Object.assign(mcpServers, serverData);
  }

  return { enabledServers, mcpServers };
}

function warnMissingMcpValues(mcpServers, values, { silent = false, output = null } = {}) {
  const missing = missingRequiredInputs(mcpInputFields(mcpServers), { ...process.env, ...values });
  if (missing.length === 0) return [];
  const names = missing.map((input) => input.name);
  if (!silent) (output?.warn || console.warn)(style("info", `MCP values missing: ${names.join(", ")}. Export env vars or edit .mcp.json before using those servers.`));
  return names;
}

async function syncEnabledMcpServers(target, servers, { dryRun = false, silent = false } = {}) {
  const settingsPath = path.join(target, ".claude", "settings.json");
  const settings = await readPrivateJson(settingsPath, {
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

  await writePrivateJson(settingsPath, settings, { dryRun, silent, label: ".claude/settings.json", parentLabel: ".claude" });
}

export async function generateMcp({ sourceRoot, target, mcpServers: selectedServers = [], mcpValues = {}, yes = false, dryRun = false, progress = null, silent = false, output = null }) {
  if (!dryRun) {
    try {
      if ((await fs.lstat(path.join(target, ".repo-pattern"))).isSymbolicLink()) throw new Error(".repo-pattern must not be a symlink.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const operation = progress?.beginOperation?.({ id: "mcp-generation", label: "Generating MCP workspace", totalUnits: 4, unitLabel: "items", weight: 1 });
  let completed = 0;
  const advance = (detail) => operation?.update({ completedUnits: ++completed, totalUnits: 4, detail });
  const { enabledServers, mcpServers } = await readMcpConfig({ sourceRoot, mcpServers: selectedServers });
  if (isTracked(target, ".mcp.json")) throw new Error(".mcp.json is tracked. Untrack it before generating MCP config with local values.");
  if (isTracked(target, ".claude/settings.json")) throw new Error(".claude/settings.json is tracked. Untrack it before enabling MCP servers.");
  const values = await collectMcpValues(mcpServers, { yes: yes || silent, values: mcpValues });
  const resolvedMcpServers = applyMcpValues(mcpServers, values);

  try {
    await ensureDir(target, { dryRun, silent });
    await writePrivateJson(path.join(target, ".mcp.json"), { mcpServers: resolvedMcpServers }, { dryRun, label: ".mcp.json", silent });
    await appendGitignoreLine(target, ".mcp.json", { dryRun, silent });
    advance("Writing .mcp.json");

    await syncEnabledMcpServers(target, enabledServers, { dryRun, silent });
    advance("Enabling MCP servers");

    await ensureRepoPatternGitignore(target, { dryRun, silent });
    advance("Writing workspace state");
    const lockPath = repoLockPath(target);
    const lock = await readRepoLock(target, {});
    const { profile: _profile, ...mcp } = lock.mcp || {};
    lock.mcp = {
      ...mcp,
      enabledServers,
      generatedAt: new Date().toISOString()
    };
    await writePrivateJson(lockPath, lock, {
      dryRun,
      silent,
      label: ".repo-pattern/.repo-pattern.lock.json",
      parentLabel: ".repo-pattern"
    });
    advance("Writing setup lock");
    operation?.complete({ detail: dryRun ? "preview" : "completed" });
  } catch (error) {
    operation?.fail({ detail: "failed" });
    throw error;
  }

  const missingValues = warnMissingMcpValues(mcpServers, values, { silent, output });
  if (!silent) (output?.summary || printSummary)("MCP generated", [
    ["Enabled servers", Object.keys(mcpServers).join(", ")],
    ["Claude enabled", enabledServers.join(", ")]
  ], { progress });
  return { missingValues, ...(missingValues.length > 0 ? { warnings: [`MCP values pending: ${missingValues.join(", ")}`] } : {}) };
}
