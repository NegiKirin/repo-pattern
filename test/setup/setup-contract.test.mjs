import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { render } from "ink-testing-library";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { mcpInputFields } from "../../src/mcp.mjs";
import { claudeVersionSupportsUserScope } from "../../src/setup/bypass-permissions.mjs";
import { provisionProject } from "../../src/setup/provision.mjs";
import { setupOptionsFromLock, setupProject, setupRetryOptions } from "../../src/setup/setup.mjs";
import { style } from "../../src/ui/prompt.mjs";
import { chooseAttributionConfig, chooseMcpConfig, chooseMcpValues, chooseOptionalSkills, choosePermissionConfig, localSettingsPromptOptions } from "../../src/ui/setup-interaction.mjs";
import { SetupWizard, effortColor, nextEffortCursor, nextMenuCursor, previousPageIndex, pruneWizardState, renderEffortOptions, wizardPages } from "../../src/ui/setup-wizard.mjs";

const data = {
  claudeCodeVersion: "1.0.0",
  mcpServers: [
    { group: true, label: "Core / Must have" },
    { value: "context7", label: "context7", hint: "Live documentation lookup" },
    { value: "tavily", label: "tavily", hint: "Web research" },
    { group: true, label: "Development tools" },
    { value: "playwright", label: "playwright", hint: "Browser testing" }
  ],
  ruleModes: ["auto", "manual", "none"],
  mcpInputs: (servers) => servers.includes("context7") ? [
    { name: "CONTEXT7_API_KEY", kind: "secret", label: "context7: CONTEXT7_API_KEY", defaultValue: "", placeholder: "ctx7sk-.....................", validate: (value) => value ? true : "Required" }
  ] : [],
  rules: ["common", "typescript"],
  optionalSkills: [
    { group: true, label: "Terminal workflow" },
    { value: "herdr", label: "herdr" }
  ],
  localSettings: [
    { name: "ANTHROPIC_BASE_URL", initial: "", placeholder: "https://example.com/v1", validate: (value) => /^https?:\/\//.test(value) ? true : "Use a valid URL." },
    { name: "ANTHROPIC_AUTH_TOKEN", initial: "", placeholder: "sk-..............", mask: true, validate: (value) => value ? true : "Required" },
    { name: "ANTHROPIC_DEFAULT_OPUS_MODEL", initial: "", placeholder: "claude-opus-4-8", validate: (value) => value ? true : "Required" },
    { name: "ANTHROPIC_DEFAULT_SONNET_MODEL", initial: "", placeholder: "claude-sonnet-4-6", validate: (value) => value ? true : "Required" },
    { name: "ANTHROPIC_DEFAULT_HAIKU_MODEL", initial: "", placeholder: "claude-haiku-4-5", validate: (value) => value ? true : "Required" }
  ]
};

async function waitForFrame(renderer, pattern, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (pattern.test(renderer.lastFrame())) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.match(renderer.lastFrame(), pattern);
}

const initial = {
  setupPipeline: "both",
  planTuneHooks: false,
  applyRules: true,
  mcpServers: ["context7"],
  ruleMode: "manual",
  rules: ["typescript"],
  optionalSkills: ["herdr"],
  mcpValues: { CONTEXT7_API_KEY: "secret-value" },
  localSettingsEnv: {
    ANTHROPIC_BASE_URL: "https://provider.example/v1",
    ANTHROPIC_AUTH_TOKEN: "secret-token",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "custom-opus",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "custom-sonnet",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "custom-haiku"
  },
  effortLevel: "medium",
  permissionConfig: { bypass: "deny" },
  attributionConfig: { mode: "off" }
};

test("setup wizard preserves state pruning, page order, validation, and terminal rendering", async () => {
  // protects=setup wizard defaults, page visibility, cursor movement, validation, and Ink frames; fails_when=selection order, state pruning, prompt text, masking, or rendered controls change; no_claim=physical TTY behavior or full interactive setup orchestration.
  assert.deepEqual(wizardPages({ ...initial, setupPipeline: "none" }, data).find((page) => page.id === "pipeline").options.map((option) => option.value), ["ecc", "gstack"]);
  assert.equal(nextMenuCursor(0, "up", 0), 0);
  assert.equal(nextMenuCursor(0, "up", 3), 2);
  assert.equal(nextMenuCursor(2, "down", 3), 0);
  assert.equal(nextEffortCursor(0, "left", 6), 0);
  assert.equal(nextEffortCursor(2, "left", 6), 1);
  assert.equal(nextEffortCursor(4, "right", 6), 5);
  assert.equal(nextEffortCursor(5, "right", 6), 5);
  assert.equal(effortColor("medium"), "cyan");
  assert.equal(effortColor("ultracode"), "magenta");
  assert.deepEqual(renderEffortOptions(["low", "medium", "ultracode"], "medium"), [
    { value: "low", label: "low", color: undefined },
    { value: "medium", label: "[medium]", color: "cyan" },
    { value: "ultracode", label: "ultracode", color: undefined }
  ]);

  const pages = wizardPages(initial, data);
  assert.equal(pages.find((page) => page.id === "permission").note, "Claude Code v2.1.257+ ignores this setting from project config.");
  assert.match(wizardPages({ ...initial, migrationChoice: "pending" }, { ...data, legacyBypass: true }).find((page) => page.id === "permission").note, /Legacy project bypassPermissions detected/);
  assert.equal(pages.some((page) => page.id === "planTuneHooks"), false);
  assert.equal(pruneWizardState(initial, data).planTuneHooks, true);
  assert.ok(pages.some((page) => page.id === "mcpServers"));
  assert.ok(pages.some((page) => page.id === "rules"));
  assert.equal(previousPageIndex(pages, pages.findIndex((page) => page.id === "mcpServers")), pages.findIndex((page) => page.id === "rules"));
  assert.deepEqual(pages.find((page) => page.id === "mcpInputs").fields.map((field) => field.name), ["CONTEXT7_API_KEY"]);
  assert.equal(pages.findIndex((page) => page.id === "mcpInputs") < pages.findIndex((page) => page.id === "optionalSkills"), true);
  assert.deepEqual(pruneWizardState({ ...initial, mcpServers: [] }, data).mcpValues, {});
  assert.ok(wizardPages({ ...initial, mcpServers: [] }, data).every((page) => page.id !== "mcpInputs"));

  const noEcc = pruneWizardState({ ...initial, setupPipeline: "gstack", applyRules: false }, data);
  assert.ok(wizardPages(noEcc, data).some((page) => page.id === "installRules"));
  assert.equal(wizardPages(noEcc, data).some((page) => page.id === "rules"), false);
  assert.deepEqual(noEcc.rules, []);
  assert.deepEqual(wizardPages({ ...initial, retryChoice: "retry" }, data).map((page) => page.id), ["confirm"]);
  assert.deepEqual(wizardPages({ ...initial, permissionConfig: { bypass: "user" }, retryChoice: "retry" }, data).map((page) => page.id), ["confirm"]);
  assert.deepEqual(wizardPages({ ...initial, permissionConfig: { bypass: "preserve" }, retryChoice: "edit" }, data).find((page) => page.id === "permission").options.map((option) => option.value), ["deny", "allow"]);
  for (const bypass of ["user", "preserve", "allow", "deny"]) {
    const state = pruneWizardState({ ...initial, permissionConfig: { bypass }, retryChoice: "edit" }, data);
    assert.deepEqual(state.permissionConfig, { bypass: bypass === "user" || bypass === "preserve" ? "deny" : bypass });
  }
  assert.deepEqual(pruneWizardState({ ...initial, permissionConfig: { bypass: "user" }, retryChoice: "retry" }, data).permissionConfig, { bypass: "user" });

  const serverWizard = render(React.createElement(SetupWizard, { initialState: { ...initial, setupPipeline: "none", applyRules: false, optionalSkills: [] }, data, initialPageId: "mcpServers", done: () => {} }));
  assert.match(serverWizard.lastFrame(), /Core \/ Must have/);
  assert.match(serverWizard.lastFrame(), /Development tools/);
  assert.match(serverWizard.lastFrame(), /› ◉ context7 — Live documentation lookup/);
  serverWizard.stdin.write(" ");
  await waitForFrame(serverWizard, /○ context7/);
  await new Promise((resolve) => setImmediate(resolve));
  serverWizard.stdin.write("\r");
  await waitForFrame(serverWizard, /Optional external skills/);
  serverWizard.unmount();

  const retryWizard = render(React.createElement(SetupWizard, { initialState: { ...initial, permissionConfig: { bypass: "user" }, retryChoice: "pending" }, data, initialPageId: "retryChoice", done: () => {} }));
  retryWizard.stdin.write("\r");
  await waitForFrame(retryWizard, /Run setup now\?/);
  retryWizard.unmount();

  const editWizard = render(React.createElement(SetupWizard, { initialState: { ...initial, permissionConfig: { bypass: "preserve" }, retryChoice: "pending" }, data, initialPageId: "retryChoice", done: () => {} }));
  editWizard.stdin.write("\u001b[B");
  await waitForFrame(editWizard, /›\s+Edit/);
  await new Promise((resolve) => setImmediate(resolve));
  editWizard.stdin.write("\r");
  await waitForFrame(editWizard, /Choose ECC rule detection mode/);
  editWizard.unmount();

  const skillsWizard = render(React.createElement(SetupWizard, { initialState: { ...initial, setupPipeline: "none", applyRules: false, mcpServers: [], optionalSkills: [] }, data, initialPageId: "optionalSkills", done: () => {} }));
  assert.match(skillsWizard.lastFrame(), /Terminal workflow/);
  assert.match(skillsWizard.lastFrame(), /› ○ herdr/);
  skillsWizard.stdin.write(" ");
  await waitForFrame(skillsWizard, /◉ herdr/);
  skillsWizard.unmount();

  const effortWizard = render(React.createElement(SetupWizard, { initialState: { ...initial, setupPipeline: "none", applyRules: false, mcpServers: [], optionalSkills: [], effortLevel: "medium" }, data, initialPageId: "effort", done: () => {} }));
  effortWizard.stdin.write("\u001b[C");
  await waitForFrame(effortWizard, /\[high\]/);
  assert.match(effortWizard.lastFrame(), /Claude Code · 1\.0\.0/);
  effortWizard.unmount();

  const modelWizard = render(React.createElement(SetupWizard, { initialState: { ...initial, setupPipeline: "none", applyRules: false, mcpServers: [], optionalSkills: [] }, data, initialPageId: "modelSettings", done: () => {} }));
  assert.match(modelWizard.lastFrame(), /Configure third-party provider & models/);
  assert.match(modelWizard.lastFrame(), /› ANTHROPIC_BASE_URL:/);
  modelWizard.stdin.write("\u001b[B");
  await waitForFrame(modelWizard, /› ANTHROPIC_AUTH_TOKEN:/);
  modelWizard.unmount();

  const mcpWizard = render(React.createElement(SetupWizard, { initialState: { ...initial, mcpValues: {}, setupPipeline: "none", applyRules: false, optionalSkills: [] }, data, initialPageId: "mcpInputs", done: () => {} }));
  assert.match(mcpWizard.lastFrame(), /MCP secret/);
  assert.match(mcpWizard.lastFrame(), /context7:/);
  assert.match(mcpWizard.lastFrame(), /› CONTEXT7_API_KEY:/);
  assert.doesNotMatch(mcpWizard.lastFrame(), /secret-value/);
  mcpWizard.stdin.write("first-secret");
  await waitForFrame(mcpWizard, /CONTEXT7_API_KEY: •+/);
  assert.doesNotMatch(mcpWizard.lastFrame(), /first-secret/);
  mcpWizard.unmount();
});

test("setup wizard cancels migration and preserves retry/edit branches", async () => {
  const cancelled = [];
  const migrationWizard = render(React.createElement(SetupWizard, {
    initialState: { ...initial, migrationChoice: "pending" },
    data,
    initialPageId: "migrationChoice",
    done: (error) => cancelled.push(error)
  }));
  migrationWizard.stdin.write("\r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled.length, 1);
  assert.match(cancelled[0].message, /Setup cancelled/);
  migrationWizard.unmount();

  const retryWizard = render(React.createElement(SetupWizard, {
    initialState: { ...initial, retryChoice: "pending" },
    data,
    initialPageId: "retryChoice",
    done: () => {}
  }));
  retryWizard.stdin.write("\r");
  await waitForFrame(retryWizard, /Run setup now\?/);
  retryWizard.unmount();

  const editWizard = render(React.createElement(SetupWizard, {
    initialState: { ...initial, retryChoice: "pending" },
    data,
    initialPageId: "retryChoice",
    done: () => {}
  }));
  editWizard.stdin.write("\u001b[B");
  await waitForFrame(editWizard, /›\s+Edit/);
  await new Promise((resolve) => setImmediate(resolve));
  editWizard.stdin.write("\r");
  await waitForFrame(editWizard, /Choose ECC rule detection mode/);
  editWizard.unmount();
});

test("setup interaction wrappers preserve prompt contracts", async () => {
  // protects=available-server grouping, persisted MCP handoff, optional skill selection, and attribution branches; fails_when=wrapper defaults, prompt text, options, ordering, or custom validation changes; no_claim=live prompt rendering or external server availability.
  const calls = [];
  const prompt = async (options) => {
    calls.push(options);
    return options.message === "Commit attribution?" ? "custom" : options.initialValues || [];
  };
  const sourceRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
  assert.deepEqual(await chooseMcpConfig(sourceRoot, ["context7"], prompt), { mcpServers: ["context7"] });
  const collected = await chooseMcpValues(sourceRoot, ["context7"], { CONTEXT7_API_KEY: "persisted" }, async (servers, options) => {
    assert.ok(servers.context7);
    assert.deepEqual(options.values, { CONTEXT7_API_KEY: "persisted" });
    return options.values;
  });
  assert.deepEqual(collected, { CONTEXT7_API_KEY: "persisted" });
  assert.deepEqual(await chooseOptionalSkills(["herdr"], prompt), ["herdr"]);
  assert.deepEqual(await chooseAttributionConfig(async () => "off", undefined, () => {}), { mode: "off" });
  assert.deepEqual(await chooseAttributionConfig(async () => "custom", async (message, options) => {
    assert.equal(message, "Custom commit attribution");
    assert.match(options.initial, /Co-Authored-By/);
    assert.equal(options.validate(""), "Required");
    return "Custom attribution";
  }, () => {}), { mode: "custom", commit: "Custom attribution" });
  assert.deepEqual(calls.map(({ message }) => message), ["Choose MCP servers", "Step 3/6 — Optional external skills"]);
});

test("setupProject preserves reachable guard and configuration branches", async () => {
  // protects=setup lock safety, missing-Claude diagnostics, legacy migration guard, settings error propagation, and interactive rule selection; fails_when=guards disappear, errors change, or selected rule configuration is not passed to provisioning; no_claim=live Claude, MCP, PTY, or provisioning behavior.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-setup-branches-"));
  const sourceRoot = path.resolve(new URL("../../", import.meta.url).pathname);
  const originalStdin = process.stdin.isTTY;
  const originalStdout = process.stdout.isTTY;
  const originalCI = process.env.CI;
  const target = path.join(root, "target");
  const state = { setupPipeline: "ecc", applyRules: true, ruleMode: "manual", rules: ["typescript"] };
  const interaction = async () => ({ state: { ...state, permissionConfig: { bypass: "deny" }, migrationChoice: "yes", retryChoice: "none", planTuneHooks: false, mcpServers: [], mcpValues: {}, optionalSkills: [], localSettingsEnv: {}, effortLevel: "medium", attributionConfig: { mode: "off" } }, controller: { close() {}, renderProgress() {} } });
  let provisionOptions;
  const provision = async (options) => { provisionOptions = options; assert.deepEqual(options.rules, ["typescript"]); };
  try {
    await fs.mkdir(path.join(target, ".claude"), { recursive: true });
    await fs.mkdir(path.join(target, ".repo-pattern"), { recursive: true });
    await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), "{}\n");
    execFileSync("git", ["init", "-q"], { cwd: target });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: target });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: target });
    execFileSync("git", ["add", ".repo-pattern/.repo-pattern.lock.json"], { cwd: target });
    await assert.rejects(() => setupProject({ sourceRoot, target, yes: true }), /lock is tracked/);

    delete process.env.CI;
    Object.defineProperties(process.stdin, { isTTY: { value: true, configurable: true } });
    Object.defineProperties(process.stdout, { isTTY: { value: true, configurable: true } });
    try {
      await assert.rejects(() => setupProject({ sourceRoot, target, checkClaude: async () => { throw new Error("missing Claude"); } }), /missing Claude/);
    } finally {
      Object.defineProperties(process.stdin, { isTTY: { value: originalStdin, configurable: true } });
      Object.defineProperties(process.stdout, { isTTY: { value: originalStdout, configurable: true } });
    }
    const legacyTarget = path.join(root, "legacy");
    await fs.mkdir(path.join(legacyTarget, ".claude", "skills"), { recursive: true });
    delete process.env.CI;
    Object.defineProperties(process.stdin, { isTTY: { value: true, configurable: true } });
    Object.defineProperties(process.stdout, { isTTY: { value: true, configurable: true } });
    try {
      await assert.rejects(() => setupProject({ sourceRoot, target: legacyTarget, force: true, checkClaude: async () => "1.0.0" }), /--migrate/);

      const settingsTarget = path.join(root, "settings-error");
      const settingsDirectory = path.join(root, "settings-directory");
      await fs.mkdir(settingsDirectory, { recursive: true });
      await fs.mkdir(settingsTarget, { recursive: true });
      await fs.symlink(settingsDirectory, path.join(settingsTarget, ".claude"), "dir");
      await assert.rejects(() => setupProject({ sourceRoot, target: settingsTarget, checkClaude: async () => "1.0.0", interactionRunner: interaction, provision, output: { summary() {}, audit() {}, style, warn() {} } }), /must not be a symlink/);

      const interactiveTarget = path.join(root, "interactive");
      await fs.mkdir(path.join(interactiveTarget, ".claude"), { recursive: true });
      await setupProject({ sourceRoot, target: interactiveTarget, checkClaude: async () => "1.0.0", interactionRunner: interaction, provision, output: { summary() {}, audit() {}, style, warn() {} } });
      assert.equal(provisionOptions.migrate, false);
    } finally {
      Object.defineProperties(process.stdin, { isTTY: { value: originalStdin, configurable: true } });
      Object.defineProperties(process.stdout, { isTTY: { value: originalStdout, configurable: true } });
      if (originalCI === undefined) delete process.env.CI;
      else process.env.CI = originalCI;
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("setup state transitions preserve retry/edit options and migration decisions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-setup-state-native-"));
  const sourceRoot = path.resolve(new URL("../../", import.meta.url).pathname);
  const originalStdin = process.stdin.isTTY;
  const originalStdout = process.stdout.isTTY;
  const originalCI = process.env.CI;
  const output = { summary() {}, audit() {}, style, warn() {} };
  try {
    delete process.env.CI;
    Object.defineProperties(process.stdin, { isTTY: { value: true, configurable: true } });
    Object.defineProperties(process.stdout, { isTTY: { value: true, configurable: true } });
    for (const status of ["failed", "running"]) {
      for (const retryChoice of ["retry", "edit"]) {
        const target = path.join(root, `${status}-${retryChoice}`);
        await fs.mkdir(path.join(target, ".claude"), { recursive: true });
        await fs.mkdir(path.join(target, ".repo-pattern"), { recursive: true });
        await fs.writeFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), JSON.stringify({ setup: {
          status,
          options: { action: "setup", setupPipeline: "ecc", mcpServers: [], applyRules: false, ruleMode: "auto", rules: [], optionalSkills: [], localSettingsEnv: {}, effortLevel: "medium", attributionConfig: { mode: "off" }, permissionConfig: { bypass: "deny" } }
        } }));
        let provisionOptions;
        await setupProject({
          sourceRoot,
          target,
          checkClaude: async () => "1.0.0",
          interactionRunner: async (initialState) => ({
            state: { ...initialState, retryChoice, setupPipeline: retryChoice === "edit" ? "none" : initialState.setupPipeline },
            controller: { close() {}, renderProgress() {} }
          }),
          provision: async (options) => { provisionOptions = options; },
          output
        });
        assert.equal(provisionOptions.setupPipeline, retryChoice === "edit" ? "none" : "ecc");
        const lock = JSON.parse(await fs.readFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
        assert.equal(lock.setup.status, "running");
        assert.equal(lock.setup.options.setupPipeline, provisionOptions.setupPipeline);
      }
    }

    for (const migrationChoice of ["yes", "no"]) {
      const target = path.join(root, `legacy-${migrationChoice}`);
      const legacyFile = path.join(target, ".claude", "skills", "legacy.txt");
      await fs.mkdir(path.dirname(legacyFile), { recursive: true });
      await fs.writeFile(legacyFile, "legacy\n");
      const before = await fs.readFile(legacyFile, "utf8");
      let provisionOptions;
      const runInteraction = migrationChoice === "no"
        ? async () => { throw new Error("Setup cancelled."); }
        : async (initialState) => ({
          state: { ...initialState, migrationChoice },
          controller: { close() {}, renderProgress() {} }
        });
      if (migrationChoice === "no") {
        await assert.rejects(() => setupProject({ sourceRoot, target, checkClaude: async () => "1.0.0", interactionRunner: runInteraction, provision: async (options) => { provisionOptions = options; }, output }), /Setup cancelled/);
        assert.equal(await fs.readFile(legacyFile, "utf8"), before);
      } else {
        await setupProject({ sourceRoot, target, checkClaude: async () => "1.0.0", interactionRunner: runInteraction, provision: async (options) => { provisionOptions = options; }, output });
        assert.equal(provisionOptions.migrate, true);
        assert.equal(await fs.readFile(legacyFile, "utf8"), before);
      }
    }
  } finally {
    Object.defineProperties(process.stdin, { isTTY: { value: originalStdin, configurable: true } });
    Object.defineProperties(process.stdout, { isTTY: { value: originalStdout, configurable: true } });
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("setupProject persists failed retry state when provision rejects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-setup-failure-state-"));
  const sourceRoot = path.resolve(new URL("../../", import.meta.url).pathname);
  const target = path.join(root, "target");
  const output = { summary() {}, audit() {}, style, warn() {} };
  const expectedOptions = {
    setupPipeline: "none",
    applyRules: false,
    ruleMode: "auto",
    rules: [],
    mcpServers: [],
    mcpValues: {},
    optionalSkills: [],
    localSettingsEnv: {},
    effortLevel: "medium",
    permissionConfig: { bypass: "deny" },
    attributionConfig: { mode: "off" }
  };
  const failure = new Error("injected provision failure");
  let provisionOptions;
  const originalStdin = process.stdin.isTTY;
  const originalStdout = process.stdout.isTTY;
  const originalCI = process.env.CI;
  try {
    delete process.env.CI;
    Object.defineProperties(process.stdin, { isTTY: { value: true, configurable: true } });
    Object.defineProperties(process.stdout, { isTTY: { value: true, configurable: true } });
    await fs.mkdir(path.join(target, ".claude"), { recursive: true });
    await assert.rejects(
      () => setupProject({
        sourceRoot,
        target,
        setupPipeline: "none",
        checkClaude: async () => "1.0.0",
        interactionRunner: async () => ({
          state: expectedOptions,
          controller: { close() {}, renderProgress() {} }
        }),
        provision: async (options) => { provisionOptions = options; throw failure; },
        output
      }),
      (error) => error === failure
    );
    const lock = JSON.parse(await fs.readFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
    assert.equal(lock.setup.status, "failed");
    assert.equal(lock.setup.failedStep, "provision");
    assert.equal(lock.setup.error, failure.message);
    assert.deepEqual(lock.setup.options, setupRetryOptions({
      action: "setup",
      setupPipeline: "none",
      planTuneHooks: false,
      mcpConfig: { mcpServers: [] },
      mcpValues: {},
      ruleConfig: { applyRules: false, ruleMode: "auto", rules: [] },
      optionalSkills: [],
      localSettingsEnv: provisionOptions.localSettingsEnv,
      effortLevel: "medium",
      attributionConfig: { mode: "off" },
      permissionConfig: { bypass: "deny" },
      dryRun: false
    }));
  } finally {
    Object.defineProperties(process.stdin, { isTTY: { value: originalStdin, configurable: true } });
    Object.defineProperties(process.stdout, { isTTY: { value: originalStdout, configurable: true } });
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("provisionProject rolls back failed gstack artifacts and preserves user files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-failure-"));
  const sourceRoot = path.resolve(new URL("../../", import.meta.url).pathname);
  const target = path.join(root, "target");
  const userFile = path.join(target, "notes.txt");
  const output = { summary() {}, audit() {}, style, warn() {} };
  const fakeBin = path.join(root, "fake-bin");
  const originalPath = process.env.PATH;
  try {
    await fs.mkdir(fakeBin, { recursive: true });
    const fakeBun = path.join(fakeBin, "bun");
    await fs.writeFile(fakeBun, `#!${process.execPath}\nconsole.log("1.4.2");\n`);
    await fs.chmod(fakeBun, 0o755);
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath || ""}`;
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(userFile, "keep me\n");
    await assert.rejects(
      () => provisionProject({
        sourceRoot,
        target,
        setupPipeline: "gstack",
        mcpServers: [],
        interactiveSetup: true,
        output,
        resolveGstackCheckout: async () => { throw new Error("injected gstack checkout failure"); }
      }),
      /gstack setup failed:.*Recovery:/s
    );
    assert.equal(await fs.readFile(userFile, "utf8"), "keep me\n");
    await assert.rejects(() => fs.access(path.join(target, ".claude", "skills", "gstack")), { code: "ENOENT" });
    const lock = JSON.parse(await fs.readFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
    assert.equal(lock.gstack.status, "failed");
    assert.match(lock.gstack.error, /injected gstack checkout failure|checkout resolution/);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("provision rollback rejects a symlinked snapshot destination without changing its target", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-rollback-symlink-"));
  const sourceRoot = path.resolve(new URL("../../", import.meta.url).pathname);
  const target = path.join(root, "target");
  const outside = path.join(root, "outside.txt");
  const originalPath = process.env.PATH;
  try {
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(outside, "sentinel\n");
    await fs.symlink(outside, path.join(target, "CLAUDE.md"));
    await assert.rejects(
      () => provisionProject({
        sourceRoot,
        target,
        setupPipeline: "none",
        mcpServers: [],
        interactiveSetup: true,
        output: { summary() {}, audit() {}, style, warn() {} }
      }),
      /provision snapshot source must not be a symlink/
    );
    assert.equal(await fs.readFile(outside, "utf8"), "sentinel\n");
    assert.equal((await fs.lstat(path.join(target, "CLAUDE.md"))).isSymbolicLink(), true);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("interactive setup rejects a symlinked repo-pattern state directory before writing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-setup-symlink-state-"));
  const sourceRoot = path.resolve(new URL("../../", import.meta.url).pathname);
  const target = path.join(root, "target");
  const outside = path.join(root, "outside");
  const originalStdin = process.stdin.isTTY;
  const originalStdout = process.stdout.isTTY;
  const originalCI = process.env.CI;
  let provisionCalled = false;
  try {
    delete process.env.CI;
    Object.defineProperties(process.stdin, { isTTY: { value: true, configurable: true } });
    Object.defineProperties(process.stdout, { isTTY: { value: true, configurable: true } });
    await fs.mkdir(path.join(target, ".claude"), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, path.join(target, ".repo-pattern"), "dir");
    await assert.rejects(
      () => setupProject({
        sourceRoot,
        target,
        setupPipeline: "none",
        checkClaude: async () => "1.0.0",
        interactionRunner: async () => ({
          state: { setupPipeline: "none", planTuneHooks: false, applyRules: false, mcpServers: [], rules: [], optionalSkills: [], mcpValues: {}, localSettingsEnv: {}, effortLevel: "medium", permissionConfig: { bypass: "deny" }, attributionConfig: { mode: "off" } },
          controller: { close() {}, renderProgress() {} }
        }),
        provision: async () => { provisionCalled = true; }
      }),
      /.repo-pattern must not be a symlink/
    );
    assert.equal(provisionCalled, false);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    Object.defineProperties(process.stdin, { isTTY: { value: originalStdin, configurable: true } });
    Object.defineProperties(process.stdout, { isTTY: { value: originalStdout, configurable: true } });
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("MCP input fields deduplicate variables and validate secrets", () => {
  // protects=MCP field extraction, metadata, deduplication, defaults, and required-secret validation; fails_when=duplicate variables survive or invalid values pass; no_claim=live MCP server availability or persistence.
  const fields = mcpInputFields({
    context7: { env: { CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}" }, args: ["${PROJECT_DIR:-.}"] },
    duplicate: { env: { CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}" } }
  });
  assert.deepEqual(fields.map(({ validate: _validate, ...field }) => field), [
    { name: "CONTEXT7_API_KEY", defaultValue: "", kind: "secret", label: "context7: CONTEXT7_API_KEY", placeholder: "ctx7sk-....................." },
    { name: "PROJECT_DIR", defaultValue: ".", kind: "path", label: "context7: PROJECT_DIR" }
  ]);
  assert.equal(fields[0].validate(""), "Required");
  assert.equal(fields[0].validate("ctx7sk-valid"), true);
});

test("permission decisions preserve version, retry, dry-run, and secret filtering rules", async () => {
  // protects=permission scope decisions, retry persistence, provider URL validation, and secret filtering; fails_when=wrong scope, unsafe retry state, or secret persistence occurs; no_claim=physical TTY prompts or filesystem write failures.
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    assert.equal(claudeVersionSupportsUserScope("2.1.256"), false);
    assert.equal(claudeVersionSupportsUserScope("2.1.257"), true);
  assert.equal(claudeVersionSupportsUserScope("unknown"), false);
  assert.equal(localSettingsPromptOptions({ ANTHROPIC_BASE_URL: "not-a-url" }, {}).ANTHROPIC_BASE_URL.initial, "");
  assert.equal(localSettingsPromptOptions({}, { ANTHROPIC_BASE_URL: "https://provider.example/v1" }).ANTHROPIC_BASE_URL.initial, "https://provider.example/v1");
  const retryOptions = setupRetryOptions({ action: "setup", setupPipeline: "none", mcpConfig: { mcpServers: [] }, ruleConfig: { applyRules: false, ruleMode: "auto", rules: [] }, optionalSkills: [], localSettingsEnv: { ANTHROPIC_AUTH_TOKEN: "secret", CONTEXT7_API_KEY: "secret", TAVILY_API_KEY: "secret", ANTHROPIC_BASE_URL: "https://provider.example/v1" }, attributionConfig: { mode: "off" }, permissionConfig: { bypass: "user" } });
  assert.deepEqual(retryOptions.localSettingsEnv, { ANTHROPIC_BASE_URL: "https://provider.example/v1" });
  assert.deepEqual(setupOptionsFromLock({ setup: { status: "failed", options: retryOptions } }).permissionConfig, { bypass: "user" });
  assert.deepEqual(setupOptionsFromLock({ setup: { status: "running", options: retryOptions } }).permissionConfig, { bypass: "user" });
  assert.deepEqual(setupOptionsFromLock({ setup: { status: "failed", options: { ...retryOptions, permissionConfig: { bypass: "invalid" } } } }).permissionConfig, { bypass: "deny" });

  const confirm = async () => true;
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
    [{ claudeCodeVersion: "2.1.257", selectedBypass: "allow", confirm, setUserBypass: writeSuccess }, { bypass: "user" }],
    [{ claudeCodeVersion: "2.1.257", selectedBypass: "allow", confirm, setUserBypass: writeExisting }, { bypass: "user" }],
    [{ claudeCodeVersion: "2.1.257", selectedBypass: "allow", confirm, setUserBypass: writeFailure }, { bypass: "deny" }],
    [{ claudeCodeVersion: "2.1.257", legacyBypass: true, selectedBypass: "allow", confirm, setUserBypass: writeFailure }, { bypass: "preserve" }],
    [{ claudeCodeVersion: "2.1.257", retryChoice: "retry", selectedBypass: "allow", confirm: async () => false }, { bypass: "deny" }],
    [{ claudeCodeVersion: "2.1.257", retryChoice: "retry", selectedBypass: "allow", confirm: async () => true, setUserBypass: writeSuccess }, { bypass: "user" }],
    [{ claudeCodeVersion: "2.1.257", retryChoice: "retry", selectedBypass: "user" }, { bypass: "user" }],
    [{ claudeCodeVersion: "2.1.257", retryChoice: "retry", selectedBypass: "preserve" }, { bypass: "preserve" }],
    [{ claudeCodeVersion: "2.1.257", retryChoice: "retry", selectedBypass: "deny" }, { bypass: "deny" }],
    [{ claudeCodeVersion: "2.1.256", retryChoice: "retry", selectedBypass: "deny" }, { bypass: "deny" }],
    [{ claudeCodeVersion: "2.1.256", retryChoice: "retry", selectedBypass: "user" }, { bypass: "allow" }],
    [{ claudeCodeVersion: "2.1.257", dryRun: true, selectedBypass: "allow" }, { bypass: "deny" }],
    [{ claudeCodeVersion: "2.1.257", dryRun: true, migrationChoice: "yes", legacyBypass: true }, { bypass: "preserve" }]
  ];
  for (const [input, expected] of choices) assert.deepEqual(await choosePermissionConfig(input), expected);
  for (const bypass of ["deny", "user"]) {
    let writes = 0;
    const result = await choosePermissionConfig({ claudeCodeVersion: "2.1.257", dryRun: true, selectedBypass: bypass, setUserBypass: async () => { writes++; return { changed: true }; } });
    assert.deepEqual(result, { bypass });
    assert.equal(writes, 0);
  }
    assert.match(warnings.join("\n"), /ineffective in Claude Code v2\.1\.257\+/);
  } finally {
    console.warn = originalWarn;
  }
});
