import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

export async function runInteractiveSetupCase({ root, name, settings, choice, expectedProjectBypass, expectedUserBypass, expectUserSettings = false, home = path.join(root, `${name}-home`), expectFailure = false, expectMigrationCancellation = false }) {
  const target = path.join(root, name);
  const bin = path.join(home, "bin");
  await fs.mkdir(bin, { recursive: true });
  await fs.mkdir(path.join(target, ".claude"), { recursive: true });
  await fs.writeFile(path.join(bin, "claude"), "#!/bin/sh\nprintf '2.1.257\n'\n", { mode: 0o755 });
  if (settings !== undefined) await fs.writeFile(path.join(target, ".claude", "settings.json"), settings);
  const localSettingsPath = path.join(target, ".claude", "settings.local.json");
  const localSettings = JSON.stringify({ env: {
    ANTHROPIC_BASE_URL: "https://provider.example/v1",
    ANTHROPIC_AUTH_TOKEN: "test-token",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "test-opus",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "test-sonnet",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "test-haiku"
  } });
  if (expectMigrationCancellation) {
    await fs.access(localSettingsPath);
  } else {
    await fs.writeFile(localSettingsPath, localSettings);
  }
  const projectSettingsPath = path.join(target, ".claude", "settings.json");
  const userSettingsPath = path.join(home, ".claude", "settings.json");
  if (expectMigrationCancellation) await fs.mkdir(path.dirname(userSettingsPath), { recursive: true });
  const projectSettingsBefore = expectMigrationCancellation ? await fs.readFile(projectSettingsPath) : null;
  const localSettingsBefore = expectMigrationCancellation ? await fs.readFile(localSettingsPath) : null;
  const userSettingsBefore = expectMigrationCancellation ? await fs.readFile(userSettingsPath) : null;
  const userLocalSettingsPath = path.join(home, ".claude", "settings.local.json");
  const userLocalSettingsBefore = expectMigrationCancellation ? await fs.readFile(userLocalSettingsPath) : null;
  const driver = `
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
    const consentPrompts = ["Enable bypassPermissions in user settings?", "Enable bypass permissions in ~/.claude/settings.json?"];
    const keys = ["Run migrate?", "Choose setup workflow", "Install project-local ECC rules & agents?", "Choose ECC rule detection mode", "Choose MCP servers", "MCP secret", "Optional external skills", "Configure third-party provider & models", "Choose effort level", "Allow bypass permissions mode?", "Commit attribution?", "Run setup now?", ...consentPrompts];
    let previousStep = "";
    const timer = setInterval(() => {
      const visible = display.replace(/\\u001b\\[[0-?]*[ -/]*[@-~]/g, "").replace(/\\u001b\\][^\\u0007]*(?:\\u0007|\\u001b\\\\)/g, "");
      const start = visible.lastIndexOf("Step ");
      const consentStart = Math.max(...consentPrompts.map((prompt) => visible.lastIndexOf(prompt)));
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
        if (consentPrompts.includes(title)) {
          setTimeout(() => input.write(choice === "decline" ? "n" : "y"), 100);
        } else if (title === "Allow bypass permissions mode?" && choice !== "deny") {
          setTimeout(() => input.write("\\u001b[B"), 0);
        }
        setTimeout(() => input.write("\\r"), 200);
      }
    }, 100);
    const timeout = setTimeout(() => { console.error("Interactive setup test timed out", display.slice(-2500)); process.exit(124); }, 15000);
    let setupError;
    try { await setupProject({ sourceRoot: repo, target, setupPipeline: "ecc" }); }
    catch (error) { setupError = error; }
    finally { clearInterval(timer); clearTimeout(timeout); }
    if (setupError) {
      console.error(setupError.stack || setupError);
      const expectedMalformedFailure = ${expectFailure ? "true" : "false"} && /\\.claude\\/settings\\.json is malformed/.test(setupError.message);
      const expectedMigrationCancellation = ${expectMigrationCancellation ? "true" : "false"} && setupError.message === "Setup cancelled.";
      if (!expectedMalformedFailure && !expectedMigrationCancellation) process.exitCode = 1;
    } else if (${expectFailure || expectMigrationCancellation ? "true" : "false"}) {
      console.error("Interactive setup unexpectedly succeeded");
      process.exitCode = 1;
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", driver, path.resolve("."), target, home, choice], {
    encoding: "utf8", timeout: 20000,
    env: { ...process.env, ...(process.env.NODE_V8_COVERAGE ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE } : {}) }
  });
  assert.equal(result.status, 0, `${name}: ${result.error || ""}\n${result.stderr}`);
  if (expectMigrationCancellation) {
    assert.match(result.stdout, /Run migrate\?/);
    assert.doesNotMatch(result.stdout, /Choose setup workflow|Choose MCP servers|Run setup now\?/);
    assert.doesNotMatch(result.stdout, /Enable bypassPermissions in user settings|Enable bypass permissions in ~\/\.claude\/settings\.json/);
    assert.match(result.stderr, /Error: Setup cancelled\./);
    if (projectSettingsBefore) assert.deepEqual(await fs.readFile(projectSettingsPath), projectSettingsBefore);
    if (localSettingsBefore) assert.deepEqual(await fs.readFile(localSettingsPath), localSettingsBefore);
    if (userSettingsBefore) assert.deepEqual(await fs.readFile(userSettingsPath), userSettingsBefore);
    if (userLocalSettingsBefore) assert.deepEqual(await fs.readFile(userLocalSettingsPath), userLocalSettingsBefore);
    for (const artifact of [".mcp.json", ".repo-pattern/setup-status.json", ".repo-pattern/.repo-pattern.lock.json", ".repo-pattern/backups"]) {
      await assert.rejects(fs.access(path.join(target, artifact)));
    }
    return;
  }
  if (expectFailure) {
    assert.match(result.stderr, /WARN: Existing \.claude\/settings\.json is malformed; fix it before running setup:/);
    assert.doesNotMatch(result.stderr, /continuing interactive setup so it can be repaired/);
    assert.match(result.stderr, /\.claude\/settings\.json is malformed\. Fix it before running setup\./);
    assert.deepEqual(await fs.readFile(path.join(target, ".claude", "settings.json"), "utf8"), settings);
    return;
  }
  assert.match(result.stdout, /Claude Code · 2\.1\.257/);
  const project = JSON.parse(await fs.readFile(path.join(target, ".claude", "settings.json"), "utf8"));
  assert.equal(project.permissions.defaultMode, expectedProjectBypass);
  if (name === "new-install-allow-accepted") {
    assert.match(result.stdout, /Enable bypass permissions in ~\/\.claude\/settings\.json\? This affects every project\./);
  }
  if (expectUserSettings) {
    const user = JSON.parse(await fs.readFile(path.join(home, ".claude", "settings.json"), "utf8"));
    assert.equal(user.permissions.defaultMode, expectedUserBypass);
  } else await assert.rejects(fs.access(path.join(home, ".claude", "settings.json")));
  if (expectedUserBypass !== undefined && !expectUserSettings) {
    const user = JSON.parse(await fs.readFile(path.join(home, ".claude", "settings.json"), "utf8"));
    assert.equal(user.permissions.defaultMode, expectedUserBypass);
  }
}
