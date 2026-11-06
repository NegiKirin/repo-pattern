import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setupGstack, validateProjectGstack, GSTACK_REVIEW_SIDECARS } from "../lib/gstack.mjs";
import { installGstackSafetyFixture, installGstackRenderedUpstreamSetupFixture, commitGstackFixture } from "./fixtures.mjs";

// Protects real upstream publication, not merely invoking setup before rewriting its output.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-upstream-local-"));
const target = path.join(root, "project");
const home = path.join(root, "home");
const checkout = path.join(target, ".claude/skills/gstack");
const originalEnvironment = { ...process.env };
try {
  await fs.mkdir(checkout, { recursive: true });
  const unrelatedSkill = path.join(target, ".claude/skills/user-skill");
  await fs.mkdir(unrelatedSkill);
  await fs.writeFile(path.join(unrelatedSkill, "SKILL.md"), "User-owned skill\n");
  await fs.mkdir(home);
  await fs.writeFile(path.join(home, "sentinel"), "preserve global home");
  await installGstackSafetyFixture(checkout);
  for (const sidecar of GSTACK_REVIEW_SIDECARS) {
    await fs.mkdir(path.dirname(path.join(checkout, sidecar)), { recursive: true });
    await fs.writeFile(path.join(checkout, sidecar), `Fixture ${sidecar}`);
  }
  await fs.mkdir(path.join(checkout, "autoplan/sections"), { recursive: true });
  await fs.writeFile(path.join(checkout, "SKILL.md"), "---\nname: gstack\n---\nLocal gstack\n");
  await fs.writeFile(path.join(checkout, "autoplan/SKILL.md"), "---\nname: autoplan\n---\nRead ~/.claude/skills/gstack/autoplan/sections/ceo-phase.md\n");
  await fs.writeFile(path.join(checkout, "autoplan/sections/ceo-phase.md"), "Canonical CEO phase\n");
  await fs.writeFile(path.join(checkout, ".gitignore"), "node_modules/\n.repo-pattern-runtime/\n*/dist/\nbun.lock\nsetup-call.json\n");
  await fs.writeFile(path.join(checkout, "setup"), `#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const source = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (!args.includes('--local')) process.exit(8);
const skills = path.join(process.cwd(), '.claude/skills');
await fs.writeFile(path.join(source, 'setup-call.json'), JSON.stringify({cwd:process.cwd(),args,home:process.env.HOME,state:process.env.GSTACK_HOME,render:process.env.GSTACK_USER_RENDER_DIR}));
const build = spawnSync('bun', ['run','build'], {cwd:source,stdio:'inherit'});
if (build.status !== 0) process.exit(build.status || 1);
for (const skill of ['autoplan','careful','freeze','guard']) {
  const destination = path.join(skills, skill);
  await fs.mkdir(destination, {recursive:true});
  const content = (await fs.readFile(path.join(source,skill,'SKILL.md'),'utf8')).replaceAll('~/.claude/skills/gstack',source);
  await fs.writeFile(path.join(destination,'SKILL.md'),content);
  if (skill === 'autoplan') await fs.symlink(path.join(source,skill,'sections'),path.join(destination,'sections'));
}
await fs.writeFile(path.join(skills,'autoplan','upstream-owned.txt'),'published by upstream');
if (process.env.FIXTURE_SETUP_FAIL === '1') process.exit(9);
`, { mode: 0o755 });
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: checkout }).status, 0);
  commitGstackFixture(checkout);
  process.env.HOME = home;
  process.env.GSTACK_SKIP_PLAYWRIGHT = "1";
  const previewTarget = path.join(root, "preview-project");
  const preview = await setupGstack({ target: previewTarget, dryRun: true, silent: true });
  assert.equal(preview.status, "dry-run", preview.error);
  assert.equal(await fs.access(previewTarget).then(() => true, () => false), false, "dry-run must not create the target or run upstream setup");
  const legacyTarget = path.join(root, "legacy-project");
  const legacyState = path.join(legacyTarget, ".repo-pattern/gstack");
  await fs.mkdir(legacyState, { recursive: true });
  const legacyBytes = JSON.stringify({ wrappers: [".claude/skills/autoplan"], assets: [], sidecars: [] });
  await fs.writeFile(path.join(legacyState, "state.json"), legacyBytes);
  for (const dryRun of [true, false]) {
    const rejected = await setupGstack({ target: legacyTarget, dryRun, silent: true });
    assert.equal(rejected.status, "failed", "unsupported legacy installation must not be migrated");
    assert.match(rejected.error, /unsupported|legacy/i);
    assert.equal(await fs.readFile(path.join(legacyState, "state.json"), "utf8"), legacyBytes);
    assert.equal(await fs.access(path.join(legacyTarget, ".claude")).then(() => true, () => false), false);
  }
  assert.equal((await validateProjectGstack(legacyTarget)).stateValid, false);
  const originalMkdtemp = fs.mkdtemp;
  const snapshotError = new Error("Injected snapshot creation failure");
  fs.mkdtemp = async (prefix, ...args) => {
    if (prefix === path.join(target, ".gstack-upstream-transaction-")) throw snapshotError;
    return originalMkdtemp(prefix, ...args);
  };
  try {
    const failedSnapshot = await setupGstack({ target, silent: true });
    assert.equal(failedSnapshot.status, "failed");
    assert.deepEqual(snapshotError.rollbackErrors, [], "original snapshot error must survive without secondary rollback errors");
    assert.deepEqual(failedSnapshot.rollbackErrors, [], "snapshot failure must not attempt rollback without a transaction");
    assert.equal(failedSnapshot.recoverySnapshot, undefined);
    assert.equal(await fs.readFile(path.join(unrelatedSkill, "SKILL.md"), "utf8"), "User-owned skill\n");
  } finally {
    fs.mkdtemp = originalMkdtemp;
  }
  const installed = await setupGstack({ target, silent: true });
  assert.equal(installed.status, "installed", installed.error);
  const callFile = path.join(checkout, "setup-call.json");
  assert.equal(await fs.access(callFile).then(() => true, () => false), true, "upstream ./setup --local must run");
  const call = JSON.parse(await fs.readFile(callFile, "utf8"));
  assert.equal(call.cwd, target, "installer must render against the stable project path");
  for (const flag of ["--local", "--no-team", "--no-harness-auto"]) assert(call.args.includes(flag), `installer must receive ${flag}`);
  assert.notEqual(call.home, home, "upstream HOME must be isolated");
  assert(call.home.startsWith(`${target}${path.sep}`));
  const skill = await fs.readFile(path.join(target, ".claude/skills/autoplan/SKILL.md"), "utf8");
  assert(skill.includes(path.join(checkout, "autoplan/sections/ceo-phase.md")), "upstream canonical section reference must survive");
  assert.equal(await fs.readFile(path.join(target, ".claude/skills/autoplan/upstream-owned.txt"), "utf8"), "published by upstream");
  assert.equal(await fs.realpath(path.join(target, ".claude/skills/autoplan/sections/ceo-phase.md")), path.join(checkout, "autoplan/sections/ceo-phase.md"));
  assert.deepEqual(await fs.readdir(home), ["sentinel"]);
  const validation = await validateProjectGstack(target);
  assert.equal(validation.wrappersValid, true, validation.documentErrors?.join("\n"));
  assert.equal(validation.documentsValid, true, validation.documentErrors?.join("\n"));
  const documentsFile = path.join(target, ".repo-pattern/gstack/documents.json");
  const documentsBytes = await fs.readFile(documentsFile);
  await fs.unlink(documentsFile);
  assert.equal((await validateProjectGstack(target)).documentsValid, false, "missing source integrity record must fail validation");
  assert.equal((await setupGstack({ target, silent: true })).status, "failed", "missing source integrity record must block replacement");
  await fs.writeFile(documentsFile, documentsBytes);
  const phaseFile = path.join(checkout, "autoplan/sections/ceo-phase.md");
  await fs.writeFile(phaseFile, "User-edited linked section\n");
  assert.equal((await validateProjectGstack(target)).documentsValid, false, "linked section edits must fail integrity validation");
  await fs.writeFile(phaseFile, "Canonical CEO phase\n");
  const before = await fs.readFile(path.join(target, ".repo-pattern/gstack/state.json"), "utf8");
  process.env.FIXTURE_SETUP_FAIL = "1";
  const failed = await setupGstack({ target, silent: true });
  assert.equal(failed.status, "failed", "upstream nonzero exit must fail setup");
  assert.equal(await fs.readFile(path.join(target, ".repo-pattern/gstack/state.json"), "utf8"), before);
  assert.equal(await fs.readFile(path.join(target, ".claude/skills/autoplan/SKILL.md"), "utf8"), skill);
  delete process.env.FIXTURE_SETUP_FAIL;
  const repeated = await setupGstack({ target, silent: true });
  assert.equal(repeated.status, "installed", repeated.error);
  await fs.writeFile(path.join(unrelatedSkill, "SKILL.md"), "User updated unrelated skill\n");
  assert.equal((await setupGstack({ target, silent: true })).status, "installed", "unrelated skills must not become managed publication");
  assert.equal(await fs.readFile(path.join(unrelatedSkill, "SKILL.md"), "utf8"), "User updated unrelated skill\n");
  const userFile = path.join(target, ".claude/skills/autoplan/user-notes.md");
  await fs.writeFile(userFile, "Preserve additional user files\n");
  const addedFileConflict = await setupGstack({ target, silent: true });
  assert.equal(addedFileConflict.status, "failed", "untracked publication files must block replacement");
  assert.equal(await fs.readFile(userFile, "utf8"), "Preserve additional user files\n");
  await fs.unlink(userFile);
  await fs.appendFile(path.join(target, ".claude/skills/autoplan/SKILL.md"), "User edit\n");
  const conflict = await setupGstack({ target, silent: true });
  assert.equal(conflict.status, "failed", "must preserve modified upstream publication");
  assert.match(await fs.readFile(path.join(target, ".claude/skills/autoplan/SKILL.md"), "utf8"), /User edit/);
  assert.deepEqual(await fs.readdir(home), ["sentinel"]);
  const renderedTarget = path.join(root, "rendered-project");
  const renderedCheckout = path.join(renderedTarget, ".claude/skills/gstack");
  await fs.mkdir(path.dirname(renderedCheckout), { recursive: true });
  await fs.cp(checkout, renderedCheckout, { recursive: true });
  await installGstackRenderedUpstreamSetupFixture(renderedCheckout);
  commitGstackFixture(renderedCheckout);
  const renderedInstall = await setupGstack({ target: renderedTarget, silent: true });
  assert.equal(renderedInstall.status, "installed", renderedInstall.error);
  const renderedSkill = path.join(renderedTarget, ".claude/skills/autoplan/SKILL.md");
  const actualRenderRoot = path.dirname(path.dirname(await fs.realpath(renderedSkill)));
  const renderedSettings = JSON.parse(await fs.readFile(path.join(renderedTarget, ".claude/settings.json"), "utf8"));
  assert.equal(renderedSettings.env.GSTACK_USER_RENDER_DIR, actualRenderRoot);
  assert(actualRenderRoot.startsWith(path.join(renderedTarget, ".repo-pattern-runtime")));
  assert((await fs.lstat(renderedSkill)).isSymbolicLink());
  assert.equal(await fs.readFile(renderedSkill, "utf8"), await fs.readFile(path.join(renderedCheckout, "autoplan/SKILL.md"), "utf8"));
  assert.equal((await validateProjectGstack(renderedTarget)).documentsValid, true);
  assert.equal((await setupGstack({ target: renderedTarget, silent: true })).status, "installed");
  console.log("gstack upstream local setup checks passed");
} finally {
  for (const key of Object.keys(process.env)) if (!Object.hasOwn(originalEnvironment, key)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
  await fs.rm(root, { recursive: true, force: true });
}
