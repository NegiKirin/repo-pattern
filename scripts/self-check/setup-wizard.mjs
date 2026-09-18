import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { SetupWizard, effortColor, nextEffortCursor, nextMenuCursor, previousPageIndex, pruneWizardState, renderEffortOptions, wizardPages } from "../lib/setup-wizard.mjs";

const data = {
  claudeCodeVersion: "1.0.0",
  profiles: ["web", "custom"],
  profileServers: { web: ["context7"], custom: [] },
  mcpServers: ["context7"],
  ruleModes: ["auto", "manual", "none"],
  mcpInputs: (profile, servers) => (profile === "custom" ? servers : ["context7"]).flatMap((server) => server === "context7" ? [
    { name: "CONTEXT7_API_KEY", kind: "secret", label: "context7: CONTEXT7_API_KEY", defaultValue: "", placeholder: "ctx7sk-.....................", validate: (value) => value ? true : "Required" },
    { name: "TAVILY_API_KEY", kind: "secret", label: "tavily: TAVILY_API_KEY", defaultValue: "", placeholder: "tvly-...................", validate: (value) => value ? true : "Required" }
  ] : []),
  rules: ["common", "typescript"],
  optionalSkills: [{ value: "herdr", label: "herdr" }],
  localSettings: [
    { name: "ANTHROPIC_BASE_URL", initial: "", placeholder: "https://example.com/v1", validate: (value) => /^https?:\/\//.test(value) ? true : "Use a valid URL." },
    { name: "ANTHROPIC_AUTH_TOKEN", initial: "", placeholder: "token", mask: true, validate: (value) => value ? true : "Required" },
    { name: "ANTHROPIC_DEFAULT_OPUS_MODEL", initial: "", placeholder: "claude-opus-4-8", validate: (value) => value ? true : "Required" },
    { name: "ANTHROPIC_DEFAULT_SONNET_MODEL", initial: "", placeholder: "claude-sonnet-4-6", validate: (value) => value ? true : "Required" },
    { name: "ANTHROPIC_DEFAULT_HAIKU_MODEL", initial: "", placeholder: "claude-haiku-4-5", validate: (value) => value ? true : "Required" }
  ]
};

export async function runSetupWizardChecks() {
  const initial = {
    setupPipeline: "both",
    planTuneHooks: false,
    applyRules: true,
    profile: "custom",
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
  assert.deepEqual(renderEffortOptions(["low", "medium", "ultracode"], "ultracode"), [
    { value: "low", label: "low", color: undefined },
    { value: "medium", label: "medium", color: undefined },
    { value: "ultracode", label: "[ultracode]", color: "magenta" }
  ]);
  const pages = wizardPages(initial, data);
  assert.equal(pages.some((page) => page.id === "planTuneHooks"), false);
  assert.equal(pruneWizardState(initial, data).planTuneHooks, true);
  assert.ok(pages.some((page) => page.id === "mcpServers"));
  assert.ok(pages.some((page) => page.id === "rules"));
  assert.equal(pages.findIndex((page) => page.id === "ruleMode") < pages.findIndex((page) => page.id === "profile"), true);
  assert.equal(previousPageIndex(pages, pages.findIndex((page) => page.id === "mcpServers")), pages.findIndex((page) => page.id === "profile"));
  const mcpPage = pages.find((page) => page.id === "mcpInputs");
  assert.ok(mcpPage);
  assert.deepEqual(mcpPage.fields.map((field) => field.name), ["CONTEXT7_API_KEY", "TAVILY_API_KEY"]);
  assert.equal(pages.findIndex((page) => page.id === "mcpInputs") < pages.findIndex((page) => page.id === "optionalSkills"), true);
  const modelPage = pages.find((page) => page.id === "modelSettings");
  assert.ok(modelPage);
  assert.deepEqual(modelPage.fields.map((field) => field.name), [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL"
  ]);
  assert.equal(pages.some((page) => page.id === "local:ANTHROPIC_AUTH_TOKEN"), true);
  assert.equal(pages.some((page) => page.id === "local:ANTHROPIC_DEFAULT_OPUS_MODEL"), false);

  const namedProfile = pruneWizardState({ ...initial, profile: "web" }, data);
  assert.deepEqual(namedProfile.mcpServers, null);
  assert.deepEqual(namedProfile.mcpValues, { CONTEXT7_API_KEY: "secret-value" });
  assert.equal(wizardPages(namedProfile, data).some((page) => page.id === "mcpServers"), false);

  const noEcc = pruneWizardState({ ...initial, setupPipeline: "gstack", applyRules: false }, data);
  assert.ok(wizardPages(noEcc, data).some((page) => page.id === "installRules"));
  assert.equal(wizardPages(noEcc, data).some((page) => page.id === "rules"), false);
  assert.deepEqual(noEcc.rules, []);
  assert.ok(wizardPages({ ...noEcc, applyRules: true }, data).some((page) => page.id === "ruleMode"));
  assert.deepEqual(wizardPages({ ...initial, retryChoice: "retry" }, data).map((page) => page.id), ["confirm"]);
  assert.deepEqual(wizardPages({ ...initial, migrationChoice: "pending" }, data).map((page) => page.id).slice(0, 2), ["migrationChoice", "pipeline"]);

  const noCustomAttribution = pruneWizardState({ ...initial, attributionConfig: { mode: "on", commit: "old" } }, data);
  assert.equal(wizardPages(noCustomAttribution, data).some((page) => page.id === "attributionCommit"), false);
  assert.equal("commit" in noCustomAttribution.attributionConfig, false);

  const effortWizard = render(React.createElement(SetupWizard, {
    initialState: {
      ...initial,
      setupPipeline: "none",
      applyRules: false,
      profile: "web",
      mcpServers: null,
      optionalSkills: [],
      effortLevel: "medium",
      attributionConfig: { mode: "off" }
    },
    data,
    initialPageId: "effort",
    done: () => {}
  }));
  effortWizard.stdin.write("[C");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(effortWizard.lastFrame(), /\[high\]/);
  assert.match(effortWizard.lastFrame(), /Claude Code · 1\.0\.0/);
  effortWizard.unmount();

  const modelWizard = render(React.createElement(SetupWizard, {
    initialState: { ...initial, setupPipeline: "none", applyRules: false, profile: "web", mcpServers: null, optionalSkills: [] },
    data,
    initialPageId: "modelSettings",
    done: () => {}
  }));
  assert.match(modelWizard.lastFrame(), /Anthropic settings/);
  assert.match(modelWizard.lastFrame(), /› ANTHROPIC_BASE_URL:/);
  assert.match(modelWizard.lastFrame(), /ANTHROPIC_DEFAULT_OPUS_MODEL:/);
  modelWizard.stdin.write("[B");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(modelWizard.lastFrame(), /› ANTHROPIC_DEFAULT_OPUS_MODEL:/);
  modelWizard.stdin.write("[A");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(modelWizard.lastFrame(), /› ANTHROPIC_BASE_URL:/);
  modelWizard.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(modelWizard.lastFrame(), /› ANTHROPIC_DEFAULT_OPUS_MODEL:/);
  modelWizard.unmount();

  const mcpWizard = render(React.createElement(SetupWizard, {
    initialState: { ...initial, mcpValues: {}, setupPipeline: "none", applyRules: false, profile: "web", mcpServers: null, optionalSkills: [] },
    data,
    initialPageId: "mcpInputs",
    done: () => {}
  }));
  assert.match(mcpWizard.lastFrame(), /MCP secret/);
  assert.match(mcpWizard.lastFrame(), /  context7:/);
  assert.match(mcpWizard.lastFrame(), /› CONTEXT7_API_KEY:/);
  assert.match(mcpWizard.lastFrame(), /ctx7sk-\.\.\.+/);
  assert.match(mcpWizard.lastFrame(), /tavily:/);
  assert.match(mcpWizard.lastFrame(), /TAVILY_API_KEY:/);
  assert.match(mcpWizard.lastFrame(), /tvly-\.\.\.+/);
  assert.doesNotMatch(mcpWizard.lastFrame(), /secret-value/);
  mcpWizard.stdin.write("[B");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(mcpWizard.lastFrame(), /› TAVILY_API_KEY:/);
  mcpWizard.stdin.write("[A");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(mcpWizard.lastFrame(), /› CONTEXT7_API_KEY:/);
  mcpWizard.stdin.write("first-secret");
  await new Promise((resolve) => setTimeout(resolve, 20));
  mcpWizard.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(mcpWizard.lastFrame(), /› TAVILY_API_KEY:/);
  assert.doesNotMatch(mcpWizard.lastFrame(), /first-secret/);
  mcpWizard.stdin.write("second-secret");
  await new Promise((resolve) => setTimeout(resolve, 20));
  mcpWizard.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(mcpWizard.lastFrame(), /Optional external skills/);
  mcpWizard.unmount();
}
