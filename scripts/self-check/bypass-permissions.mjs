import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { claudeVersionSupportsUserScope, setUserBypassPermission } from "../lib/bypass-permissions.mjs";
import { auditProject } from "../lib/audit.mjs";
import { doctorProject } from "../lib/doctor.mjs";
import { provisionProject } from "../lib/provision.mjs";
import { choosePermissionConfig, localSettingsPromptOptions, setupOptionsFromLock, setupRetryOptions } from "../lib/setup.mjs";

async function runInteractiveSetupCase({ root, name, settings, choice, expectedProjectBypass, expectedUserBypass, expectUserSettings = false, home = path.join(root, `${name}-home`) }) {
  const target = path.join(root, name);
  const bin = path.join(home, "bin");
  await fs.mkdir(bin, { recursive: true });
  await fs.mkdir(path.join(target, ".claude"), { recursive: true });
  await fs.writeFile(path.join(bin, "claude"), "#!/bin/sh\nprintf '2.1.257\\n'\n", { mode: 0o755 });
  if (settings !== undefined) await fs.writeFile(path.join(target, ".claude", "settings.json"), settings);
  await fs.writeFile(path.join(target, ".claude", "settings.local.json"), JSON.stringify({ env: {
    ANTHROPIC_BASE_URL: "https://provider.example/v1",
    ANTHROPIC_AUTH_TOKEN: "test-token",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "test-opus",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "test-sonnet",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "test-haiku"
  } }));
  const driver = `
    import fs from "node:fs/promises";
    import { PassThrough } from "node:stream";
    import { pathToFileURL } from "node:url";
    const [repo, target, home, choice] = process.argv.slice(1);
    const input = new PassThrough();
    input.isTTY = true; input.setRawMode = () => {}; input.ref = () => {}; input.unref = () => {};
    const output = process.stdout;
    const nativeWrite = output.write.bind(output);
    output.isTTY = true; output.columns = 100; output.rows = 40;
    Object.defineProperty(process, "stdin", { value: input });
    process.env.HOME = home; process.env.PATH = home + "/bin:" + process.env.PATH;
    delete process.env.CI; delete process.env.CONTINUOUS_INTEGRATION;
    for (const key of Object.keys(process.env)) if (key.startsWith("CI_")) delete process.env[key];
    const { setupProject } = await import(pathToFileURL(repo + "/scripts/lib/setup.mjs"));
    let display = "";
    output.write = (chunk, ...args) => { display = (display + chunk.toString()).slice(-12000); return nativeWrite(chunk, ...args); };
    const handled = new Set();
    const keys = ["Run migrate?", "Choose setup workflow", "Install project-local ECC rules & agents?", "Choose ECC rule detection mode", "Choose MCP servers", "MCP secret", "Optional external skills", "Configure third-party provider & models", "Choose effort level", "Allow bypass permissions mode?", "Commit attribution?", "Run setup now?", "Enable bypassPermissions in user settings?"];
    let previousStep = "";
    const timer = setInterval(() => {
      const visible = display.replace(/\\u001b\\[[0-?]*[ -/]*[@-~]/g, "").replace(/\\u001b\\][^\\u0007]*(?:\\u0007|\\u001b\\\\)/g, "");
      const start = visible.lastIndexOf("Step ");
      const consentStart = visible.lastIndexOf("Enable bypassPermissions in user settings?");
      const lines = consentStart > start ? visible.slice(consentStart - 100, consentStart + 500).split("\\n") : start >= 0 ? visible.slice(start).split("\\n") : visible.split("\\n").slice(-12);
      const step = lines[0];
      if (consentStart <= start && step && step === previousStep) return;
      if (step) previousStep = step;
      const title = keys.find((item) => lines.slice(0, 12).some((line) => line.includes(item)) && !handled.has(item));
      if (!title) return;
      handled.add(title);
      if (title === "Choose setup workflow") {
        setTimeout(() => input.write("\\r"), 200);
      } else if (title === "Install project-local ECC rules & agents?" || title === "Choose ECC rule detection mode") {
        setTimeout(() => input.write("\\r"), 50);
      } else if (title === "Choose MCP servers") {
        for (const [delay, key] of [[0, "\\u001b[B"], [200, " "], [400, "\\u001b[B"], [600, " "], [800, "\\r"]]) setTimeout(() => input.write(key), delay);
      } else if (title === "MCP secret") {
        for (const [delay, key] of [[0, "t"], [50, "e"], [100, "s"], [150, "t"], [200, "-"], [250, "k"], [300, "e"], [350, "y"], [500, "\\r"]]) setTimeout(() => input.write(key), delay);
      } else if (title === "Configure third-party provider & models") {
        for (const [delay, key] of [[0, "h"], [50, "t"], [100, "t"], [150, "p"], [200, "s"], [250, ":"], [300, "/"], [350, "/"], [400, "p"], [450, "r"], [500, "o"], [550, "v"], [600, "i"], [650, "d"], [700, "e"], [750, "r"], [800, "."], [850, "e"], [900, "x"], [950, "a"], [1000, "m"], [1050, "p"], [1100, "l"], [1150, "e"], [1200, "/"], [1250, "v"], [1300, "1"], [1400, "\\r"], [1650, "\\r"], [1900, "\\r"], [2150, "\\r"], [2400, "\\r"]]) setTimeout(() => input.write(key), delay);
      } else {
        if (title.includes("Enable bypassPermissions")) {
          setTimeout(() => input.write(choice === "decline" ? "n" : "y"), 100);
        } else if (title === "Allow bypass permissions mode?" && choice !== "deny") {
          setTimeout(() => input.write("\\u001b[B"), 0);
        }
        setTimeout(() => input.write("\\r"), 200);
      }
    }, 100);
    const timeout = setTimeout(() => { console.error("Interactive setup test timed out", display.slice(-2500)); process.exit(124); }, 15000);
    try { await setupProject({ sourceRoot: repo, target, setupPipeline: "ecc" }); }
    catch (error) { console.error(error.stack || error); process.exitCode = 1; }
    finally { clearInterval(timer); clearTimeout(timeout); process.exit(); }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", driver, path.resolve("."), target, home, choice], {
    encoding: "utf8", timeout: 20000,
    env: { ...process.env, ...(process.env.NODE_V8_COVERAGE ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE } : {}) }
  });
  assert.equal(result.status, 0, `${name}: ${result.error || ""}\\n${result.stderr}`);
  assert.match(result.stdout, /Claude Code · 2\.1\.257/);
  const project = JSON.parse(await fs.readFile(path.join(target, ".claude", "settings.json"), "utf8"));
  assert.equal(project.permissions.defaultMode, expectedProjectBypass);
  if (expectUserSettings) {
    const user = JSON.parse(await fs.readFile(path.join(home, ".claude", "settings.json"), "utf8"));
    assert.equal(user.permissions.defaultMode, expectedUserBypass);
  } else await assert.rejects(fs.access(path.join(home, ".claude", "settings.json")));
  if (expectedUserBypass !== undefined && !expectUserSettings) {
    const user = JSON.parse(await fs.readFile(path.join(home, ".claude", "settings.json"), "utf8"));
    assert.equal(user.permissions.defaultMode, expectedUserBypass);
  }
}

export async function runBypassPermissionChecks() {
  // Value: protects=version threshold, setup consent decisions, user settings safeguards, and doctor warning; fails_when=an unsafe write or ineffective project bypass is accepted; why_new=isolates setup permission decisions from real settings writes; seam=direct helper injection simulates confirmation and filesystem results; no_claim=physical TTY behavior and real home settings are not exercised.
  // Value: protects=real interactive legacy bypass transfer acceptance, decline, and malformed-settings recovery; fails_when=setup writes bypass to the wrong scope, loses legacy intent on decline, or fails to repair malformed settings; why_new=direct helper checks cannot cover actual setup/wizard routing; seam=none; no_claim=physical TTY behavior and real operator HOME are not exercised.
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
    const consent = async () => true;
    const writeSuccess = async () => ({ changed: true, message: "enabled" });
    const writeExisting = async () => ({ changed: false, alreadyEnabled: true, message: "already enabled" });
    const writeFailure = async () => ({ changed: false, message: "not written" });
    const choices = [
      [{ claudeCodeVersion: "2.1.256", legacyBypass: true, selectedBypass: "deny" }, { bypass: "allow" }],
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

    await runInteractiveSetupCase({ root, name: "legacy-transfer-accepted", settings: JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }), choice: "accept", expectedProjectBypass: undefined, expectedUserBypass: "bypassPermissions", expectUserSettings: true });
    const migrationHome = path.join(root, "legacy-transfer-declined-home");
    await fs.mkdir(path.join(migrationHome, ".claude"), { recursive: true });
    const globalSettingsPath = path.join(migrationHome, ".claude", "settings.json");
    await fs.writeFile(globalSettingsPath, JSON.stringify({ permissions: { defaultMode: "default" } }));
    const globalSettingsBeforeDecline = await fs.readFile(globalSettingsPath);
    await runInteractiveSetupCase({ root, name: "legacy-transfer-declined", settings: JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }), choice: "decline", expectedProjectBypass: "bypassPermissions", expectedUserBypass: "default", expectUserSettings: true, home: migrationHome });
    assert.deepEqual(await fs.readFile(globalSettingsPath), globalSettingsBeforeDecline);
    await runInteractiveSetupCase({ root, name: "malformed-settings-recovered", settings: "{", choice: "deny", expectedProjectBypass: "default" });

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
