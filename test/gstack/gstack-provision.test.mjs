import "../fixtures/offline-guard.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject } from "../../src/audit.mjs";
import { doctorProject } from "../../src/doctor.mjs";
import { GSTACK_REVIEW_SIDECARS, resolveGstackCheckout } from "../../src/gstack/gstack.mjs";
import { provisionProject } from "../../src/setup/provision.mjs";
import { commitGstackFixture, installGstackSafetyFixture, installGstackUpstreamSetupFixture, writeEccGitFixture } from "../fixtures/fixtures.mjs";
import { test } from "node:test";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(cliDir));
const secretSentinel = "do-not-persist-anthropic-token";
const originalLog = console.log;

// ponytail: synthetic pins cover provisioning integration, not upstream authenticity; use an opt-in live lane for that.
async function installOptionalSkillGitShim(root) {
  const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  const shimDir = path.join(root, "git-shim");
  const fixtureRoot = path.join(root, "optional-skill-fixtures");
  await fs.mkdir(shimDir, { recursive: true });
  for (const [name, source, revision] of [["nextjs-pattern", "https://github.com/NegiKirin/nextjs-pattern.git", "d5b1ac4ea33f6054841ed9d8005ac587ab2a9a5d"], ["impeccable", "https://github.com/pbakaus/impeccable.git", "88f52ac4e6a5ce99d39a0f5d89e7ac3a168910f5"]]) {
    const fixture = path.join(fixtureRoot, name);
    await fs.mkdir(path.join(fixture, ".claude", "skills", "impeccable"), { recursive: true });
    await fs.writeFile(path.join(fixture, "SKILL.md"), `Fixture ${name}\n`);
    if (name === "impeccable") await fs.writeFile(path.join(fixture, ".claude", "skills", "impeccable", "SKILL.md"), `Fixture ${name}\n`);
    assert.equal(spawnSync(realGit, ["init", "-q"], { cwd: fixture }).status, 0);
    assert.equal(spawnSync(realGit, ["add", "."], { cwd: fixture }).status, 0);
    assert.equal(spawnSync(realGit, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"], { cwd: fixture }).status, 0);
  }
  const gitScript = `#!/usr/bin/env node\nimport { spawnSync } from 'node:child_process';\nimport fs from 'node:fs';\nimport path from 'node:path';\nconst args = process.argv.slice(2);\nconst remotes = new Map(${JSON.stringify([["https://github.com/NegiKirin/nextjs-pattern.git", "d5b1ac4ea33f6054841ed9d8005ac587ab2a9a5d"], ["https://github.com/pbakaus/impeccable.git", "88f52ac4e6a5ce99d39a0f5d89e7ac3a168910f5"]])});\nif (args[0] === 'clone') { const remote = [...remotes.keys()].find((value) => args.includes(value)); if (!remote) process.exit(97); const destination = args.at(-1); fs.cpSync(${JSON.stringify(fixtureRoot)} + '/' + (remote.includes('impeccable') ? 'impeccable' : 'nextjs-pattern'), destination, { recursive: true }); process.exit(0); }\nif ([ 'fetch', 'pull' ].includes(args[0])) process.exit(97);\nif (args[0] === 'checkout' && [${JSON.stringify(path.join(root, ".repo-pattern/cache/skills/nextjs-pattern"))}, ${JSON.stringify(path.join(root, ".repo-pattern/cache/skills/impeccable"))}].includes(path.resolve(process.cwd()))) { const expected = process.cwd().endsWith('/impeccable') ? remotes.get('https://github.com/pbakaus/impeccable.git') : remotes.get('https://github.com/NegiKirin/nextjs-pattern.git'); process.exit(args.length === 3 && args[1] === '--quiet' && args[2] === expected ? 0 : 97); }\nif (args[0] === 'rev-parse' && args.at(-1) === 'HEAD') { const cwd = path.resolve(process.cwd()); const roots = new Map([ [${JSON.stringify(path.join(root, ".repo-pattern/cache/skills/nextjs-pattern"))}, remotes.get('https://github.com/NegiKirin/nextjs-pattern.git')], [${JSON.stringify(path.join(root, ".repo-pattern/cache/skills/impeccable"))}, remotes.get('https://github.com/pbakaus/impeccable.git')] ]); const revision = roots.get(cwd); if (revision) { process.stdout.write(revision + '\\n'); process.exit(0); } }\nconst result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' }); process.exit(result.status ?? 1);\n`;
  await fs.writeFile(path.join(shimDir, "git"), gitScript, { mode: 0o755 });
  return { shimDir, fixtureRoot };
}
export async function runGstackProvisionChecks() {
const gstackProvisionTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-provision-"));
const originalPath = process.env.PATH;
try {
const shim = await installOptionalSkillGitShim(gstackProvisionTarget);
process.env.PATH = `${shim.shimDir}${path.delimiter}${originalPath || ""}`;
console.log = () => {};
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
  const gstackCheckout = path.join(gstackProvisionTarget, ".claude", "skills", "gstack");
const fixtureResolver = (options) => resolveGstackCheckout({ ...options, expectedCommit: null, globalCheckout: path.join(gstackProvisionTarget, "missing-global"), clone: () => { throw new Error("gstack fixture clone escape"); } });
  await fs.mkdir(gstackCheckout, { recursive: true });
  await installGstackUpstreamSetupFixture(gstackCheckout);
  await installGstackSafetyFixture(gstackCheckout);
  await fs.writeFile(path.join(gstackCheckout, "SKILL.md"), "Project-local gstack", "utf8");
  await fs.mkdir(path.join(gstackCheckout, "review"), { recursive: true });
  await fs.writeFile(path.join(gstackCheckout, "review", "SKILL.md"), "Review", "utf8");
  for (const sidecar of GSTACK_REVIEW_SIDECARS) {
    await fs.mkdir(path.dirname(path.join(gstackCheckout, sidecar)), { recursive: true });
    await fs.writeFile(path.join(gstackCheckout, sidecar), `Fixture ${sidecar}`, "utf8");
  }
  spawnSync("git", ["init"], { cwd: gstackCheckout, stdio: "ignore" });
  commitGstackFixture(gstackCheckout);
  await fs.mkdir(path.join(gstackProvisionTarget, ".repo-pattern"), { recursive: true });
  await fs.writeFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.json"), JSON.stringify({
    workflow: "gstack",
    runtime: { localSkills: false, localCommands: false, localHooks: false, localScripts: false, localRules: false }
  }), "utf8");
  await writeEccGitFixture(gstackProvisionTarget);
  await provisionProject({
    sourceRoot: repoRoot,
    target: gstackProvisionTarget,
    mcpServers: ["context7", "tavily", "gitnexus"],
    setupPipeline: "gstack",
    migrate: true,
    applyRules: true,
    resolveGstackCheckout: fixtureResolver
  });
  const repoConfig = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.json"), "utf8"));
  const lock = JSON.parse(await fs.readFile(path.join(gstackProvisionTarget, ".repo-pattern", ".repo-pattern.lock.json"), "utf8"));
  assert.equal(repoConfig.workflow, "gstack");
  assert.equal(repoConfig.ecc.rulesSync, "repo-pattern-auto-cache");
  assert.equal(lock.setupPipeline, "gstack");
  assert.equal(lock.gstack.status, "installed");
  assert.equal(lock.gstack.planTuneHooks, false);
  for (const sidecar of GSTACK_REVIEW_SIDECARS) {
    assert.equal(await fs.readFile(path.join(gstackProvisionTarget, ".claude", "skills", sidecar), "utf8"), `Fixture ${sidecar}`);
  }
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

  await fs.writeFile(path.join(gstackCheckout, "user-added.md"), "Preserve local document.\n");
  await provisionProject({
    sourceRoot: repoRoot,
    target: gstackProvisionTarget,
    mcpServers: ["context7", "tavily", "gitnexus"],
    setupPipeline: "both",
    optionalSkills: ["nextjs-pattern"],
    applyRules: false,
    resolveGstackCheckout: fixtureResolver
  });
  await fs.access(path.join(gstackProvisionTarget, ".claude", "skills", "nextjs-pattern"));

  await provisionProject({
    sourceRoot: repoRoot,
    target: gstackProvisionTarget,
    mcpServers: ["context7", "tavily", "gitnexus"],
    setupPipeline: "both",
    optionalSkills: ["impeccable"],
    applyRules: false,
    resolveGstackCheckout: fixtureResolver
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
    mcpServers: ["context7", "tavily", "gitnexus"],
    setupPipeline: "gstack",
    optionalSkills: [],
    applyRules: false,
    resolveGstackCheckout: fixtureResolver
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
    mcpServers: ["context7", "tavily", "gitnexus"],
    setupPipeline: "gstack",
    optionalSkills: [],
    applyRules: false,
    resolveGstackCheckout: fixtureResolver
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
  console.log = originalLog;
  process.env.PATH = originalPath;
  await fs.rm(gstackProvisionTarget, { recursive: true, force: true });
}

}

test("gstack provision checks", async () => {
  // protects=provisioning, settings reconciliation, audit, doctor, permissions, and secret handling; fails_when=provisioning loses user state or persists secrets; no_claim=live upstream availability.
  await runGstackProvisionChecks();
});
