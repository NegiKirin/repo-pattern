import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GRAPHIFY_GRAPH_PATH, GRAPHIFY_MCP_ARGS, GRAPHIFY_MCP_COMMAND, assertGraphifyMcpDefinition, isCompatiblePythonVersion, prepareGraphify, validateGraphFile } from "../lib/graphify.mjs";
import { generateMcp, listAvailableMcpServers, readMcpConfig } from "../lib/mcp.mjs";
import { installGraphifyStubs } from "./graphify-fixtures.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const profiles = {
  backend: ["context7", "tavily", "chrome-devtools", "graphify"],
  web: ["playwright", "context7", "tavily", "graphify"],
  research: ["context7", "tavily", "graphify"],
  full: ["context7", "playwright", "chrome-devtools", "tavily", "graphify"]
};

export async function runGraphifyChecks() {
  assert.equal(GRAPHIFY_GRAPH_PATH, "graphify-out/graph.json");
  assert.equal(GRAPHIFY_MCP_COMMAND, "graphify-mcp");
  assert.deepEqual(GRAPHIFY_MCP_ARGS, ["graphify-out/graph.json"]);
  assert.equal(isCompatiblePythonVersion("Python 3.10.0"), true);
  assert.equal(isCompatiblePythonVersion("Python 3.14.1"), true);
  assert.equal(isCompatiblePythonVersion("Python 3.9.18"), false);
  assert.equal(isCompatiblePythonVersion("invalid"), false);
  assert.doesNotThrow(() => assertGraphifyMcpDefinition({ command: GRAPHIFY_MCP_COMMAND, args: GRAPHIFY_MCP_ARGS }));
  assert.throws(() => assertGraphifyMcpDefinition({ command: "graphify", args: GRAPHIFY_MCP_ARGS }), /graphify-mcp/);
  assert.throws(() => assertGraphifyMcpDefinition({ command: GRAPHIFY_MCP_COMMAND, args: [] }), /arguments/);
  assert.deepEqual(await listAvailableMcpServers(sourceRoot), ["chrome-devtools", "context7", "graphify", "playwright", "tavily"]);
  for (const [profile, expectedServers] of Object.entries(profiles)) {
    assert.deepEqual((await readMcpConfig({ sourceRoot, profile })).profileServers, expectedServers);
  }
  await assert.rejects(() => readMcpConfig({ sourceRoot, profile: "minimal" }), /MCP profile not found/);
  assert.deepEqual(
    (await readMcpConfig({ sourceRoot, profile: "custom", mcpServers: ["context7"] })).profileServers,
    ["context7", "graphify"]
  );

  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-graphify-"));
  try {
    await fs.mkdir(path.join(target, "graphify-out"));
    await fs.writeFile(path.join(target, GRAPHIFY_GRAPH_PATH), "{}\n");
    await validateGraphFile(target);
    await fs.writeFile(path.join(target, GRAPHIFY_GRAPH_PATH), "not json\n");
    await assert.rejects(() => validateGraphFile(target), /valid JSON/);
    await fs.rm(path.join(target, GRAPHIFY_GRAPH_PATH));
    await assert.rejects(() => validateGraphFile(target), /does not exist/);

    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-graphify-outside-"));
    try {
      await fs.writeFile(path.join(outside, "graph.json"), "{}\n");
      await fs.rm(path.join(target, "graphify-out"), { recursive: true, force: true });
      await fs.symlink(outside, path.join(target, "graphify-out"));
      await assert.rejects(() => validateGraphFile(target), /graphify-out must not be a symlink/);
      const symlinkCalls = [];
      await assert.rejects(() => prepareGraphify(target, {
        silent: true,
        runner: async (...args) => symlinkCalls.push(args)
      }), /graphify-out must not be a symlink/);
      assert.deepEqual(symlinkCalls, []);
    } finally {
      await fs.rm(path.join(target, "graphify-out"), { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }

    const dryRunCalls = [];
    await prepareGraphify(target, {
      dryRun: true,
      silent: true,
      runner: async (...args) => dryRunCalls.push(args)
    });
    assert.deepEqual(dryRunCalls, []);

    const calls = [];
    const runner = async (command, args, options) => {
      calls.push([command, args, options]);
      if (command === "graphify" && args[0] === "extract") {
        await fs.mkdir(path.join(target, "graphify-out"), { recursive: true });
        await fs.writeFile(path.join(target, GRAPHIFY_GRAPH_PATH), "{}\n");
      }
      return { stdout: "ok" };
    };
    await prepareGraphify(target, { runner, silent: true });
    assert.deepEqual(calls.map(([command, args]) => [command, args]), [
      ["uv", ["--version"]],
      ["uv", ["python", "find", ">=3.10"]],
      ["uv", ["tool", "install", "--upgrade", "graphifyy[mcp]"]],
      ["graphify", ["--version"]],
      ["graphify-mcp", ["--version"]],
      ["graphify", ["extract", ".", "--code-only"]]
    ]);

    execFileSync("git", ["init"], { cwd: target, stdio: "ignore" });
    await fs.writeFile(path.join(target, GRAPHIFY_GRAPH_PATH), "{}\n");
    execFileSync("git", ["add", GRAPHIFY_GRAPH_PATH], { cwd: target, stdio: "ignore" });
    await assert.rejects(() => prepareGraphify(target, {
      runner: async () => { throw new Error("runner must not execute"); },
      silent: true
    }), /is tracked/);
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }

  const targetParent = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-graphify-missing-target-"));
  const missingTarget = path.join(targetParent, "workspace");
  const removeGraphifyStubs = await installGraphifyStubs();
  try {
    await generateMcp({ sourceRoot, target: missingTarget, profile: "research", yes: true, silent: true });
    await fs.access(path.join(missingTarget, ".mcp.json"));
  } finally {
    await removeGraphifyStubs();
    await fs.rm(targetParent, { recursive: true, force: true });
  }

  const failedTargetParent = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-graphify-failed-target-"));
  try {
    const failedTarget = path.join(failedTargetParent, "workspace");
    await assert.rejects(() => generateMcp({
      sourceRoot,
      target: failedTarget,
      profile: "research",
      yes: true,
      silent: true,
      graphifyRunner: async () => { throw new Error("expected Graphify failure"); }
    }), /required on PATH/);
    await assert.rejects(() => fs.lstat(failedTarget), { code: "ENOENT" });
  } finally {
    await fs.rm(failedTargetParent, { recursive: true, force: true });
  }

  const symlinkParent = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-graphify-symlink-target-"));
  const symlinkOutside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-graphify-symlink-outside-"));
  try {
    const symlinkTarget = path.join(symlinkParent, "workspace");
    await fs.symlink(symlinkOutside, symlinkTarget);
    const calls = [];
    await assert.rejects(() => generateMcp({
      sourceRoot,
      target: symlinkTarget,
      profile: "research",
      yes: true,
      silent: true,
      graphifyRunner: async (...args) => calls.push(args)
    }), /Target must not be a symlink/);
    assert.deepEqual(calls, []);
    await assert.rejects(() => fs.access(path.join(symlinkOutside, ".mcp.json")), { code: "ENOENT" });
  } finally {
    await fs.rm(symlinkParent, { recursive: true, force: true });
    await fs.rm(symlinkOutside, { recursive: true, force: true });
  }

  const rollbackTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-graphify-rollback-"));
  try {
    await fs.mkdir(path.join(rollbackTarget, ".claude", "settings.json"), { recursive: true });
    await fs.mkdir(path.join(rollbackTarget, "graphify-out"));
    await fs.writeFile(path.join(rollbackTarget, GRAPHIFY_GRAPH_PATH), "{\"original\":true}\n");
    await assert.rejects(() => generateMcp({
      sourceRoot,
      target: rollbackTarget,
      profile: "research",
      yes: true,
      silent: true,
      graphifyRunner: async (command, args) => {
        if (command === "graphify" && args[0] === "extract") {
          await fs.writeFile(path.join(rollbackTarget, GRAPHIFY_GRAPH_PATH), "{}\n");
        }
        return { stdout: "ok" };
      }
    }));
    await assert.rejects(() => fs.access(path.join(rollbackTarget, ".mcp.json")), { code: "ENOENT" });
    await assert.rejects(() => fs.access(path.join(rollbackTarget, ".gitignore")), { code: "ENOENT" });
    assert.equal(await fs.readFile(path.join(rollbackTarget, GRAPHIFY_GRAPH_PATH), "utf8"), "{\"original\":true}\n");
  } finally {
    await fs.rm(rollbackTarget, { recursive: true, force: true });
  }

  for (const [profile, expectedServers] of Object.entries(profiles)) {
    const profileTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-graphify-profile-"));
    try {
      const runner = async (command, args) => {
        if (command === "uv" && args[0] === "python") return { stdout: "/usr/bin/python3\n" };
        if (command === "graphify" && args[0] === "extract") {
          await fs.mkdir(path.join(profileTarget, "graphify-out"), { recursive: true });
          await fs.writeFile(path.join(profileTarget, GRAPHIFY_GRAPH_PATH), "{}\n");
        }
        return { stdout: "ok" };
      };
      await generateMcp({ sourceRoot, target: profileTarget, profile, yes: true, silent: true, graphifyRunner: runner });
      const settings = JSON.parse(await fs.readFile(path.join(profileTarget, ".claude", "settings.json"), "utf8"));
      const mcp = JSON.parse(await fs.readFile(path.join(profileTarget, ".mcp.json"), "utf8"));
      assert.deepEqual(settings.enabledMcpjsonServers, expectedServers);
      assert.deepEqual(Object.keys(mcp.mcpServers), expectedServers);
      assert.equal(await fs.readFile(path.join(profileTarget, ".gitignore"), "utf8"), ".mcp.json\ngraphify-out/\n");
    } finally {
      await fs.rm(profileTarget, { recursive: true, force: true });
    }
  }
}
