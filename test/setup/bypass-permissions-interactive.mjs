import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

export async function runInteractiveSetupCase({ root, name, settings, choice, expectedProjectBypass, expectedUserBypass, expectUserSettings = false, home = path.join(root, `${name}-home`), expectFailure = false, expectMigrationCancellation = false, columns = 100 }) {
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
    output.isTTY = true; output.columns = ${columns}; output.rows = 40;
    Object.defineProperty(process, "stdin", { value: input });
    process.env.HOME = home; process.env.PATH = home + "/bin:" + process.env.PATH;
    delete process.env.CI; delete process.env.CONTINUOUS_INTEGRATION;
    for (const key of Object.keys(process.env)) if (key.startsWith("CI_")) delete process.env[key];
    const { setupProject } = await import(pathToFileURL(repo + "/src/setup/setup.mjs"));
    let display = "";
    const handled = new Set();
    const keys = ["Run migrate?", "Choose setup workflow", "Install project-local ECC rules & agents?", "Choose ECC rule detection mode", "Choose MCP servers", "MCP secret", "Optional external skills", "Configure third-party provider & models", "Choose effort level", "Allow bypass permissions mode?", "Commit attribution?", "Run setup now?"];
    let pending;
    let frame = "";
    let lastFrame = "";
    let mcpAction = 0;
    const respond = () => {
      pending = undefined;
      if (frame === lastFrame) return;
      lastFrame = frame;
      const title = keys.find((item) => frame.includes(item));
      if (!title) return;
      let action = title;
      let key = "\\r";
      if (title === "Choose MCP servers") {
        action += ":" + mcpAction;
        key = ["\\u001b[B", " ", "\\u001b[B", " ", "\\r"][mcpAction];
        if (key === undefined) return;
      } else if (title === "MCP secret") {
        const field = frame.match(/› ([^:\\n]+):/)[1];
        action += ":" + field;
        if (!handled.has(action + ":text")) {
          action += ":text";
          key = "test-key";
        }
      } else if (title === "Configure third-party provider & models") {
        const field = frame.match(/› (ANTHROPIC_\\w+):/)[1];
        action += ":" + field;
        if (field === "ANTHROPIC_BASE_URL" && !frame.includes("https://provider.example/v1") && !handled.has(action + ":text")) {
          action += ":text";
          key = "https://" + "provider.example/v1";
        }
      } else if (title === "Allow bypass permissions mode?" && choice !== "deny" && !/›\\s+Yes/.test(frame)) {
        action += ":select";
        key = "\\u001b[B";
      }
      if (handled.has(action)) return;
      handled.add(action);
      if (title === "Choose MCP servers") mcpAction++;
      input.write(key);
    };
    output.write = (chunk, ...args) => {
      const text = chunk.toString();
      display = (display + text).slice(-12000);
      const visible = text.replace(/\\u001b\\[[0-?]*[ -/]*[@-~]/g, "").replace(/\\u001b\\][^\\u0007]*(?:\\u0007|\\u001b\\\\)/g, "");
      // Ink writes complete frames; never match prompts left in scrollback.
      if (keys.some((title) => visible.includes(title))) {
        frame = visible;
        // ponytail: allow one Ink render interval for passive input subscriptions; use a committed-frame API if Ink exposes one.
        clearTimeout(pending);
        pending = setTimeout(respond, 40);
      }
      return nativeWrite(chunk, ...args);
    };
    const timeout = setTimeout(() => { console.error("Interactive setup test timed out", display.slice(-2500)); process.exit(124); }, 15000);
    let setupError;
    try { await setupProject({ sourceRoot: repo, target, setupPipeline: "ecc" }); }
    catch (error) { setupError = error; }
    finally { clearTimeout(pending); clearTimeout(timeout); output.write = nativeWrite; }
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
  // protects=single-consent terminal flow and exact disclosure; fails_when=removed bypass prompts remain or required scope/no-overwrite facts disappear; no_claim=simulated TTY does not prove physical-terminal rendering or real operator HOME isolation.
  if (name === "new-install-allow-accepted") {
    assert.match(result.stdout, /affects every project[\s\S]*Existing[\s\S]*settings/);
    assert.doesNotMatch(result.stdout, /Enable bypass permissions in ~\/\.claude\/settings\.json\?|Enable bypassPermissions in user settings\?/);
    assert.doesNotMatch(result.stdout, /== Audit ==/);
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
