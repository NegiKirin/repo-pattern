import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import { SetupWizard, effortColor, nextEffortCursor, nextMenuCursor, previousPageIndex, pruneWizardState, renderEffortOptions, wizardPages } from "../lib/setup-wizard.mjs";

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

export async function runSetupWizardChecks() {
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
  assert.equal(pages.some((page) => page.id === "planTuneHooks"), false);
  assert.equal(pruneWizardState(initial, data).planTuneHooks, true);
  assert.ok(pages.some((page) => page.id === "mcpServers"));
  assert.ok(pages.some((page) => page.id === "rules"));
  assert.equal(previousPageIndex(pages, pages.findIndex((page) => page.id === "mcpServers")), pages.findIndex((page) => page.id === "rules"));
  const mcpPage = pages.find((page) => page.id === "mcpInputs");
  assert.deepEqual(mcpPage.fields.map((field) => field.name), ["CONTEXT7_API_KEY"]);
  assert.equal(pages.findIndex((page) => page.id === "mcpInputs") < pages.findIndex((page) => page.id === "optionalSkills"), true);
  assert.deepEqual(pruneWizardState({ ...initial, mcpServers: [] }, data).mcpValues, {});
  assert.ok(wizardPages({ ...initial, mcpServers: [] }, data).every((page) => page.id !== "mcpInputs"));

  const noEcc = pruneWizardState({ ...initial, setupPipeline: "gstack", applyRules: false }, data);
  assert.ok(wizardPages(noEcc, data).some((page) => page.id === "installRules"));
  assert.equal(wizardPages(noEcc, data).some((page) => page.id === "rules"), false);
  assert.deepEqual(noEcc.rules, []);
  assert.deepEqual(wizardPages({ ...initial, retryChoice: "retry" }, data).map((page) => page.id), ["confirm"]);

  const serverWizard = render(React.createElement(SetupWizard, {
    initialState: { ...initial, setupPipeline: "none", applyRules: false, optionalSkills: [] },
    data,
    initialPageId: "mcpServers",
    done: () => {}
  }));
  assert.match(serverWizard.lastFrame(), /Core \/ Must have/);
  assert.match(serverWizard.lastFrame(), /Development tools/);
  assert.match(serverWizard.lastFrame(), /› ◉ context7 — Live documentation lookup/);
  serverWizard.stdin.write(" ");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(serverWizard.lastFrame(), /○ context7/);
  serverWizard.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(serverWizard.lastFrame(), /Optional external skills/);
  serverWizard.unmount();

  const skillsWizard = render(React.createElement(SetupWizard, {
    initialState: { ...initial, setupPipeline: "none", applyRules: false, mcpServers: [], optionalSkills: [] },
    data,
    initialPageId: "optionalSkills",
    done: () => {}
  }));
  assert.match(skillsWizard.lastFrame(), /Terminal workflow/);
  assert.match(skillsWizard.lastFrame(), /› ○ herdr/);
  skillsWizard.stdin.write(" ");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(skillsWizard.lastFrame(), /◉ herdr/);
  skillsWizard.unmount();

  const effortWizard = render(React.createElement(SetupWizard, {
    initialState: { ...initial, setupPipeline: "none", applyRules: false, mcpServers: [], optionalSkills: [], effortLevel: "medium" },
    data,
    initialPageId: "effort",
    done: () => {}
  }));
  effortWizard.stdin.write("\u001b[C");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(effortWizard.lastFrame(), /\[high\]/);
  assert.match(effortWizard.lastFrame(), /Claude Code · 1\.0\.0/);
  effortWizard.unmount();

  const modelWizard = render(React.createElement(SetupWizard, {
    initialState: { ...initial, setupPipeline: "none", applyRules: false, mcpServers: [], optionalSkills: [] },
    data,
    initialPageId: "modelSettings",
    done: () => {}
  }));
  assert.match(modelWizard.lastFrame(), /Configure third-party provider & models/);
  assert.match(modelWizard.lastFrame(), /› ANTHROPIC_BASE_URL:/);
  modelWizard.stdin.write("\u001b[B");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(modelWizard.lastFrame(), /› ANTHROPIC_AUTH_TOKEN:/);
  modelWizard.unmount();

  const mcpWizard = render(React.createElement(SetupWizard, {
    initialState: { ...initial, mcpValues: {}, setupPipeline: "none", applyRules: false, optionalSkills: [] },
    data,
    initialPageId: "mcpInputs",
    done: () => {}
  }));
  assert.match(mcpWizard.lastFrame(), /MCP secret/);
  assert.match(mcpWizard.lastFrame(), /context7:/);
  assert.match(mcpWizard.lastFrame(), /› CONTEXT7_API_KEY:/);
  assert.doesNotMatch(mcpWizard.lastFrame(), /secret-value/);
  mcpWizard.stdin.write("first-secret");
  await new Promise((resolve) => setTimeout(resolve, 20));
  mcpWizard.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(mcpWizard.lastFrame(), /Optional external skills/);
  mcpWizard.unmount();
}
