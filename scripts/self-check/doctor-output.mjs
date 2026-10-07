import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { doctorProject } from "../lib/doctor.mjs";

import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const cliPath = path.join(repoRoot, "scripts", "repo-pattern.mjs");

function runCli(args, env = process.env) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: repoRoot, env, encoding: "utf8" });
}

export async function runDoctorOutputChecks() {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-doctor-output-"));
  try {
    const before = await fs.readdir(target);
    let output = [];
    const previousLog = console.log;
    console.log = (line = "") => output.push(String(line));
    try {
      await assert.rejects(() => doctorProject(target), /Doctor failed/);
      assert(output.join("\n").includes("Workspace"));
      assert(output.join("\n").includes("FAIL"));
      assert(output.join("\n").includes("Repair:"));
      assert(output.join("\n").includes("Information"));
      assert(!output.join("\n").includes("Warnings and information"));
      output = [];
      await assert.rejects(() => doctorProject(target, { verbose: true }), /Doctor failed/);
      const verboseText = output.join("\n");
      assert(verboseText.includes("Detailed checks"));
      assert.equal((verboseText.match(/✗ \.claude exists/g) || []).length, 2);
      const summaryCounts = [...verboseText.matchAll(/(?:Workspace|Settings & MCP|ECC|gstack)  (?:PASS|WARN|FAIL|N\/A) · (\d+) passed, (\d+) failed, (\d+) total/g)];
      assert.equal(summaryCounts.length, 4);
      assert.equal(summaryCounts.reduce((sum, [, , , total]) => sum + Number(total), 0), 19);
      output = [];
      await assert.rejects(() => doctorProject(target, { silent: true, verbose: true }), /Doctor failed/);
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
