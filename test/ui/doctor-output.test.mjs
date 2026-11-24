import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { doctorProject } from "../../src/doctor.mjs";
import { printAudit, printDoctor, renderDoctor } from "../../src/ui/reports.mjs";

import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const cliPath = path.join(repoRoot, "bin", "repo-pattern.mjs");

function runCli(args, env = process.env) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: repoRoot, env, encoding: "utf8" });
}

test("doctor output contracts preserve failure, verbose, silent, and CLI behavior", async () => {
  // protects=doctor failure output, verbose detail counts, silent mode, CLI status, target quoting, and no-write behavior; fails_when=diagnostics disappear, silent mode emits output, or CLI output/status changes; no_claim=exact ANSI bytes or successful live workspace health.
  await runDoctorOutputChecks();
});

test("renderDoctor and printAudit cover warnings, repair guidance, and verbose checks", () => {
  const output = [];
  const previousLog = console.log;
  console.log = (line = "") => output.push(String(line));
  try {
    renderDoctor({
      target: "/tmp/project\u0000'", setupPipeline: "both", verbose: true,
      checks: [
        { group: "Workspace", label: ".repo-pattern/.repo-pattern.json missing", ok: false, reason: "metadata missing" },
        { group: "Settings & MCP", label: ".mcp.json missing", ok: true },
        { group: "ECC", label: "ECC plugin installation is required", ok: true }
      ],
      infoRows: ["browser skipped", "Project permissions.defaultMode=bypassPermissions", "normal information"]
    });
    const doctorText = output.join("\n");
    assert.match(doctorText, /FAIL/);
    assert.match(doctorText, /Initialize repo-pattern/);
    assert.doesNotMatch(doctorText, /\u0000/);
    assert.match(doctorText, /Warnings/);
    assert.match(doctorText, /Detailed checks/);

    output.length = 0;
    printAudit({
      target: "/tmp/audit", state: "PARTIAL", hasClaudeDir: false, hasMcpJson: false,
      hasRepoPatternJson: false, hasHardcodedMcpPath: true, hasSettingsLocalTracked: true,
      hasSettingsHooks: true, repoPattern: { workflow: "none" }, gstack: null,
      hasClaudeSkillsDir: true, hasOnlyManagedSkills: false, hasClaudeCommandsDir: true,
      hasClaudeHooksDir: true, hasClaudeScriptsDir: true, hasClaudeRulesDir: true,
      hasOnlyEccRulesDir: false, hasClaudeEccRulesDir: true, hasManagedEccRules: false,
      hasManagedEccAgents: true, hasClaudeAgentsDir: false
    });
    const auditText = output.join("\n");
    assert.match(auditText, /hardcoded machine path/);
    assert.match(auditText, /settings\.local\.json tracked/);
    assert.match(auditText, /\.claude\/commands present/);
    assert.match(auditText, /\.claude\/agents is missing/);
  } finally {
    console.log = previousLog;
  }
});

