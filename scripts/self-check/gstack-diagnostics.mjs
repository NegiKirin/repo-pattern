import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureBun, isValidGstackCheckout, resolveGstackCheckout, gstackCheckoutPath, setupGstack } from "../lib/gstack.mjs";

export async function runGstackDiagnosticChecks() {
  // Value: protects=Bun probe has a deadline and reports timeout failure; fails_when=timeout omitted or failure swallowed; why_new=version checks omit command deadline; seam=none
  assert.throws(() => ensureBun({ run: (_command, _args, options) => {
    assert.equal(options.timeout, 30000);
    throw Object.assign(new Error("probe timed out"), { code: "ETIMEDOUT" });
  } }), /Bun validation failed: probe timed out/);
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-diagnostics-"));
  const originalDebug = process.env.REPO_PATTERN_DEBUG_GSTACK;
  try {
    await fs.writeFile(path.join(target, "setup"), "#!/bin/sh\n", { mode: 0o755 });
    // Value: protects=checkout Git probes have deadlines and reject timeout; fails_when=deadline absent or timeout accepted; why_new=real Git checks do not simulate a hung probe; seam=none
    const gitProbes = [];
    assert.equal(await isValidGstackCheckout(target, { run: (_command, args, options) => {
      assert.equal(options.timeout, 30000);
      gitProbes.push(args.at(-1));
      return args.at(-1) === "--is-inside-work-tree" ? "true\n" : target;
    } }), true);
    assert.deepEqual(gitProbes, ["--is-inside-work-tree", "--show-toplevel"]);
    assert.equal(await isValidGstackCheckout(target, { run: () => { throw Object.assign(new Error("probe timed out"), { code: "ETIMEDOUT" }); } }), false);
    // Value: protects=Git status has a deadline and disables optional locks for setup and upgrade; fails_when=deadline or environment omitted or timeout swallowed; why_new=rev-parse probes do not exercise dirty-check command; seam=none
    const local = gstackCheckoutPath(target);
    await fs.mkdir(local, { recursive: true });
    await fs.writeFile(path.join(local, "setup"), "#!/bin/sh\n", { mode: 0o755 });
    const originalExec = childProcess.execFileSync;
    try {
      for (const upgrade of [false, true]) {
        let observed = false;
        childProcess.execFileSync = (command, args, options) => {
          assert.equal(command, "git");
          assert.deepEqual(args, ["status", "--porcelain", upgrade ? "--untracked-files=all" : "--untracked-files=no"]);
          assert.equal(options.timeout, 30000);
          assert.equal(options.env.GIT_OPTIONAL_LOCKS, "0");
          observed = true;
          throw Object.assign(new Error("status timed out"), { code: "ETIMEDOUT" });
        };
        syncBuiltinESMExports();
        await assert.rejects(resolveGstackCheckout({ target, upgrade, prepare: async () => {}, run: (_command, args) => args.at(-1) === "--is-inside-work-tree" ? "true" : local, silent: true }), /status timed out/);
        assert.equal(observed, true);
        assert.equal(await fs.readFile(path.join(local, "setup"), "utf8"), "#!/bin/sh\n");
      }
    } finally {
      childProcess.execFileSync = originalExec;
      syncBuiltinESMExports();
    }
    // Value: protects=default clone promotes valid checkout and cleans staging on failure; fails_when=clone bypasses command boundary or failed checkout promoted; why_new=upstream integration overrides clone callback; seam=none
    const bin = path.join(target, "fixture-bin");
    const events = path.join(target, "clone-events.json");
    await fs.mkdir(bin);
    const realGit = originalExec("which", ["git"], { encoding: "utf8" }).trim();
    await fs.writeFile(path.join(bin, "git"), `#!${process.execPath}\nconst fs=require('node:fs'); const cp=require('node:child_process'); const args=process.argv.slice(2); if(args[0]!=='clone') process.exit(91); fs.writeFileSync(process.env.CLONE_EVENTS,JSON.stringify(args)); if(process.env.CLONE_FAIL==='1') process.exit(7); const destination=args.at(-1); fs.writeFileSync(require('node:path').join(destination,'setup'),'#!/bin/sh\\n',{mode:0o755}); cp.execFileSync(${JSON.stringify(realGit)},['init','--quiet',destination]);`, { mode: 0o755 });
    const originalPath = process.env.PATH;
    const originalEvents = process.env.CLONE_EVENTS;
    const originalFailure = process.env.CLONE_FAIL;
    try {
      process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
      process.env.CLONE_EVENTS = events;
      for (const failure of [false, true]) {
        process.env.CLONE_FAIL = failure ? "1" : "0";
        const cloneTarget = path.join(target, failure ? "clone-failure" : "clone-success");
        await fs.mkdir(cloneTarget);
        const options = { target: cloneTarget, globalCheckout: path.join(target, "absent-global"), run: (command, args, settings) => originalExec(realGit, args, settings), silent: true };
        if (failure) await assert.rejects(resolveGstackCheckout(options), (error) => error.gstackCloneFailure === true && /exit 7/.test(error.message));
        else {
          const lease = await resolveGstackCheckout(options);
          assert.equal(lease.source, "clone");
          assert.equal(await isValidGstackCheckout(lease.checkout, { run: (_command, args, settings) => originalExec(realGit, args, settings) }), true);
          await lease.commit();
        }
        const args = JSON.parse(await fs.readFile(events, "utf8"));
        assert.deepEqual(args.slice(0, -1), ["clone", "--progress", "--single-branch", "--depth", "1", "https://github.com/garrytan/gstack.git"]);
        const entries = await fs.readdir(path.join(cloneTarget, ".claude", "skills"));
        assert.deepEqual(entries, failure ? [] : ["gstack"]);
      }
    } finally {
      process.env.PATH = originalPath;
      for (const [name, value] of [["CLONE_EVENTS", originalEvents], ["CLONE_FAIL", originalFailure]]) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    // Value: protects=setup diagnostics redact output unless debug explicitly enabled; fails_when=sentinel leaks or stage untrusted; why_new=clone check omits runtime diagnostics and debug; seam=none
    const diagnosticOutput = "synthetic-private-output" + "x".repeat(5000) + "diagnostic-tail";
    const failedSetup = (stage) => setupGstack({ target, silent: true, resolveCheckout: async () => {
      throw Object.assign(new Error("Missing Linux system libraries"), { gstackStage: stage, gstackOutput: diagnosticOutput });
    } });
    for (const debug of [undefined, "0", "true"]) {
      if (debug === undefined) delete process.env.REPO_PATTERN_DEBUG_GSTACK;
      else process.env.REPO_PATTERN_DEBUG_GSTACK = debug;
      const failed = await failedSetup("Chromium launch");
      assert.equal(failed.status, "failed");
      assert.match(failed.error, /Failed stage: Chromium launch/);
      assert.match(failed.error, /Ask your administrator/);
      assert.match(failed.error, /no OS packages were installed/);
      assert.doesNotMatch(failed.error, /synthetic-private-output|diagnostic-tail|Debug output/);
    }
    process.env.REPO_PATTERN_DEBUG_GSTACK = "1";
    const debug = await failedSetup("Chromium launch");
    assert.match(debug.error, /Debug output:/);
    assert.doesNotMatch(debug.error, /synthetic-private-output/);
    assert(debug.error.length <= 4000);
    delete process.env.REPO_PATTERN_DEBUG_GSTACK;
    assert.doesNotMatch((await failedSetup("untrusted-stage")).error, /untrusted-stage|Failed stage:/);
  } finally {
    if (originalDebug === undefined) delete process.env.REPO_PATTERN_DEBUG_GSTACK;
    else process.env.REPO_PATTERN_DEBUG_GSTACK = originalDebug;
    await fs.rm(target, { recursive: true, force: true });
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) await runGstackDiagnosticChecks();
