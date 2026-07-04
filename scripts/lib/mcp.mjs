import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, exists, readJson, writeJson } from "./fs-utils.mjs";

export async function listAvailableMcpServers(sourceRoot) {
  const serverDir = path.join(sourceRoot, "mcp", "servers");
  const entries = await fs.readdir(serverDir);
  return entries.filter((name) => name.endsWith(".json")).map((name) => path.basename(name, ".json")).sort();
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

export async function generateMcp({ sourceRoot, target, profile = "web", mcpServers: selectedServers = null, dryRun = false }) {
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

  await ensureDir(target, { dryRun });
  await writeJson(path.join(target, ".mcp.json"), { mcpServers }, { dryRun });

  await syncEnabledMcpServers(target, profileServers, { dryRun });

  const lockPath = path.join(target, ".repo-pattern.lock.json");
  const lock = await readJson(lockPath, {});
  lock.mcp = lock.mcp || {};
  lock.mcp.profile = profile;
  lock.mcp.enabledServers = profileServers;
  lock.mcp.generatedAt = new Date().toISOString();
  await writeJson(lockPath, lock, { dryRun });

  console.log(`MCP profile generated: ${profile}`);
  console.log(`Enabled servers: ${Object.keys(mcpServers).join(", ")}`);
  console.log(`Claude Code enabledMcpjsonServers synced: ${profileServers.join(", ")}`);
}
