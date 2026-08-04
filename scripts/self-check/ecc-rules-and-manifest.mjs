import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditProject } from "../lib/audit.mjs";
import { doctorProject } from "../lib/doctor.mjs";
import { ECC_RULE_PACKS, explainRules, invalidEccRules, normalizeEccRules, selectEccRules } from "../lib/ecc-rules.mjs";
import { applyEccRules, buildAgentManifest, clearEccRules, validateAgentManifest } from "../lib/rules.mjs";

const originalDoctorLog = console.log;

export async function runEccRulesAndManifestChecks() {
  assert.match(explainRules({}, ["common"]), /Selected ECC rules/);
  assert.match(explainRules({}, ["common"]), /Detected stack/);
  assert.deepEqual(normalizeEccRules(["python", "common", "python", "unknown"]), ["python", "common"]);
  assert.deepEqual(invalidEccRules(["common", "unknown", "unknown"]), ["unknown"]);
  assert.deepEqual(selectEccRules({ languages: ["python", "typescript"], frameworks: ["nuxt"], tools: [], repoType: "fullstack" }), ["common", "nuxt", "python", "typescript", "vue", "web"]);
  assert.equal(ECC_RULE_PACKS[0], "common");
  assert.equal(ECC_RULE_PACKS.at(-1), "web");

async function writeDoctorFixture(target, { appliedRules = ["typescript"], createRuleDirs = true } = {}) {
  await fs.mkdir(path.join(target, ".claude"), { recursive: true });
  await fs.mkdir(path.join(target, ".repo-pattern"), { recursive: true });
  await fs.mkdir(path.join(target, "graphify-out"), { recursive: true });
  await fs.writeFile(path.join(target, ".claude", "settings.json"), JSON.stringify({
    hooks: {},
    enabledMcpjsonServers: ["context7", "tavily", "graphify"]
  }), "utf8");
  await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.json"), JSON.stringify({
    workflow: "ecc-native",
    runtime: {
      localSkills: false,
      localCommands: false,
      localHooks: false,
      localScripts: false,
      localRules: false
    }
  }), "utf8");
  await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), JSON.stringify({
    mcp: {
      profile: "research",
      enabledServers: ["context7", "tavily", "graphify"]
    },
    ecc: {
      status: "not-run",
      rulesSyncedBy: "repo-pattern-auto-cache",
      appliedRules
    }
  }), "utf8");
  await fs.writeFile(path.join(target, ".mcp.json"), JSON.stringify({ mcpServers: {
    context7: {},
    tavily: {},
    graphify: { command: "graphify-mcp", args: ["graphify-out/graph.json"] }
  } }), "utf8");
  await fs.writeFile(path.join(target, "graphify-out", "graph.json"), "{}\n", "utf8");
  if (createRuleDirs) {
    for (const rule of appliedRules) await fs.mkdir(path.join(target, ".claude", "rules", "ecc", rule), { recursive: true });
  }
}

const doctorTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-"));
const originalDoctorLog = console.log;
console.log = () => {};
try {
  await writeDoctorFixture(doctorTarget);
  const audit = await auditProject(doctorTarget);
  assert.deepEqual(audit.eccRulePackDirs, ["typescript"]);
  await doctorProject(doctorTarget);
} finally {
  console.log = originalDoctorLog;
  await fs.rm(doctorTarget, { recursive: true, force: true });
}

const missingRulesTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-missing-"));
console.log = () => {};
try {
  await writeDoctorFixture(missingRulesTarget, { createRuleDirs: false });
  await assert.rejects(() => doctorProject(missingRulesTarget), /Doctor failed/);
} finally {
  console.log = originalDoctorLog;
  await fs.rm(missingRulesTarget, { recursive: true, force: true });
}

const emptyRulesTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-empty-"));
console.log = () => {};
try {
  await writeDoctorFixture(emptyRulesTarget, { appliedRules: [] });
  await assert.rejects(() => doctorProject(emptyRulesTarget), /Doctor failed/);
} finally {
  console.log = originalDoctorLog;
  await fs.rm(emptyRulesTarget, { recursive: true, force: true });
}