test("doctor updates lock metadata without mutating on dry-run", async () => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-lock-"));
  try {
    const setup = runCli(["setup", "--target", target, "--setup-pipeline", "none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr);
    const lockPath = path.join(target, ".repo-pattern", ".repo-pattern.lock.json");
    const before = JSON.parse(await fs.readFile(lockPath, "utf8"));
    await doctorProject(target, { updateLock: true, dryRun: true, silent: true });
    const afterDryRun = JSON.parse(await fs.readFile(lockPath, "utf8"));
    assert.deepEqual(afterDryRun, before);
    await doctorProject(target, { updateLock: true, silent: true });
    const after = JSON.parse(await fs.readFile(lockPath, "utf8"));
    assert.match(after.repoPattern.lastDoctorRun, /^20\d\d-\d\d-\d\dT/);
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("doctor reports MCP drift and manual ECC plugin guidance", async () => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-drift-"));
  try {
    const setup = runCli(["setup", "--target", target, "--setup-pipeline", "none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr);
    const configPath = path.join(target, ".repo-pattern", ".repo-pattern.json");
    const lockPath = path.join(target, ".repo-pattern", ".repo-pattern.lock.json");
    const settingsPath = path.join(target, ".claude", "settings.json");
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    config.workflow = "ecc-native";
    await fs.writeFile(configPath, JSON.stringify(config));
    const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
    lock.ecc = { status: "manual-plugin-install-required" };
    lock.mcp = { enabledServers: ["context7"] };
    await fs.writeFile(lockPath, JSON.stringify(lock));
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    settings.enabledMcpjsonServers = [];
    await fs.writeFile(settingsPath, JSON.stringify(settings));
    const report = [];
    await assert.rejects(
      () => doctorProject(target, { output: { doctor: (value) => report.push(value) } }),
      /Doctor failed/
    );
    assert.equal(report.length, 1);
    assert(report[0].checks.some((check) => check.label.includes("enabledMcpjsonServers matches")));
    assert(report[0].infoRows.includes("ECC plugin installation is required; open Claude Code and run:"));
    assert(report[0].infoRows.includes("/plugin install ecc@ecc"));
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("doctor rejects symlinked lock state before auditing the workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-symlink-"));
  const target = path.join(root, "target");
  const outside = path.join(root, "outside");
  try {
    await fs.mkdir(path.join(target, ".repo-pattern"), { recursive: true });
    await fs.writeFile(outside, "private state");
    await fs.rm(path.join(target, ".repo-pattern"), { recursive: true });
    await fs.symlink(outside, path.join(target, ".repo-pattern"));
    await assert.rejects(() => doctorProject(target, { silent: true }), /must not be a symlink/);
    assert.equal(await fs.readFile(outside, "utf8"), "private state");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

export async function runDoctorOutputChecks() {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-output-"));
  try {
    const before = await fs.readdir(target);
    let output = [];
    const previousLog = console.log;
    console.log = (line = "") => output.push(String(line));
    try {
      await assert.rejects(() => doctorProject(target, { output: { doctor: printDoctor } }), /Doctor failed/);
      assert(output.join("\n").includes("Workspace"));
      assert(output.join("\n").includes("FAIL"));
      assert(output.join("\n").includes("Repair:"));
      assert(output.join("\n").includes("Information"));
      assert(!output.join("\n").includes("Warnings and information"));
      output = [];
      await assert.rejects(() => doctorProject(target, { verbose: true, output: { doctor: printDoctor } }), /Doctor failed/);
      const verboseText = output.join("\n");
      assert(verboseText.includes("Detailed checks"));
      assert.equal((verboseText.match(/✗ \.claude exists/g) || []).length, 2);
      const summaryCounts = [...verboseText.matchAll(/(?:Workspace|Settings & MCP|ECC|gstack)  (?:PASS|WARN|FAIL|N\/A) · (\d+) passed, (\d+) failed, (\d+) total/g)];
      assert.equal(summaryCounts.length, 4);
      assert.equal(summaryCounts.reduce((sum, [, , , total]) => sum + Number(total), 0), 19);
      output = [];
      await assert.rejects(() => doctorProject(target, { silent: true, verbose: true, output: { doctor: printDoctor } }), /Doctor failed/);
      assert.deepEqual(output, []);
      assert.deepEqual(await fs.readdir(target), before);
    } finally {
      console.log = previousLog;
    }

    const wrongCommand = runCli(["audit", "--verbose"]);
    assert.equal(wrongCommand.status, 2);
    const help = runCli(["help"]);
    assert.match(help.stdout, /doctor \[--target <path>\] \[--verbose\]/);
    const plain = runCli(["doctor", "--target", target], { ...process.env, CI: "1", NO_COLOR: "1", TERM: "dumb" });
    assert.notEqual(plain.status, 0);
    assert.doesNotMatch(plain.stdout, /\x1b\[/);
    const verbose = runCli(["doctor", "--target", target, "--verbose"]);
    assert.notEqual(verbose.status, 0);
    assert.match(verbose.stdout, /Detailed checks/);
    assert.match(verbose.stdout, /Repair:/);
    const quoted = await fs.mkdtemp(path.join(os.tmpdir(), "doctor space ' quote-"));
    try {
      const result = runCli(["doctor", "--target", quoted]);
      assert.notEqual(result.status, 0);
      assert(result.stdout.includes(quoted));
    } finally {
      await fs.rm(quoted, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
}
