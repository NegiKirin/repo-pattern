import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject, printAudit } from "../lib/audit.mjs";
import { cleanupProject } from "../lib/cleanup.mjs";
import { doctorProject } from "../lib/doctor.mjs";
import { ECC_PLUGIN, applyEccPluginSettings, setupEcc } from "../lib/ecc.mjs";
import { ensureBun, gstackEnvironment, gstackSummaryRows, isValidBunInstaller, removeEccPluginSettings, runGstackSetup, setupGstack } from "../lib/gstack.mjs";
import { applyMcpValues, generateMcp, mcpSecretPrompt, persistedMcpValues, readGeneratedMcpValues, validateRelativeMcpPath } from "../lib/mcp.mjs";
import { applyAttributionSetting, applyLocalSettings, applyPermissionSettings, provisionProject, reconcileLocalPluginSettings, setupPipelineScope, updateClaudePermissions } from "../lib/provision.mjs";
import { writePrivateJson } from "../lib/fs-utils.mjs";
import { printSummary, renderLogo, style } from "../lib/prompt.mjs";
import { needsLocalSettingsPrompt, setupProject, setupRetryOptions } from "../lib/setup.mjs";
import { applyEccRules, buildAgentManifest, clearEccRules, formatEccCloneError, hasGitUpstream, validateAgentManifest } from "../lib/rules.mjs";
import { applyOptionalSkills, applyPluginSkillSettings, expectedOptionalSkillDirs, invalidOptionalSkills, normalizeOptionalSkills, OPTIONAL_SKILLS } from "../lib/skills.mjs";
const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const cliPath = path.join(cliDir, "..", "repo-pattern.mjs");
const secretSentinel = "do-not-persist-anthropic-token";

const originalLog = console.log;

