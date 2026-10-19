import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { GSTACK_REVIEW_SIDECARS, resolveGstackCheckout, setupGstack, validateProjectGstack } from "../lib/gstack.mjs";
import { installGstackSafetyFixture, commitGstackFixture } from "./fixtures.mjs";

const root = await fs.mkdtemp(path.resolve(".gstack-lifecycle-test-"));
const upstream = path.join(root, "upstream");
const target = path.join(root, "project's checkout");
const home = path.join(root, "home");
const tools = path.join(root, "tools");
const checkout = path.join(target, ".claude/skills/gstack");
const manifestFile = path.join(target, ".repo-pattern/gstack/documents.json");
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: upstream, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};
try {
  await fs.mkdir(upstream);
  await fs.mkdir(home);
  await fs.mkdir(tools);
  await fs.mkdir(target);
  await fs.writeFile(path.join(upstream, "setup"), "#!/bin/sh\n", { mode: 0o755 });
  await installGstackSafetyFixture(upstream);
  await fs.mkdir(path.join(upstream, "design-html/sections"), { recursive: true });
  await fs.writeFile(path.join(upstream, "SKILL.md"), "Read `design-html/SKILL.md`.\n");
  await fs.writeFile(path.join(upstream, "design-html/SKILL.md"), "Read [guide](sections/guide.md#run).\n```bash\nbun run $HOME/.claude/skills/gstack/bin/gstack-design-detect.ts\n```\n");
  await fs.writeFile(path.join(upstream, "design-html/sections/guide.md"), "State: $HOME/.gstack\n");
  await fs.writeFile(path.join(upstream, "bin/gstack-design-detect.ts"), "// detector fixture\n");
  await fs.writeFile(path.join(upstream, ".gitignore"), "node_modules/\n.repo-pattern-runtime/\n*/dist/\nbun.lock\n");
  for (const sidecar of GSTACK_REVIEW_SIDECARS) {
    await fs.mkdir(path.dirname(path.join(upstream, sidecar)), { recursive: true });
    await fs.writeFile(path.join(upstream, sidecar), `Fixture ${sidecar}`);
  }
  git("init", "-q");
  commitGstackFixture(upstream);
  const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  // Redirect only the upstream clone; every other Git operation uses the real executable.
  await fs.writeFile(path.join(tools, "git"), `#!/usr/bin/env node\nimport {spawnSync} from 'node:child_process';const args=process.argv.slice(2).map(a=>a==='https://github.com/garrytan/gstack.git'?process.env.FIXTURE_UPSTREAM:a);const r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});process.exit(r.status??1);\n`, { mode: 0o755 });
  const env = { ...process.env, HOME: home, PATH: `${tools}${path.delimiter}${process.env.PATH}`, FIXTURE_UPSTREAM: upstream, GSTACK_SKIP_PLAYWRIGHT: "1", REPO_PATTERN_DEBUG_GSTACK: "1" };
  const cli = (...args) => spawnSync(process.execPath, [path.resolve("scripts/repo-pattern.mjs"), ...args, "--target", target], { env, encoding: "utf8", timeout: 120000 });
  const setup = cli("setup", "--setup-pipeline", "gstack", "--mcp", "context7", "--yes");
  assert.equal(setup.status, 0, setup.stdout + setup.stderr);
  assert.deepEqual(await fs.readdir(home), []);
  const manifest = await fs.readFile(manifestFile, "utf8");
  const managed = JSON.parse(manifest);
  assert(managed.files.some(({ path: file }) => file === "design-html/sections/guide.md"));
  const skillFile = path.join(checkout, "design-html/SKILL.md");
  const skill = await fs.readFile(skillFile, "utf8");
  const wrapperFile = path.join(target, ".claude/skills/design-html/SKILL.md");
  const wrapper = await fs.readFile(wrapperFile, "utf8");
  for (const content of [skill, wrapper]) {
    const command = content.match(/^bun run (.+)$/m)?.[1];
    assert(command);
    const execution = spawnSync("bash", ["-c", `printf '%s' ${command}`], { encoding: "utf8" });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(execution.stdout, `${checkout}/bin/gstack-design-detect.ts`);
    assert(!content.includes("$HOME/.claude/skills/gstack"));
    assert(!/\/\.gstack-[^/]+\/checkout\//.test(content));
  }
  await fs.access(path.join(checkout, "bin/gstack-design-detect.ts"));
  const doctor = cli("doctor");
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.equal(await fs.readFile(manifestFile, "utf8"), manifest);
  assert.equal(await fs.readFile(skillFile, "utf8"), skill);
  const repeat = cli("setup", "--setup-pipeline", "gstack", "--mcp", "context7", "--yes");
  assert.equal(repeat.status, 0, repeat.stdout + repeat.stderr);
  assert.equal(await fs.readFile(manifestFile, "utf8"), manifest);
  assert.equal(await fs.readFile(skillFile, "utf8"), skill);
  assert.equal(await fs.readFile(manifestFile, "utf8"), manifest);
  assert.equal(await fs.readFile(skillFile, "utf8"), skill);
  const dry = cli("setup", "--setup-pipeline", "gstack", "--mcp", "context7", "--yes", "--dry-run");
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.equal(await fs.readFile(manifestFile, "utf8"), manifest);
  await fs.writeFile(path.join(checkout, "user-added.md"), "Keep me across upgrade.\n");
  await fs.appendFile(path.join(upstream, "design-html/SKILL.md"), "New upstream instruction.\n");
  await fs.appendFile(path.join(upstream, "design-html/sections/guide.md"), "New guide instruction.\n");
  await fs.appendFile(path.join(upstream, "review/checklist.md"), "New upstream review instruction.\n");
  await fs.mkdir(path.join(upstream, "review/new"), { recursive: true });
  await fs.writeFile(path.join(upstream, "review/new/upstream.md"), "New upstream linked document.\n");
  await fs.appendFile(path.join(upstream, "review/checklist.md"), "See [new document](new/upstream.md).\n");
  commitGstackFixture(upstream);
  const blockedUpgrade = cli("upgrade-gstack");
  assert.notEqual(blockedUpgrade.status, 0, blockedUpgrade.stdout + blockedUpgrade.stderr);
  assert.match(blockedUpgrade.stdout + blockedUpgrade.stderr, /gstack safety skill ownership conflict/);
  assert.equal(await fs.readFile(path.join(checkout, "user-added.md"), "utf8"), "Keep me across upgrade.\n");
  await fs.rm(path.join(checkout, "user-added.md"));
  const upgrade = cli("upgrade-gstack");
  assert.equal(upgrade.status, 0, upgrade.stdout + upgrade.stderr);
  const upgraded = await fs.readFile(skillFile, "utf8");
  const upgradedGuide = await fs.readFile(path.join(checkout, "design-html/sections/guide.md"), "utf8");
  const upgradedReview = await fs.readFile(path.join(checkout, "review/checklist.md"), "utf8");
  assert.match(upgraded, /New upstream instruction/);
  assert.match(upgradedGuide, /New guide instruction/);
  assert.match(upgradedReview, /New upstream review instruction/);
  assert.match(await fs.readFile(path.join(checkout, "review/new/upstream.md"), "utf8"), /New upstream linked document/);
  assert.equal((await fs.readFile(wrapperFile, "utf8")).match(/^bun run (.+)$/m)?.[1], upgraded.match(/^bun run (.+)$/m)?.[1]);
  const committedManifest = await fs.readFile(manifestFile, "utf8");
  const supporting = path.join(checkout, "design-html/sections/guide.md");
  const supportingBytes = await fs.readFile(supporting);
  for (const mutation of ["edit", "delete", "symlink"]) {
    if (mutation === "edit") await fs.appendFile(supporting, "$HOME/.gstack user change\n");
    else {
      await fs.rm(supporting);
      if (mutation === "symlink") await fs.symlink(path.join(upstream, "design-html/sections/guide.md"), supporting);
    }
    await assert.rejects(() => resolveGstackCheckout({ target, prepare: async () => {}, silent: true }), /design-html\/sections\/guide.md/);
    const result = await setupGstack({ target, silent: true });
    assert.equal(result.status, "failed");
    assert.match(result.error, /design-html\/sections\/guide.md/);
    const validation = await validateProjectGstack(target);
    assert.equal(validation.documentsValid, false);
    assert.match(validation.documentErrors.join("\n"), /guide.md/);
    const badDoctor = cli("doctor");
    assert.notEqual(badDoctor.status, 0);
    assert.match(badDoctor.stdout + badDoctor.stderr, /guide.md/);
    assert.equal(await fs.readFile(manifestFile, "utf8"), committedManifest);
    if (mutation === "edit") assert.match(await fs.readFile(supporting, "utf8"), /user change/);
    if (mutation === "symlink") assert((await fs.lstat(supporting)).isSymbolicLink());
    await fs.rm(supporting, { force: true });
    await fs.writeFile(supporting, supportingBytes);
  }
  // Failure after rewrite and checkout swap must restore checkout, wrappers, and manifest.
  const settings = path.join(target, ".claude/settings.json");
  const settingsBytes = await fs.readFile(settings);
  await fs.writeFile(settings, "invalid JSON");
  const failed = await setupGstack({ target, silent: true });
  assert.equal(failed.status, "failed");
  assert.equal(await fs.readFile(settings, "utf8"), "invalid JSON");
  assert.equal(await fs.readFile(skillFile, "utf8"), upgraded);
  assert.equal(await fs.readFile(manifestFile, "utf8"), committedManifest);
  await fs.writeFile(settings, settingsBytes);
  const originalSkip = process.env.GSTACK_SKIP_PLAYWRIGHT;
  process.env.GSTACK_SKIP_PLAYWRIGHT = "1";
  try {
    const originalWrite = fs.writeFile;
    let persistenceFailed = false;
    fs.writeFile = async (file, ...args) => {
      if (file === manifestFile && !persistenceFailed) {
        persistenceFailed = true;
        throw Object.assign(new Error("Injected manifest persistence failure"), { code: "EIO" });
      }
      return originalWrite(file, ...args);
    };
    try {
      const failedPersistence = await setupGstack({ target, silent: true });
      assert.equal(persistenceFailed, true);
      assert.equal(failedPersistence.status, "failed");
      assert.equal(await fs.readFile(manifestFile, "utf8"), committedManifest);
      assert.equal(await fs.readFile(skillFile, "utf8"), upgraded);
      assert.equal(await fs.readFile(settings, "utf8"), settingsBytes.toString());
    } finally {
      fs.writeFile = originalWrite;
    }
    let reachedCommit = false;
    const failedCommit = await setupGstack({ target, silent: true, resolveCheckout: async (options) => {
      const lease = await resolveGstackCheckout(options);
      return { ...lease, commit: async () => { reachedCommit = true; throw new Error("Injected commit failure"); } };
    } });
    assert.equal(reachedCommit, true);
    assert.equal(failedCommit.status, "failed");
    assert.equal(await fs.readFile(skillFile, "utf8"), upgraded);
    assert.equal(await fs.readFile(manifestFile, "utf8"), committedManifest);
    assert.equal(await fs.readFile(settings, "utf8"), settingsBytes.toString());
    const fresh = path.join(root, "failed-fresh");
    await fs.mkdir(path.join(fresh, ".claude"), { recursive: true });
    await fs.writeFile(path.join(fresh, ".claude/settings.json"), "invalid JSON");
    const freshFailure = await setupGstack({ target: fresh, silent: true, resolveCheckout: (options) => resolveGstackCheckout({ ...options, globalCheckout: path.join(root, "absent"), clone: (destination) => fs.cp(upstream, destination, { recursive: true }) }) });
    assert.equal(freshFailure.status, "failed");
    await assert.rejects(fs.access(path.join(fresh, ".claude/skills/gstack")), { code: "ENOENT" });
    await assert.rejects(fs.access(path.join(fresh, ".repo-pattern/gstack/documents.json")), { code: "ENOENT" });
    await assert.rejects(fs.access(path.join(fresh, ".repo-pattern/gstack/state.json")), { code: "ENOENT" });
  } finally {
    if (originalSkip === undefined) delete process.env.GSTACK_SKIP_PLAYWRIGHT;
    else process.env.GSTACK_SKIP_PLAYWRIGHT = originalSkip;
  }
  console.log("gstack document lifecycle and CLI checks passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
