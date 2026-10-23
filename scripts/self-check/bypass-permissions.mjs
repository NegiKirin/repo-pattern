import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runInteractiveSetupCase } from "./bypass-permissions-interactive.mjs";
import { claudeVersionSupportsUserScope, setUserBypassPermission } from "../lib/bypass-permissions.mjs";
import { auditProject } from "../lib/audit.mjs";
import { doctorProject } from "../lib/doctor.mjs";
import { provisionProject } from "../lib/provision.mjs";
import { choosePermissionConfig, localSettingsPromptOptions, setupOptionsFromLock, setupRetryOptions } from "../lib/setup.mjs";

export async function runBypassPermissionChecks() {
  // Value: protects=simulated-TTY setup routing for new-install and legacy bypass acceptance, decline, and malformed-settings rejection; fails_when=setup writes bypass to the wrong scope, loses legacy intent on decline, or overwrites malformed settings; why_new=direct helper checks cannot cover actual setup/wizard routing; seam=none; no_claim=physical TTY behavior and real operator HOME are not exercised.
  assert.equal(claudeVersionSupportsUserScope("2.1.256"), false);
  assert.equal(claudeVersionSupportsUserScope("2.1.257"), true);
  assert.equal(claudeVersionSupportsUserScope("unknown"), false);
  assert.equal(localSettingsPromptOptions({ ANTHROPIC_BASE_URL: "not-a-url" }, {}).ANTHROPIC_BASE_URL.initial, "");
  assert.equal(localSettingsPromptOptions({}, { ANTHROPIC_BASE_URL: "https://provider.example/v1" }).ANTHROPIC_BASE_URL.initial, "https://provider.example/v1");
  const retrySecrets = setupRetryOptions({
    action: "setup", setupPipeline: "none", mcpConfig: { mcpServers: [] },
    ruleConfig: { applyRules: false, ruleMode: "auto", rules: [] }, optionalSkills: [],
    localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: "secret", CONTEXT7_API_KEY: "secret", TAVILY_API_KEY: "secret", ANTHROPIC_BASE_URL: "https://provider.example/v1" },
    attributionConfig: { mode: "off" }
  });
  assert.deepEqual(retrySecrets.localSettingsEnv, { ANTHROPIC_BASE_URL: "https://provider.example/v1" });

  const retryOptions = setupRetryOptions({
    action: "setup", setupPipeline: "none", mcpConfig: { mcpServers: [] },
    ruleConfig: { applyRules: false, ruleMode: "auto", rules: [] }, optionalSkills: [],
    localSettingsEnv: {}, attributionConfig: { mode: "off" }, permissionConfig: { bypass: "user" }
  });
  assert.deepEqual(setupOptionsFromLock({ setup: { status: "failed", options: retryOptions } }).permissionConfig, { bypass: "user" });
  assert.deepEqual(setupOptionsFromLock({ setup: { status: "running", options: retryOptions } }).permissionConfig, { bypass: "user" });
  assert.deepEqual(setupOptionsFromLock({ setup: { status: "failed", options: { ...retryOptions, permissionConfig: { bypass: "invalid" } } } }).permissionConfig, { bypass: "deny" });

  const warn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));
  const confirm = async () => true;
  try {
    let declinedMigrationConfirmations = 0;
    let declinedMigrationWrites = 0;
    const declinedMigration = await choosePermissionConfig({
      claudeCodeVersion: "2.1.257", migrationChoice: "no", legacyBypass: true, selectedBypass: "deny",
      confirm: async () => { declinedMigrationConfirmations++; return true; },
      setUserBypass: async () => { declinedMigrationWrites++; return { changed: true }; }
    });
    assert.deepEqual(declinedMigration, { bypass: "preserve" });
    assert.equal(declinedMigrationConfirmations, 0);
    assert.equal(declinedMigrationWrites, 0);
    const consent = async () => true;
    const writeSuccess = async () => ({ changed: true, message: "enabled" });
    const writeExisting = async () => ({ changed: false, alreadyEnabled: true, message: "already enabled" });
    const writeFailure = async () => ({ changed: false, message: "not written" });
    const choices = [
      [{ claudeCodeVersion: "2.1.256", legacyBypass: true, selectedBypass: "deny" }, { bypass: "deny" }],
      [{ claudeCodeVersion: "2.1.257", migrationChoice: "yes", legacyBypass: true, selectedBypass: "deny" }, { bypass: "preserve" }],
      [{ claudeCodeVersion: "2.1.257", selectedBypass: "allow", confirm: async () => true, setUserBypass: writeFailure }, { bypass: "deny" }],
      [{ claudeCodeVersion: "2.1.257", migrationChoice: "yes", legacyBypass: true, selectedBypass: "allow", confirm: async () => false }, { bypass: "preserve" }],
      [{ claudeCodeVersion: "2.1.257", migrationChoice: "yes", legacyBypass: true, selectedBypass: "allow", confirm, setUserBypass: writeFailure }, { bypass: "preserve" }],
      [{ claudeCodeVersion: "2.1.257", migrationChoice: "yes", legacyBypass: true, selectedBypass: "allow", confirm, setUserBypass: writeExisting }, { bypass: "user" }],
      [{ claudeCodeVersion: "2.1.257", migrationChoice: "yes", legacyBypass: true, selectedBypass: "preserve" }, { bypass: "preserve" }],
      [{ claudeCodeVersion: "2.1.257", legacyBypass: true, selectedBypass: "deny" }, { bypass: "deny" }],
      [{ claudeCodeVersion: "2.1.257", legacyBypass: true, selectedBypass: "allow", confirm: async () => true, setUserBypass: writeSuccess }, { bypass: "user" }],
      [{ claudeCodeVersion: "2.1.256", selectedBypass: "allow" }, { bypass: "allow" }],
      [{ claudeCodeVersion: "2.1.257", selectedBypass: "preserve" }, { bypass: "preserve" }],
      [{ claudeCodeVersion: "2.1.257", selectedBypass: "allow", confirm: async () => false }, { bypass: "deny" }],
      [{ claudeCodeVersion: "2.1.257", legacyBypass: true, selectedBypass: "allow", confirm: async () => false }, { bypass: "preserve" }],
      [{ claudeCodeVersion: "2.1.257", selectedBypass: "allow", confirm: consent, setUserBypass: writeSuccess }, { bypass: "user" }],
      [{ claudeCodeVersion: "2.1.257", selectedBypass: "allow", confirm: consent, setUserBypass: writeExisting }, { bypass: "user" }],
      [{ claudeCodeVersion: "2.1.257", selectedBypass: "allow", confirm: consent, setUserBypass: writeFailure }, { bypass: "deny" }],
      [{ claudeCodeVersion: "2.1.257", legacyBypass: true, selectedBypass: "allow", confirm: consent, setUserBypass: writeFailure }, { bypass: "preserve" }],
      [{ claudeCodeVersion: "2.1.257", retryChoice: "retry", selectedBypass: "allow", confirm: async () => false }, { bypass: "deny" }],
      [{ claudeCodeVersion: "2.1.257", retryChoice: "retry", selectedBypass: "allow", confirm: async () => true, setUserBypass: writeSuccess }, { bypass: "user" }],
      [{ claudeCodeVersion: "2.1.257", retryChoice: "retry", selectedBypass: "user" }, { bypass: "user" }],
      [{ claudeCodeVersion: "2.1.257", retryChoice: "retry", selectedBypass: "preserve" }, { bypass: "preserve" }],
      [{ claudeCodeVersion: "2.1.257", retryChoice: "retry", selectedBypass: "deny" }, { bypass: "deny" }],
      [{ claudeCodeVersion: "2.1.256", retryChoice: "retry", selectedBypass: "user" }, { bypass: "allow" }],
      [{ claudeCodeVersion: "2.1.257", dryRun: true, selectedBypass: "allow" }, { bypass: "deny" }],
      [{ claudeCodeVersion: "2.1.257", dryRun: true, migrationChoice: "yes", legacyBypass: true }, { bypass: "preserve" }]
    ];
    for (const [input, expected] of choices) assert.deepEqual(await choosePermissionConfig(input), expected);
    for (const bypass of ["deny", "user"]) {
      let writes = 0;
      const result = await choosePermissionConfig({
        claudeCodeVersion: "2.1.257", dryRun: true, selectedBypass: bypass,
        setUserBypass: async () => { writes++; return { changed: true }; }
      });
      assert.deepEqual(result, { bypass });
      assert.equal(writes, 0);
    }
    assert.match(warnings.join("\n"), /ineffective in Claude Code v2\.1\.257\+/);
  } finally {
    console.warn = warn;
  }

  for (const version of ["2.1.256", "2.1.257"]) {
    const promptCheck = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { choosePermissionConfig } from ${JSON.stringify(new URL("../lib/setup.mjs", import.meta.url).href)};
      const { PassThrough } = await import("node:stream");
      const terminal = new PassThrough();
      terminal.isTTY = true;
      terminal.setRawMode = () => {};
      terminal.ref = () => {};
      terminal.unref = () => {};
      Object.defineProperty(process, "stdin", { value: terminal });
      const input = setInterval(() => terminal.write("\\r"), 50);
      try {
        assert.deepEqual(await choosePermissionConfig({ claudeCodeVersion: ${JSON.stringify(version)} }), { bypass: "deny" });
      } finally {
        clearInterval(input);
        process.stdin.pause();
      }
      process.exit(0);
    `], { encoding: "utf8", timeout: 10000 });
    assert.equal(promptCheck.status, 0, `${promptCheck.error || ""}\n${promptCheck.stderr}`);
    assert.match(promptCheck.stdout, version === "2.1.257" ? /User scope affects every project/ : /Step 5\/6/);
  }

  for (const legacyBypass of [false, true]) {
    const promptDryRunCheck = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { choosePermissionConfig } from ${JSON.stringify(new URL("../lib/setup.mjs", import.meta.url).href)};
      import { PassThrough } from "node:stream";
      const terminal = new PassThrough();
      terminal.isTTY = true;
      terminal.setRawMode = () => {};
      terminal.ref = () => {};
      terminal.unref = () => {};
      Object.defineProperty(process, "stdin", { value: terminal });
      let confirmCalls = 0;
      let writeCalls = 0;
      let output = "";
      const nativeWrite = process.stdout.write.bind(process.stdout);
      let promptSeen = false;
      let selectionSent = false;
      let input;
      process.stdout.write = (chunk, ...args) => {
        output += chunk.toString();
        if (!promptSeen && /Allow bypass permissions mode\\?/.test(output)) {
          promptSeen = true;
          output = "";
          input = setTimeout(() => terminal.write("\\u001b[B"), 50);
        } else if (promptSeen && !selectionSent && /›\\s+Yes — enable in user settings for every project/.test(output)) {
          selectionSent = true;
          input = setTimeout(() => terminal.write("\\r"), 50);
        }
        return nativeWrite(chunk, ...args);
      };
      try {
        const result = await choosePermissionConfig({
          claudeCodeVersion: "2.1.257", dryRun: true, legacyBypass: ${JSON.stringify(legacyBypass)},
          confirm: async () => { confirmCalls++; return true; },
          setUserBypass: async () => { writeCalls++; return { changed: true }; }
        });
        assert.deepEqual(result, { bypass: ${JSON.stringify(legacyBypass ? "preserve" : "deny")} });
        assert.equal(confirmCalls, 0, "dry run must not request global settings confirmation");
        assert.equal(writeCalls, 0, "dry run must not write user settings");
        assert.equal(promptSeen, true, "dry run allow choice must reach the prompt");
        assert.equal(selectionSent, true, "dry run allow choice must send the selection input");
      } finally {
        clearTimeout(input);
        process.stdout.write = nativeWrite;
        process.stdin.pause();
      }
      process.exit(0);
    `], { encoding: "utf8", timeout: 10000 });
    assert.equal(promptDryRunCheck.status, 0, `${promptDryRunCheck.error || ""}\\n${promptDryRunCheck.stderr}`);
  }

  const promptLiveCheck = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { choosePermissionConfig } from ${JSON.stringify(new URL("../lib/setup.mjs", import.meta.url).href)};
    import { PassThrough } from "node:stream";
    const terminal = new PassThrough();
    terminal.isTTY = true;
    terminal.setRawMode = () => {};
    terminal.ref = () => {};
    terminal.unref = () => {};
    Object.defineProperty(process, "stdin", { value: terminal });
    let confirmCalls = 0;
    let writeCalls = 0;
    let output = "";
    const nativeWrite = process.stdout.write.bind(process.stdout);
    let promptSeen = false;
    let selected = false;
    let input;
    process.stdout.write = (chunk, ...args) => {
      output += chunk.toString();
      if (!promptSeen && /Allow bypass permissions mode\\?/.test(output)) {
        promptSeen = true;
        output = "";
        input = setTimeout(() => terminal.write("\\u001b[B"), 50);
      } else if (promptSeen && !selected && /›\\s+Yes — enable in user settings for every project/.test(output)) {
        selected = true;
        input = setTimeout(() => terminal.write("\\r"), 50);
      }
      return nativeWrite(chunk, ...args);
    };
    try {
      assert.deepEqual(await choosePermissionConfig({
        claudeCodeVersion: "2.1.257",
        confirm: async () => { confirmCalls++; return true; },
        setUserBypass: async () => { writeCalls++; return { changed: true }; }
      }), { bypass: "user" });
      assert.equal(confirmCalls, 1);
      assert.equal(writeCalls, 1);
      assert.equal(promptSeen, true, "live selection must reach the prompt");
      assert.equal(selected, true, "live selection must send the selected input");
    } finally {
      clearTimeout(input);
      process.stdout.write = nativeWrite;
      process.stdin.pause();
    }
    process.exit(0);
  `], { encoding: "utf8", timeout: 10000 });
  assert.equal(promptLiveCheck.status, 0, `${promptLiveCheck.error || ""}\\n${promptLiveCheck.stderr}`);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-user-permissions-"));
  const settingsPath = path.join(root, "settings.json");
  try {
    assert.equal((await setUserBypassPermission({ accepted: false, settingsPath })).changed, false);
    assert.equal((await setUserBypassPermission({ accepted: true, settingsPath })).changed, true);
    assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, "utf8")), { permissions: { defaultMode: "bypassPermissions" } });
    assert.equal((await fs.stat(settingsPath)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.dirname(settingsPath))).mode & 0o777, 0o700);
    assert.equal((await setUserBypassPermission({ accepted: true, settingsPath })).alreadyEnabled, true);

    await fs.writeFile(settingsPath, JSON.stringify({ unrelated: true, permissions: { allow: ["Read(*)"] } }));
    const original = await fs.readFile(settingsPath);
    assert.match((await setUserBypassPermission({ accepted: true, settingsPath })).message, /Cannot safely update existing user settings/);
    assert.deepEqual(await fs.readFile(settingsPath), original);
    await fs.writeFile(settingsPath, JSON.stringify({ permissions: { disableBypassPermissionsMode: "disable" } }));
    assert.match((await setUserBypassPermission({ accepted: true, settingsPath })).message, /disableBypassPermissionsMode=disable/);
    await fs.writeFile(settingsPath, "{");
    assert.match((await setUserBypassPermission({ accepted: true, settingsPath })).message, /unable to read or parse/);
    for (const permissions of ["invalid", [], null, 42, false]) {
      await fs.writeFile(settingsPath, JSON.stringify({ permissions }));
      const rejected = await setUserBypassPermission({ accepted: true, settingsPath });
      assert.match(rejected.message, /unable to read or parse/);
      assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, "utf8")).permissions, permissions);
    }
    await fs.writeFile(settingsPath, "{");

    await runInteractiveSetupCase({ root, name: "new-install-allow-accepted", choice: "accept", expectedUserBypass: "bypassPermissions", expectUserSettings: true });
    await runInteractiveSetupCase({ root, name: "legacy-transfer-accepted", settings: JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }), choice: "accept", expectedProjectBypass: undefined, expectedUserBypass: "bypassPermissions", expectUserSettings: true });
    const legacyMigrationSettings = JSON.stringify({
      permissions: { defaultMode: "bypassPermissions" },
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "printf legacy-migration-fixture" }] }] }
    });
    const migrationDeclineTarget = path.join(root, "migration-declined");
    await fs.mkdir(path.join(migrationDeclineTarget, ".claude"), { recursive: true });
    await fs.writeFile(path.join(migrationDeclineTarget, ".claude", "settings.json"), legacyMigrationSettings);
    assert.equal((await auditProject(migrationDeclineTarget)).state, "LEGACY_VENDOR");
    const migrationDeclineLocalSettings = JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://provider.example/v1" } });
    await fs.writeFile(path.join(migrationDeclineTarget, ".claude", "settings.local.json"), migrationDeclineLocalSettings);
    const migrationDeclineHome = path.join(root, "migration-declined-home");
    await fs.mkdir(path.join(migrationDeclineHome, ".claude"), { recursive: true });
    const migrationDeclineUserSettings = path.join(migrationDeclineHome, ".claude", "settings.json");
    await fs.writeFile(migrationDeclineUserSettings, JSON.stringify({ permissions: { defaultMode: "default" }, unrelated: true }));
    await fs.writeFile(path.join(migrationDeclineHome, ".claude", "settings.local.json"), JSON.stringify({ settings: { source: "fixture" } }));
    await runInteractiveSetupCase({ root, name: "migration-declined", settings: legacyMigrationSettings, choice: "decline", expectedProjectBypass: "bypassPermissions", expectedUserBypass: "default", expectUserSettings: true, home: migrationDeclineHome, expectMigrationCancellation: true });
    const migrationHome = path.join(root, "legacy-transfer-declined-home");
    await fs.mkdir(path.join(migrationHome, ".claude"), { recursive: true });
    const globalSettingsPath = path.join(migrationHome, ".claude", "settings.json");
    await fs.writeFile(globalSettingsPath, JSON.stringify({ permissions: { defaultMode: "default" } }));
    const globalSettingsBeforeDecline = await fs.readFile(globalSettingsPath);
    await runInteractiveSetupCase({ root, name: "legacy-transfer-declined", settings: JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }), choice: "decline", expectedProjectBypass: "bypassPermissions", expectedUserBypass: "default", expectUserSettings: true, home: migrationHome });
    assert.deepEqual(await fs.readFile(globalSettingsPath), globalSettingsBeforeDecline);
    await runInteractiveSetupCase({ root, name: "malformed-settings-rejected", settings: "{", choice: "deny", expectedProjectBypass: "default", expectFailure: true });

    const missingSettingsPath = path.join(root, "new-user", ".claude", "settings.json");
    assert.equal((await setUserBypassPermission({ accepted: true, settingsPath: missingSettingsPath })).changed, true);
    assert.equal((await fs.stat(missingSettingsPath)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.dirname(missingSettingsPath))).mode & 0o777, 0o700);
    const existingDirectoryPath = path.join(root, "existing-dir", ".claude");
    await fs.mkdir(existingDirectoryPath, { recursive: true, mode: 0o755 });
    assert.equal((await setUserBypassPermission({ accepted: true, settingsPath: path.join(existingDirectoryPath, "settings.json") })).changed, true);
    const originalLink = fs.link;
    fs.link = async (source, destination) => {
      if (destination.endsWith("exists/settings.json")) {
        const error = new Error("exists");
        error.code = "EEXIST";
        throw error;
      }
      throw new Error("simulated link failure");
    };
    try {
      const concurrentPath = path.join(root, "concurrent", "settings.json");
      assert.match((await setUserBypassPermission({ accepted: true, settingsPath: concurrentPath })).message, /failed to write/);
      const existsPath = path.join(root, "exists", "settings.json");
      assert.match((await setUserBypassPermission({ accepted: true, settingsPath: existsPath })).message, /appeared during setup/);
    } finally {
      fs.link = originalLink;
    }

    const malformedTarget = path.join(root, "malformed-project");
    await fs.mkdir(path.join(malformedTarget, ".claude"), { recursive: true });
    await fs.writeFile(path.join(malformedTarget, ".claude", "settings.json"), "{");
    await assert.doesNotReject(() => auditProject(malformedTarget));
    const malformedSettings = await fs.readFile(path.join(malformedTarget, ".claude", "settings.json"));
    await assert.rejects(
      () => provisionProject({ sourceRoot: path.resolve("."), target: malformedTarget, setupPipeline: "none", mcpServers: [], ruleMode: "auto", rules: [], applyRules: false, permissionConfig: { bypass: "deny" } }),
      /\.claude\/settings\.json is malformed/
    );
    assert.deepEqual(await fs.readFile(path.join(malformedTarget, ".claude", "settings.json")), malformedSettings);

    const doctorTarget = path.join(root, "doctor");
    await fs.mkdir(path.join(doctorTarget, ".claude"), { recursive: true });
    await fs.writeFile(path.join(doctorTarget, ".claude", "settings.json"), JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }));
    await fs.mkdir(path.join(doctorTarget, ".repo-pattern"), { recursive: true });
    await fs.writeFile(path.join(doctorTarget, ".repo-pattern", ".repo-pattern.json"), JSON.stringify({ workflow: "none", runtime: { localSkills: false, localCommands: false, localHooks: false, localScripts: false, localRules: false } }));
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    await assert.doesNotReject(() => doctorProject(doctorTarget, { silent: true }));
    process.env.PATH = originalPath;
    const bin = path.join(root, "bin");
    await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, "claude"), "#!/bin/sh\nprintf '2.1.257\\n'\n", { mode: 0o755 });
    process.env.PATH = `${bin}:${originalPath}`;
    const originalLog = console.log;
    const output = [];
    console.log = (line = "") => output.push(String(line));
    try {
      await doctorProject(doctorTarget);
      assert.match(output.join("\n"), /Warnings[\s\S]*Project permissions\.defaultMode=bypassPermissions is ineffective/);
    } finally {
      console.log = originalLog;
      process.env.PATH = originalPath;
    }
  } finally {
    console.warn = warn;
    await fs.rm(root, { recursive: true, force: true });
  }
}
