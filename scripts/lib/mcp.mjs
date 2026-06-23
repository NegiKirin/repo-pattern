import path from "node:path";
import { copyRecursive, ensureDir, exists, readJson, writeJson } from "./fs-utils.mjs";
import { cloneDefaultSettings } from "./settings-defaults.mjs";

export async function copyMcpSystem({ sourceRoot, target, dryRun = false }) {
  await copyRecursive(path.join(sourceRoot, "mcp"), path.join(target, "mcp"), { dryRun });
}

async function syncEnabledMcpServers(target, servers, { dryRun = false } = {}) {
  const settingsPath = path.join(target, ".claude", "settings.json");
  const settings = await readJson(settingsPath, cloneDefaultSettings());

  settings.enabledMcpjsonServers = servers;
  settings.hooks = settings.hooks || {};

  await writeJson(settingsPath, settings, { dryRun });
}

export async function generateMcp({ sourceRoot, target, profile = "web", dryRun = false }) {
  const profilePath = path.join(sourceRoot, "mcp", "profiles", `${profile}.json`);
  if (!exists(profilePath)) {
    throw new Error(`MCP profile not found: ${profile}`);
  }

  const profileData = await readJson(profilePath);
  const profileServers = profileData.servers || [];
  const mcpServers = {};

  for (const name of profileServers) {
    const serverPath = path.join(sourceRoot, "mcp", "servers", `${name}.json`);
    if (!exists(serverPath)) throw new Error(`MCP server definition not found: ${name}`);
    const serverData = await readJson(serverPath);
    Object.assign(mcpServers, serverData);
  }

  await ensureDir(target, { dryRun });
  await writeJson(path.join(target, ".mcp.json"), { mcpServers }, { dryRun });

  const examplePath = path.join(target, ".mcp.json.example");
  await writeJson(examplePath, { mcpServers }, { dryRun });

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