export async function runGstackChecks() {
const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
const gitignore = await fs.readFile(path.join(repoRoot, ".gitignore"), "utf8");
const gitignoreLines = gitignore.split(/\r?\n/);
assert(!packageJson.files.includes(".repo-pattern.lock.json"));
assert(!packageJson.files.includes(".repo-pattern.json"));
assert(packageJson.files.includes(".repo-pattern.example.json"));
assert(packageJson.files.includes(".claude.example/CLAUDE.md"));
assert(packageJson.files.includes(".claude.example/settings.example.json"));
assert(packageJson.files.includes(".claude.example/settings.local.example.json"));
assert(!packageJson.files.some((file) => file.startsWith(".claude/")));
assert(gitignoreLines.includes(".repo-pattern/"));
assert(!gitignoreLines.includes(".repo-pattern.json"));
assert(!gitignoreLines.includes(".repo-pattern.lock.json"));
assert(gitignoreLines.includes(".claude/"));

assert.deepEqual(gstackEnvironment("bun", { PATH: "/usr/bin" }), { PATH: "/usr/bin" });
assert.deepEqual(gstackEnvironment("/home/test/.bun/bin/bun", { PATH: "/usr/bin" }), { PATH: `/home/test/.bun/bin${path.delimiter}/usr/bin` });
assert.deepEqual(gstackSummaryRows(), [
  ["Scope", "user-global ~/.claude/skills/gstack"],
  ["Plan-tune hooks", "not installed"],
  ["Status", "ready"]
]);
assert.deepEqual(gstackSummaryRows(true), [
  ["Scope", "user-global ~/.claude/skills/gstack"],
  ["Plan-tune hooks", "installed in ~/.claude/settings.json"],
  ["Status", "ready"]
]);

const gstackSetupCalls = [];
const gstackSetupLogs = [];
runGstackSetup({
  platform: "linux",
  bun: "bun",
  run(command, args, options) {
    gstackSetupCalls.push({ command, args, options });
    return "generated skill output\ninstallation detail\n";
  },
  log: (message) => gstackSetupLogs.push(message)
});
assert.deepEqual(gstackSetupCalls[0].args, ["--quiet", "--no-plan-tune-hooks"]);
assert.deepEqual(gstackSetupCalls[0].options.stdio, ["ignore", "pipe", "pipe"]);
assert.deepEqual(gstackSetupLogs, []);

runGstackSetup({
  platform: "linux",
  bun: "bun",
  planTuneHooks: true,
  run(command, args) {
    gstackSetupCalls.push({ command, args });
  }
});
assert.deepEqual(gstackSetupCalls[1].args, ["--quiet", "--plan-tune-hooks"]);

const gstackCredentialFixture = ["example", "credential", "value"].join("-");
const gstackFailure = Object.assign(new Error("setup failed"), {
  stdout: Buffer.from("routine output\n"),
  stderr: Buffer.from(`${"warning: repeated diagnostic line\n".repeat(300)}fatal: setup could not complete\nAuthorization: Bearer ${gstackCredentialFixture}\nAPI_TOKEN=${gstackCredentialFixture}\ncorrect the prerequisite and retry\n`)
});
let gstackFailureLog = "";
assert.throws(() => runGstackSetup({
  platform: "win32",
  bun: "bun",
  run(command, args) {
    assert.equal(command, "bash");
    assert.deepEqual(args, ["./setup", "--quiet", "--no-plan-tune-hooks"]);
    throw gstackFailure;
  },
  log: (message) => { gstackFailureLog += `${message}\n`; }
}), /gstack setup failed; review the diagnostics above and rerun setup/);
assert.match(gstackFailureLog, /Upstream reported a setup failure/);
assert.match(gstackFailureLog, /A required prerequisite is missing or invalid/);
assert.match(gstackFailureLog, /Correct the reported prerequisite and rerun setup/);
assert.match(gstackFailureLog, /Upstream output: \[redacted\]/);
assert.doesNotMatch(gstackFailureLog, /routine output/);
assert.doesNotMatch(gstackFailureLog, /fatal: setup could not complete/);
assert.doesNotMatch(gstackFailureLog, new RegExp(gstackCredentialFixture));
assert(gstackFailureLog.length <= 4200);

const validBunInstaller = Buffer.from(`#!/usr/bin/env bash
set -euo pipefail
install_env=BUN_INSTALL
github_repo="\$GITHUB/oven-sh/bun"
bun_uri=\$github_repo/releases/latest/download/bun-\$target.zip
${"# Bun installer\n".repeat(80)}`);
assert.equal(isValidBunInstaller(validBunInstaller), true);
assert.equal(isValidBunInstaller(Buffer.from("<!doctype html><title>502 Bad Gateway</title>")), false);
assert.equal(isValidBunInstaller(Buffer.from("#!/usr/bin/env bash\nset -euo pipefail\n")), false);

const bunInstallCommands = [];
let bunCheckCount = 0;
let removedBunInstaller = false;
const installedBun = await ensureBun({
  platform: "linux",
  homedir: "/home/test",
  tmpdir: "/tmp",
  run(command, args, options) {
    bunInstallCommands.push({ command, args, options });
    if (command === "bun" && bunCheckCount++ === 0) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    if (command === "/home/test/.bun/bin/bun") return "1.2.0\n";
    return "";
  },
  mkdtemp: async () => "/tmp/repo-pattern-bun-installer",
  readFile: async () => validBunInstaller,
  rm: async () => { removedBunInstaller = true; }
});
assert.equal(installedBun, "/home/test/.bun/bin/bun");
assert.deepEqual(bunInstallCommands[1].args, [
  "--fail", "--show-error", "--silent", "--location",
  "--proto", "=https", "--proto-redir", "=https", "--tlsv1.2",
  "--max-filesize", "1048576", "--output", "/tmp/repo-pattern-bun-installer/install.sh",
  "https://bun.sh/install"
]);
assert.deepEqual(bunInstallCommands[2].args, ["-n", "/tmp/repo-pattern-bun-installer/install.sh"]);
assert.deepEqual(bunInstallCommands[3].args, ["/tmp/repo-pattern-bun-installer/install.sh"]);
assert.equal(removedBunInstaller, true);
await assert.rejects(() => ensureBun({ platform: "win32", run: () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } }), /automatic Bun installation is supported only on Linux and macOS/);
await assert.rejects(() => ensureBun({
  platform: "linux",
  run(command) {
    if (command === "bun") throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return "";
  },
  mkdtemp: async () => "/tmp/repo-pattern-invalid-bun-installer",
  readFile: async () => Buffer.from("<!doctype html><title>502 Bad Gateway</title>"),
  rm: async () => {}
}), /failed content validation/);

}