async function writeManagedAgentDoctorFixture(target) {
  await writeDoctorFixture(target);
  const agentsRoot = path.join(target, ".claude", "agents");
  await fs.mkdir(agentsRoot, { recursive: true });
  await fs.writeFile(path.join(agentsRoot, "agent.md"), "agent", "utf8");
  const lockPath = path.join(target, ".repo-pattern", ".repo-pattern.lock.json");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.ecc = {
    ...lock.ecc,
    agentsSyncedBy: "repo-pattern-auto-cache",
    agentsSource: "https://github.com/affaan-m/ECC.git",
    agentsRevision: "a".repeat(40),
    appliedAgents: await buildAgentManifest(agentsRoot)
  };
  await fs.writeFile(lockPath, JSON.stringify(lock), "utf8");
  return { agentsRoot, lockPath };
}

for (const { name, mutate } of [
  { name: "missing directory", mutate: async ({ agentsRoot }) => fs.rm(agentsRoot, { recursive: true, force: true }) },
  { name: "empty directory", mutate: async ({ agentsRoot }) => fs.rm(path.join(agentsRoot, "agent.md")) },
  { name: "invalid synchronizer", mutate: async ({ lock }) => { lock.ecc.agentsSyncedBy = "manual"; } },
  { name: "invalid source", mutate: async ({ lock }) => { lock.ecc.agentsSource = "https://example.com/ECC.git"; } },
  { name: "invalid revision", mutate: async ({ lock }) => { lock.ecc.agentsRevision = "not-a-revision"; } },
  { name: "invalid manifest path", mutate: async ({ lock }) => { lock.ecc.appliedAgents[0].path = "../agent.md"; } }
]) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-agents-"));
  console.log = () => {};
  try {
    const fixture = await writeManagedAgentDoctorFixture(target);
    const lock = JSON.parse(await fs.readFile(fixture.lockPath, "utf8"));
    await mutate({ ...fixture, lock });
    await fs.writeFile(fixture.lockPath, JSON.stringify(lock), "utf8");
    await assert.rejects(() => doctorProject(target), /Doctor failed/, name);
  } finally {
    console.log = originalDoctorLog;
    await fs.rm(target, { recursive: true, force: true });
  }
}

const pythonRulesTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-python-rules-"));
console.log = () => {};
try {
  await fs.mkdir(path.join(pythonRulesTarget, ".claude"), { recursive: true });
  await writeDoctorFixture(pythonRulesTarget, { appliedRules: ["common", "python"], createRuleDirs: true });
  await fs.writeFile(path.join(pythonRulesTarget, ".mcp.json"), JSON.stringify({ mcpServers: {
    context7: {},
    tavily: {},
    graphify: { command: "graphify-mcp", args: ["graphify-out/graph.json"] }
  } }), "utf8");
  await fs.writeFile(path.join(pythonRulesTarget, "pyproject.toml"), "", "utf8");
  await fs.writeFile(path.join(pythonRulesTarget, ".claude", "CLAUDE.md"), "Existing guidance\n", "utf8");
  const pythonEccCache = path.join(pythonRulesTarget, ".repo-pattern", "cache", "ECC");
  for (const rule of ["common", "python"]) {
    await fs.mkdir(path.join(pythonEccCache, "rules", rule), { recursive: true });
  }
  await fs.mkdir(path.join(pythonEccCache, "agents", "nested"), { recursive: true });
  await fs.writeFile(path.join(pythonEccCache, "agents", "A.md"), "upper", "utf8");
  await fs.writeFile(path.join(pythonEccCache, "agents", "a.md"), "lower", "utf8");
  await fs.writeFile(path.join(pythonEccCache, "agents", "nested", "agent.md"), "agent", "utf8");
  spawnSync("git", ["init"], { cwd: pythonEccCache, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: pythonEccCache, stdio: "ignore" });
  spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "fixture"], { cwd: pythonEccCache, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/affaan-m/ECC.git"], { cwd: pythonEccCache, stdio: "ignore" });
  await applyEccRules({ target: pythonRulesTarget });
  let claudeMd = await fs.readFile(path.join(pythonRulesTarget, ".claude", "CLAUDE.md"), "utf8");
  assert.match(claudeMd, /`uv run` owns `\.venv`/);
  assert.match(claudeMd, /Existing guidance/);
  const agentLock = JSON.parse(await fs.readFile(path.join(pythonRulesTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  assert.equal(agentLock.ecc.agentsSource, "https://github.com/affaan-m/ECC.git");
  assert.match(agentLock.ecc.agentsRevision, /^[a-f0-9]{40}$/);
  assert.deepEqual(agentLock.ecc.appliedAgents.map((entry) => entry.path), ["A.md", "a.md", "nested/agent.md"]);
  await fs.access(path.join(pythonRulesTarget, ".claude", "agents", "nested", "agent.md"));
  await assert.rejects(() => fs.access(path.join(pythonRulesTarget, ".claude", "skills", "ecc")), { code: "ENOENT" });
  await doctorProject(pythonRulesTarget);
  await fs.writeFile(path.join(pythonRulesTarget, ".claude", "agents", "extra.md"), "extra", "utf8");
  await assert.rejects(() => doctorProject(pythonRulesTarget), /Doctor failed/);
  await fs.rm(path.join(pythonRulesTarget, ".claude", "agents", "extra.md"));
  await fs.writeFile(path.join(pythonRulesTarget, ".claude", "agents", "nested", "agent.md"), "changed", "utf8");
  await assert.rejects(() => doctorProject(pythonRulesTarget), /Doctor failed/);
  await fs.writeFile(path.join(pythonRulesTarget, ".claude", "agents", "nested", "agent.md"), "agent", "utf8");

  for (const rule of ["common", "python"]) {
    await fs.mkdir(path.join(pythonEccCache, "rules", rule), { recursive: true });
  }
  await fs.mkdir(path.join(pythonEccCache, "agents", "nested"), { recursive: true });
  await fs.writeFile(path.join(pythonEccCache, "agents", "A.md"), "upper", "utf8");
  await fs.writeFile(path.join(pythonEccCache, "agents", "a.md"), "lower", "utf8");
  await fs.writeFile(path.join(pythonEccCache, "agents", "nested", "agent.md"), "agent", "utf8");
  spawnSync("git", ["init"], { cwd: pythonEccCache, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: pythonEccCache, stdio: "ignore" });
  spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "fixture"], { cwd: pythonEccCache, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/affaan-m/ECC.git"], { cwd: pythonEccCache, stdio: "ignore" });
  await applyEccRules({ target: pythonRulesTarget });
  claudeMd = await fs.readFile(path.join(pythonRulesTarget, ".claude", "CLAUDE.md"), "utf8");
  assert.equal(claudeMd.split("<!-- USE UV:Start -->").length - 1, 1);

  await clearEccRules({ target: pythonRulesTarget });
  const clearedConfig = JSON.parse(await fs.readFile(path.join(pythonRulesTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  const clearedLock = JSON.parse(await fs.readFile(path.join(pythonRulesTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  await fs.access(path.join(pythonRulesTarget, ".claude", "agents", "nested", "agent.md"));
  await assert.rejects(() => fs.access(path.join(pythonRulesTarget, ".claude", "rules", "ecc")), { code: "ENOENT" });
  assert.equal(clearedConfig.ecc.rulesSync, undefined);
  assert.equal(clearedLock.ecc.rulesSyncedBy, null);
  assert.deepEqual(clearedLock.ecc.appliedRules, []);
  assert.equal(clearedLock.ecc.agentsSyncedBy, undefined);
  assert.equal(clearedLock.ecc.agentsSource, undefined);
  assert.equal(clearedLock.ecc.agentsRevision, undefined);
  assert.equal(clearedLock.ecc.appliedAgents, undefined);
} finally {
  console.log = originalDoctorLog;
  await fs.rm(pythonRulesTarget, { recursive: true, force: true });
}
}
