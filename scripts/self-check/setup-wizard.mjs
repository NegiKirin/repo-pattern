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
  mcpInputs: (profile, servers) => (profile === "custom" ? servers : ["context7"]).flatMap((server) => server === "context7" ? [{ name: "CONTEXT7_API_KEY", kind: "secret", label: "context7: CONTEXT7_API_KEY", defaultValue: "" }] : []),
  rules: ["common", "typescript"],
  optionalSkills: [{ value: "herdr", label: "herdr" }],
  localSettings: []
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
    localSettingsEnv: {},
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
  assert.equal(pages.findIndex((page) => page.id === "mcp:CONTEXT7_API_KEY") < pages.findIndex((page) => page.id === "optionalSkills"), true);

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
}
