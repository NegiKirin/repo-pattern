import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateMcp, listAvailableMcpServers, readMcpConfig } from "../lib/mcp.mjs";
import { DEFAULT_MCP_SERVERS, groupedMcpOptions, setupOptionsFromLock, setupProject } from "../lib/setup.mjs";
import { groupedOptionalSkillOptions, OPTIONAL_SKILLS } from "../lib/skills.mjs";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const cliPath = path.join(cliDir, "..", "repo-pattern.mjs");

export async function runMcpServerChecks() {
  const availableServers = await listAvailableMcpServers(repoRoot);
  assert.deepEqual(availableServers, ["chrome-devtools", "context7", "gitnexus", "playwright", "shadcn", "shadcn-studio", "tavily"]);
  assert.deepEqual(DEFAULT_MCP_SERVERS, ["context7", "tavily", "gitnexus"]);

  const groupedServers = groupedMcpOptions(availableServers.map((value) => ({ value, hint: value })));
  assert.deepEqual(groupedServers.filter((option) => option.group).map((option) => option.label), ["Core / Must have", "Development tools", "UI / shadcn"]);
  assert.deepEqual(groupedServers.filter((option) => !option.group).map((option) => option.value), ["context7", "tavily", "gitnexus", "chrome-devtools", "playwright", "shadcn", "shadcn-studio"]);
  const groupedWithExtraServer = groupedMcpOptions([...availableServers, "future-server"].map((value) => ({ value, hint: value })));
  assert.deepEqual(groupedWithExtraServer.slice(-2), [{ group: true, label: "Other servers" }, { value: "future-server", hint: "future-server" }]);

  const groupedSkills = groupedOptionalSkillOptions(OPTIONAL_SKILLS);
  assert.deepEqual(groupedSkills.filter((option) => option.group).map((option) => option.label), ["Design and frontend", "Project patterns", "Documentation", "Terminal workflow"]);
  assert.deepEqual(groupedSkills.filter((option) => !option.group).map((option) => option.value), ["taste", "ui-ux-pro-max", "impeccable", "huashu-design", "nextjs-pattern", "fastapi-pattern", "document-specialist", "herdr"]);

  const selected = ["shadcn-studio", "context7", "shadcn-studio"];
  const { enabledServers, mcpServers } = await readMcpConfig({ sourceRoot: repoRoot, mcpServers: selected });
  assert.deepEqual(enabledServers, ["shadcn-studio", "context7"]);
  assert.deepEqual(mcpServers["shadcn-studio"], {
    command: "npx",
    args: ["-y", "shadcn-studio-mcp"],
    description: "shadcn/ui Studio component design and generation"
  });
  await assert.rejects(() => readMcpConfig({ sourceRoot: repoRoot, mcpServers: ["nope"] }), /Unknown MCP server\(s\): nope\. Available:/);

  const emptyTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-empty-mcp-"));
  try {
    await generateMcp({ sourceRoot: repoRoot, target: emptyTarget, mcpServers: [], yes: true, silent: true });
    const generated = JSON.parse(await fs.readFile(path.join(emptyTarget, ".mcp.json"), "utf8"));
    const settings = JSON.parse(await fs.readFile(path.join(emptyTarget, ".claude", "settings.json"), "utf8"));
    assert.deepEqual(generated.mcpServers, {});
    assert.deepEqual(settings.enabledMcpjsonServers, []);
  } finally {
    await fs.rm(emptyTarget, { recursive: true, force: true });
  }

  const explicitTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-explicit-mcp-"));
  try {
    const result = spawnSync(process.execPath, [cliPath, "mcp", "--target", explicitTarget, "--mcp", "shadcn-studio", "--mcp", "context7", "--mcp", "shadcn-studio", "--yes"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const generated = JSON.parse(await fs.readFile(path.join(explicitTarget, ".mcp.json"), "utf8"));
    const settings = JSON.parse(await fs.readFile(path.join(explicitTarget, ".claude", "settings.json"), "utf8"));
    assert.deepEqual(Object.keys(generated.mcpServers), ["shadcn-studio", "context7"]);
    assert.deepEqual(settings.enabledMcpjsonServers, ["shadcn-studio", "context7"]);
  } finally {
    await fs.rm(explicitTarget, { recursive: true, force: true });
  }

  const defaultsTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-default-mcp-"));
  try {
    const result = spawnSync(process.execPath, [cliPath, "mcp", "--target", defaultsTarget, "--yes"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const generated = JSON.parse(await fs.readFile(path.join(defaultsTarget, ".mcp.json"), "utf8"));
    assert.deepEqual(Object.keys(generated.mcpServers), DEFAULT_MCP_SERVERS);
  } finally {
    await fs.rm(defaultsTarget, { recursive: true, force: true });
  }

  const setupTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-default-setup-"));
  try {
    await setupProject({ sourceRoot: repoRoot, target: setupTarget, setupPipeline: "none", yes: true });
    const generated = JSON.parse(await fs.readFile(path.join(setupTarget, ".mcp.json"), "utf8"));
    assert.deepEqual(Object.keys(generated.mcpServers), DEFAULT_MCP_SERVERS);
  } finally {
    await fs.rm(setupTarget, { recursive: true, force: true });
  }

  for (const relativePath of ["mcp/profiles/backend.json", "mcp/profiles/full.json", "mcp/profiles/research.json", "mcp/profiles/web.json"]) {
    await assert.rejects(() => fs.access(path.join(repoRoot, relativePath)), { code: "ENOENT" });
  }

  const legacyLock = { setup: { status: "succeeded", options: { mcpServers: ["context7"] } }, mcp: { profile: "backend" } };
  assert.throws(() => setupOptionsFromLock(legacyLock), /MCP profiles are no longer supported\. Rerun repo-pattern setup to choose MCP servers\./);
  assert.throws(
    () => setupOptionsFromLock({ setup: { status: "failed", options: { profile: "backend" } } }),
    /MCP profiles are no longer supported\. Rerun repo-pattern setup to choose MCP servers\./
  );
}
