import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject } from "../lib/audit.mjs";
import { doctorProject } from "../lib/doctor.mjs";
import { provisionProject } from "../lib/provision.mjs";
import { writeEccGitFixture } from "./fixtures.mjs";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const secretSentinel = "do-not-persist-anthropic-token";
const originalLog = console.log;
export async function runGstackProvisionChecks() {
const originalGstackSetupCommand = process.env.REPO_PATTERN_GSTACK_SETUP_CMD;
const gstackProvisionTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-provision-"));
console.log = () => {};
try {
  await fs.mkdir(path.join(gstackProvisionTarget, ".claude", "rules", "ecc", "typescript"), { recursive: true });
  await fs.writeFile(path.join(gstackProvisionTarget, ".claude", "settings.local.json"), JSON.stringify({
    workflowSizeGuideline: "large",
    custom: true,
    attribution: { commit: "legacy", pr: "legacy" },
    env: { ANTHROPIC_AUTH_TOKEN: secretSentinel },
    enabledPlugins: {
      "ecc@ecc": true,
      "taste-skill@taste-skill": true,
      "unknown@plugin": true
    },
    extraKnownMarketplaces: {
      ecc: { source: { source: "git", url: "https://github.com/affaan-m/ECC.git" } },
      "taste-skill": { source: { source: "git", url: "https://example.com/taste.git" } },
      unknown: { source: { source: "git", url: "https://example.com/unknown.git" } }
    }
  }), { mode: 0o600 });
  process.env.REPO_PATTERN_GSTACK_SETUP_CMD = "true";
  await writeEccGitFixture(gstackProvisionTarget);
  await provisionProject({
    sourceRoot: repoRoot,
    target: gstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "gstack",
    applyRules: true
  });
  const repoConfig = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  const lock = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  assert.equal(repoConfig.workflow, "gstack");
  assert.equal(repoConfig.ecc.rulesSync, "repo-pattern-auto-cache");
  assert.equal(lock.setupPipeline, "gstack");
  assert.equal(lock.gstack.status, "installed");
  assert.equal(lock.gstack.planTuneHooks, false);
  assert.deepEqual(lock.ecc.appliedRules, ["common"]);
  const gstackLocalSettings = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  assert.equal(gstackLocalSettings.enabledPlugins["ecc@ecc"], undefined);
  assert.equal(gstackLocalSettings.enabledPlugins["taste-skill@taste-skill"], undefined);
  assert.equal(gstackLocalSettings.enabledPlugins["unknown@plugin"], true);
  assert.equal(gstackLocalSettings.extraKnownMarketplaces.ecc, undefined);
  assert.equal(gstackLocalSettings.extraKnownMarketplaces["taste-skill"], undefined);
  assert.equal(gstackLocalSettings.extraKnownMarketplaces.unknown.source.url, "https://example.com/unknown.git");
  assert.equal("attribution" in gstackLocalSettings, false);
  assert.equal(gstackLocalSettings.custom, true);
  assert.equal(gstackLocalSettings.workflowSizeGuideline, "large");
  assert.equal(gstackLocalSettings.env.ANTHROPIC_AUTH_TOKEN, secretSentinel);
  await fs.access(path.join(gstackProvisionTarget, ".claude", "rules", "ecc", "common"));
  assert.equal((await auditProject(gstackProvisionTarget)).state, "GSTACK_MINIMAL");
  await doctorProject(gstackProvisionTarget);

  await provisionProject({
    sourceRoot: repoRoot,
    target: gstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "both",
    optionalSkills: ["nextjs-pattern"],
    applyRules: false
  });
  await fs.access(path.join(gstackProvisionTarget, ".claude", "skills", "nextjs-pattern"));

  await provisionProject({
    sourceRoot: repoRoot,
    target: gstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "both",
    optionalSkills: ["impeccable"],
    applyRules: false
  });
  await assert.rejects(() => fs.access(path.join(gstackProvisionTarget, ".claude", "skills", "nextjs-pattern")), { code: "ENOENT" });
  const reconciledLocalSettings = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  const reconciledLock = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  assert.equal(reconciledLocalSettings.enabledPlugins["ecc@ecc"], true);
  assert.equal(reconciledLocalSettings.enabledPlugins["taste-skill@taste-skill"], undefined);
  assert.equal(reconciledLocalSettings.enabledPlugins["impeccable@impeccable"], true);
  assert.equal(reconciledLocalSettings.enabledPlugins["unknown@plugin"], true);
  assert.equal(reconciledLocalSettings.extraKnownMarketplaces["taste-skill"], undefined);
  assert.equal(reconciledLocalSettings.extraKnownMarketplaces.impeccable.source.url, "https://github.com/pbakaus/impeccable.git");
  assert.equal(reconciledLocalSettings.extraKnownMarketplaces.unknown.source.url, "https://example.com/unknown.git");
  assert.equal(reconciledLocalSettings.env.ANTHROPIC_AUTH_TOKEN, secretSentinel);
  assert.equal(reconciledLock.ecc.appliedRules.length, 0);
  await assert.rejects(() => fs.access(path.join(gstackProvisionTarget, ".claude", "rules", "ecc", "common")), { code: "ENOENT" });
  await assert.rejects(() => fs.access(path.join(gstackProvisionTarget, ".claude", "rules")), { code: "ENOENT" });

  await provisionProject({
    sourceRoot: repoRoot,
    target: gstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "gstack",
    optionalSkills: [],
    applyRules: false
  });
  const deselectedLocalSettings = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  const deselectedConfig = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  const deselectedLock = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  assert.deepEqual(deselectedConfig.optionalSkills, []);
  assert.equal(deselectedConfig.runtime.localSkills, false);
  assert.deepEqual(deselectedLock.optionalSkills.appliedSkills, []);
  assert.equal(deselectedLocalSettings.enabledPlugins["ecc@ecc"], undefined);
  assert.equal(deselectedLocalSettings.enabledPlugins["impeccable@impeccable"], undefined);
  assert.equal(deselectedLocalSettings.enabledPlugins["unknown@plugin"], true);

  const idempotentSnapshot = JSON.stringify({
    settings: deselectedLocalSettings,
    config: deselectedConfig,
    appliedSkills: deselectedLock.optionalSkills.appliedSkills,
    appliedRules: deselectedLock.ecc?.appliedRules || []
  });
  await provisionProject({
    sourceRoot: repoRoot,
    target: gstackProvisionTarget,
    profile: "minimal",
    setupPipeline: "gstack",
    optionalSkills: [],
    applyRules: false
  });
  const idempotentSettings = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".claude", "settings.local.json"), "utf8"));
  const idempotentConfig = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  const idempotentLock = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  assert.equal(JSON.stringify({
    settings: idempotentSettings,
    config: idempotentConfig,
    appliedSkills: idempotentLock.optionalSkills.appliedSkills,
    appliedRules: idempotentLock.ecc?.appliedRules || []
  }), idempotentSnapshot);
} finally {
  if (originalGstackSetupCommand === undefined) delete process.env.REPO_PATTERN_GSTACK_SETUP_CMD;
  else process.env.REPO_PATTERN_GSTACK_SETUP_CMD = originalGstackSetupCommand;
  console.log = originalLog;
  await fs.rm(gstackProvisionTarget, { recursive: true, force: true });
}

}
