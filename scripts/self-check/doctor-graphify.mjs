import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { doctorProject } from "../lib/doctor.mjs";
import { GRAPHIFY_LAUNCHER_PATH, GRAPHIFY_MCP_ARGS, GRAPHIFY_MCP_COMMAND } from "../lib/graphify.mjs";

const enabledServers = ["context7", "tavily", "graphify"];

async function writeDoctorFixture(target, { profile = "research", lockServers = enabledServers, settingsServers = lockServers, mcpServers = null, graph = "{}\n", withMcpLock = true } = {}) {
  await fs.mkdir(path.join(target, ".claude"), { recursive: true });
  await fs.mkdir(path.join(target, ".repo-pattern"), { recursive: true });
  await fs.mkdir(path.join(target, "graphify-out"), { recursive: true });
  await fs.writeFile(path.join(target, ".claude", "settings.json"), JSON.stringify({ hooks: {}, enabledMcpjsonServers: settingsServers }));
  await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.json"), JSON.stringify({
    workflow: "none",
    runtime: { localSkills: false, localCommands: false, localHooks: false, localScripts: false, localRules: false }
  }));
  await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), JSON.stringify(
    withMcpLock ? { mcp: { profile, enabledServers: lockServers } } : {}
  ));
  await fs.writeFile(path.join(target, ".mcp.json"), JSON.stringify({ mcpServers: mcpServers || {
    context7: {},
    tavily: {},
    graphify: { command: GRAPHIFY_MCP_COMMAND, args: GRAPHIFY_MCP_ARGS }
  } }));
  await fs.writeFile(path.join(target, "graphify-out", "graph.json"), graph);
  await fs.writeFile(path.join(target, GRAPHIFY_LAUNCHER_PATH), "# Graphify MCP launcher\n");
}

async function withFixture(options, check) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-graphify-"));
  const logs = [];
  const originalLog = console.log;
  console.log = (line = "") => logs.push(String(line));
  try {
    await writeDoctorFixture(target, options);
    await check(target, logs);
  } finally {
    console.log = originalLog;
    await fs.rm(target, { recursive: true, force: true });
  }
}


const presentGraphifyMcp = async () => ({ stdout: "graphify-mcp 1.0.0\n" });
const missingGraphifyMcp = async () => { throw new Error("missing"); };

export async function runDoctorGraphifyChecks() {
  await withFixture({}, async (target) => {
    await doctorProject(target, { graphifyRunner: presentGraphifyMcp });
  });

  await withFixture({ withMcpLock: false }, async (target, logs) => {
    await assert.rejects(() => doctorProject(target, { graphifyRunner: presentGraphifyMcp }), /Doctor failed/);
    assert(logs.join("\n").includes("Recovery: repo-pattern mcp --profile web --yes"));
  });

  await withFixture({ settingsServers: ["tavily", "context7", "graphify"] }, async (target) => {
    await assert.rejects(() => doctorProject(target, { graphifyRunner: presentGraphifyMcp }), /Doctor failed/);
  });

  await withFixture({
    profile: "custom",
    lockServers: ["context7", "graphify"],
    mcpServers: {
      context7: {},
      graphify: { command: GRAPHIFY_MCP_COMMAND, args: GRAPHIFY_MCP_ARGS }
    }
  }, async (target) => {
    await doctorProject(target, { graphifyRunner: presentGraphifyMcp });
  });

  await withFixture({
    profile: "custom",
    lockServers: ["context7", "unknown", "graphify"],
    settingsServers: ["context7", "unknown", "graphify"],
    mcpServers: {
      context7: {},
      unknown: {},
      graphify: { command: GRAPHIFY_MCP_COMMAND, args: GRAPHIFY_MCP_ARGS }
    }
  }, async (target, logs) => {
    await assert.rejects(() => doctorProject(target, { graphifyRunner: presentGraphifyMcp }), /Doctor failed/);
    assert(logs.join("\n").includes("Recovery: repo-pattern mcp --profile web --yes"));
    assert(!logs.join("\n").includes("secret-value"));
  });

  await withFixture({
    profile: "retired",
    lockServers: ["context7", "unknown"],
    mcpServers: { context7: {}, unknown: {} }
  }, async (target, logs) => {
    await assert.rejects(() => doctorProject(target, { graphifyRunner: presentGraphifyMcp }), /Doctor failed/);
    assert(logs.join("\n").includes("Recovery: repo-pattern mcp --profile web --yes"));
    assert(!logs.join("\n").includes("secret-value"));
  });

  await withFixture({ mcpServers: {
    context7: {},
    tavily: {},
    graphify: { command: GRAPHIFY_MCP_COMMAND, args: GRAPHIFY_MCP_ARGS },
    foreign: {}
  } }, async (target) => {
    await assert.rejects(() => doctorProject(target, { graphifyRunner: presentGraphifyMcp }), /Doctor failed/);
  });

  await withFixture({}, async (target, logs) => {
    await assert.rejects(() => doctorProject(target, { graphifyRunner: missingGraphifyMcp }), /Doctor failed/);
    assert(logs.join("\n").includes("Recovery: repo-pattern mcp --profile research"));
    assert(!logs.join("\n").includes("secret-value"));
  });

  await withFixture({}, async (target) => {
    await fs.rm(path.join(target, "graphify-out", "graph.json"));
    await assert.rejects(() => doctorProject(target, { graphifyRunner: presentGraphifyMcp }), /Doctor failed/);
  });

  await withFixture({ graph: "not json\n" }, async (target) => {
    await assert.rejects(() => doctorProject(target, { graphifyRunner: presentGraphifyMcp }), /Doctor failed/);
  });

  await withFixture({}, async (target) => {
    const graph = path.join(target, "graphify-out", "graph.json");
    await fs.rm(graph);
    await fs.symlink(path.join(target, "untrusted.json"), graph);
    await assert.rejects(() => doctorProject(target, { graphifyRunner: presentGraphifyMcp }), /Doctor failed/);
  });

  await withFixture({}, async (target) => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-graphify-outside-"));
    try {
      await fs.writeFile(path.join(outside, "graph.json"), "{}\n");
      await fs.rm(path.join(target, "graphify-out"), { recursive: true, force: true });
      await fs.symlink(outside, path.join(target, "graphify-out"));
      const calls = [];
      await assert.rejects(() => doctorProject(target, {
        graphifyRunner: async (...args) => calls.push(args)
      }), /Doctor failed/);
      assert.deepEqual(calls, []);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  await withFixture({ mcpServers: {
    context7: {},
    tavily: {},
    graphify: { command: "graphify", args: GRAPHIFY_MCP_ARGS }
  } }, async (target) => {
    await assert.rejects(() => doctorProject(target, { graphifyRunner: presentGraphifyMcp }), /Doctor failed/);
  });

  await withFixture({ mcpServers: {
    context7: {},
    tavily: {},
    graphify: { command: "graphify-mcp", args: [] }
  } }, async (target) => {
    await assert.rejects(() => doctorProject(target, { graphifyRunner: presentGraphifyMcp }), /Doctor failed/);
  });

  await withFixture({}, async (target, logs) => {
    await fs.writeFile(path.join(target, ".mcp.json"), "not json\n");
    await assert.rejects(() => doctorProject(target, { graphifyRunner: presentGraphifyMcp }), /Doctor failed/);
    assert(logs.join("\n").includes("Recovery: repo-pattern mcp --profile research"));
  });
}
