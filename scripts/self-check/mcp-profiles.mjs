import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateMcp, readMcpConfig } from "../lib/mcp.mjs";
import { CUSTOM_MCP_DEFAULTS, setupOptionsFromLock, setupProject } from "../lib/setup.mjs";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const cliPath = path.join(cliDir, "..", "repo-pattern.mjs");
const expectedProfiles = {
  backend: ["context7", "tavily", "gitnexus"],
  web: ["chrome-devtools", "context7", "playwright", "tavily"],
  research: ["context7", "tavily"],
  full: ["context7", "playwright", "chrome-devtools", "gitnexus", "tavily"]
};

export async function runMcpProfileChecks() {
  for (const [profile, expectedServers] of Object.entries(expectedProfiles)) {
    const { profileServers } = await readMcpConfig({ sourceRoot: repoRoot, profile });
    assert.deepEqual(profileServers, expectedServers);

    const target = await fs.mkdtemp(path.join(os.tmpdir(), `repo-pattern-${profile}-mcp-`));
    try {
      await generateMcp({
        sourceRoot: repoRoot,
        target,
        profile,
        mcpValues: { CONTEXT7_API_KEY: "context7-test-key", TAVILY_API_KEY: "tavily-test-key" },
        yes: true,
        silent: true
      });
      const generated = JSON.parse(await fs.readFile(path.join(target, ".mcp.json"), "utf8"));
      const settings = JSON.parse(await fs.readFile(path.join(target, ".claude", "settings.json"), "utf8"));
      assert.deepEqual(Object.keys(generated.mcpServers), expectedServers);
      assert.deepEqual(settings.enabledMcpjsonServers, expectedServers);
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  }

  for (const relativePath of [
    "mcp/servers/filesystem.json",
    "mcp/servers/sequential-thinking.json",
    "mcp/profiles/minimal.json"
  ]) {
    await assert.rejects(() => fs.access(path.join(repoRoot, relativePath)), { code: "ENOENT" });
  }

  const apiDefaultTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-api-default-backend-"));
  try {
    await setupProject({
      sourceRoot: repoRoot,
      target: apiDefaultTarget,
      setupPipeline: "none",
      yes: true
    });
    const config = JSON.parse(await fs.readFile(path.join(apiDefaultTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
    assert.equal(config.mcp.profile, "backend");
  } finally {
    await fs.rm(apiDefaultTarget, { recursive: true, force: true });
  }

  const genericTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-default-backend-"));
  try {
    const result = spawnSync(process.execPath, [cliPath, "setup", "--target", genericTarget, "--setup-pipeline", "none", "--yes"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(await fs.readFile(path.join(genericTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
    assert.equal(config.mcp.profile, "backend");
  } finally {
    await fs.rm(genericTarget, { recursive: true, force: true });
  }

  const mcpDefaultTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-default-mcp-web-"));
  try {
    const result = spawnSync(process.execPath, [cliPath, "mcp", "--target", mcpDefaultTarget, "--yes"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(await fs.readFile(path.join(mcpDefaultTarget, ".mcp.json"), "utf8"));
    assert.deepEqual(Object.keys(config.mcpServers), expectedProfiles.web);
  } finally {
    await fs.rm(mcpDefaultTarget, { recursive: true, force: true });
  }

  const frontendTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-default-web-"));
  try {
    await fs.writeFile(path.join(frontendTarget, "package.json"), JSON.stringify({ dependencies: { react: "1.0.0" } }));
    const result = spawnSync(process.execPath, [cliPath, "setup", "--target", frontendTarget, "--setup-pipeline", "none", "--yes"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(await fs.readFile(path.join(frontendTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
    assert.equal(config.mcp.profile, "web");
  } finally {
    await fs.rm(frontendTarget, { recursive: true, force: true });
  }

  assert.deepEqual(CUSTOM_MCP_DEFAULTS, ["context7", "tavily"]);
  assert.deepEqual(setupOptionsFromLock({
    setup: {
      status: "failed",
      options: {
        profile: "minimal",
        mcpServers: ["custom-server"],
        permissionConfig: { bypass: "allow" }
      }
    }
  }), {
    profile: "backend",
    mcpServers: ["custom-server"],
    permissionConfig: { bypass: "allow" },
    effortLevel: "medium"
  });
}
