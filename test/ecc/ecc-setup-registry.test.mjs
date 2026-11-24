import "../fixtures/offline-guard.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { ECC_PLUGIN, applyEccPluginSettings, setupEcc } from "../../src/ecc/ecc.mjs";
import { ECC_RULE_PACKS, invalidEccRules, normalizeEccRules, selectEccRules } from "../../src/ecc/ecc-rules.mjs";
import { ECC_RULE_REGISTRY } from "../../src/ecc/ecc-rule-registry.mjs";

test("ECC registry handles partial detection without inventing language rules", () => {
  assert.deepEqual(selectEccRules({}), ["common"]);
  assert.deepEqual(selectEccRules({ languages: [], frameworks: [], tools: [], repoType: "backend" }), ["common"]);
  assert.deepEqual(selectEccRules({ languages: [], frameworks: [], tools: ["frontend-tooling"], repoType: "generic" }), ["common", "typescript", "web"]);
  assert.deepEqual(selectEccRules({ languages: [], frameworks: ["nuxt"], tools: [], repoType: "generic" }), ["common", "nuxt", "typescript", "vue", "web"]);
  assert.deepEqual(normalizeEccRules(["missing", "common", "common", "python"]), ["common", "python"]);
});

test("ECC registry selects every language and frontend rule deterministically", () => {
  assert.equal(ECC_RULE_PACKS.length, ECC_RULE_REGISTRY.length);
  assert.equal(ECC_RULE_PACKS[0], "common");
  const detection = {
    languages: ["arkts", "cpp", "csharp", "dart", "fsharp", "go", "java", "kotlin", "perl", "php", "python", "ruby", "rust", "swift", "typescript", "javascript"],
    frameworks: ["angular", "nextjs", "nuxt", "react", "react-native", "vue"],
    tools: ["frontend-tooling"],
    repoType: "fullstack"
  };
  assert.deepEqual(selectEccRules(detection), ECC_RULE_PACKS);
  assert.deepEqual(normalizeEccRules(["python", "python", "missing", "common"]), ["python", "common"]);
  assert.deepEqual(invalidEccRules(["python", "missing", "missing"]), ["missing"]);
});

test("ECC plugin settings preserve existing settings and configure the managed marketplace", () => {
  const settings = applyEccPluginSettings({ hooks: { PreToolUse: [] }, enabledPlugins: { other: true } });
  assert.deepEqual(settings.hooks, { PreToolUse: [] });
  assert.equal(settings.enabledPlugins.other, true);
  assert.equal(settings.enabledPlugins[ECC_PLUGIN.id], true);
  assert.deepEqual(settings.extraKnownMarketplaces.ecc, ECC_PLUGIN.marketplace);
});

test("setupEcc passes target to an external setup command and propagates failure", async () => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-ecc-command-"));
  const previousCommand = process.env.REPO_PATTERN_ECC_SETUP_CMD;
  const previousPath = process.env.PATH;
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-ecc-bin-"));
  try {
    await fs.writeFile(path.join(bin, "claude"), "#!/bin/sh\nexit 127\n", { mode: 0o755 });
    process.env.PATH = `${bin}${path.delimiter}${previousPath || ""}`;
    process.env.REPO_PATTERN_ECC_SETUP_CMD = "exit 17";
    const error = await setupEcc({ target, configurePlugin: false, silent: true }).then(() => null, (failure) => failure);
    assert(error, "external ECC setup command unexpectedly succeeded");
    assert.equal(error.status, 17);
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(bin, { recursive: true, force: true });
    if (previousCommand === undefined) delete process.env.REPO_PATTERN_ECC_SETUP_CMD;
    else process.env.REPO_PATTERN_ECC_SETUP_CMD = previousCommand;
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("setupEcc records manual, dry-run command, and tracked-file contracts", async () => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-ecc-setup-"));
  const previousCommand = process.env.REPO_PATTERN_ECC_SETUP_CMD;
  try {
    const status = await setupEcc({ target, configurePlugin: false, silent: true });
    assert.ok(["installed", "manual-plugin-install-required"].includes(status));
    let lock = JSON.parse(await fs.readFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
    assert.equal(lock.ecc.status, status);
    const dryRun = await setupEcc({ target, configurePlugin: false, dryRun: true, silent: true });
    assert.equal(dryRun, status === "installed" ? "installed" : "manual-plugin-install-required");
    lock = JSON.parse(await fs.readFile(path.join(target, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
    assert.equal(lock.ecc.status, dryRun);
  } finally {
    if (previousCommand === undefined) delete process.env.REPO_PATTERN_ECC_SETUP_CMD;
    else process.env.REPO_PATTERN_ECC_SETUP_CMD = previousCommand;
    await fs.rm(target, { recursive: true, force: true });
  }
});
