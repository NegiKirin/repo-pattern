import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareGstackRuntime, validateGstackRuntime, runRuntimeCommand, runtimeEnvironment, GSTACK_RUNTIME_TIMEOUTS } from "../lib/gstack-runtime.mjs";
import { installGstackRuntimeFixture } from "./fixtures.mjs";

export async function runGstackRuntimeChecks() {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-runtime-check-"));
  try {
    assert.equal(GSTACK_RUNTIME_TIMEOUTS.install, 600000);
    assert.equal(GSTACK_RUNTIME_TIMEOUTS.probe, 30000);
    assert(runtimeEnvironment(checkout).PLAYWRIGHT_BROWSERS_PATH.startsWith(checkout));
    // Value: protects=runtime root must be a directory; fails_when=regular file accepted; why_new=symlink guard did not cover non-directory paths; seam=none
    await fs.writeFile(path.join(checkout, ".repo-pattern-runtime"), "not a directory");
    await assert.rejects(prepareGstackRuntime(checkout), /Invalid gstack runtime directory/);
    await fs.rm(path.join(checkout, ".repo-pattern-runtime"));
    await installGstackRuntimeFixture(checkout);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-runtime-outside-"));
    try {
      await fs.symlink(outside, path.join(checkout, ".repo-pattern-runtime"));
      let invoked = false;
      const unsafe = await validateGstackRuntime(checkout, { runCommand: async () => { invoked = true; } });
      assert.equal(unsafe.runtimeValid, false);
      assert.equal(invoked, false);
      await assert.rejects(prepareGstackRuntime(checkout), /Invalid gstack runtime directory/);
      assert.deepEqual(await fs.readdir(outside), []);
      await fs.rm(path.join(checkout, ".repo-pattern-runtime"));
    } finally { await fs.rm(outside, { recursive: true, force: true }); }
    const calls = [];
    const execute = async (command, args, options) => {
      calls.push({ command, args, options });
      return runRuntimeCommand(command, args, options);
    };
    let result = await prepareGstackRuntime(checkout, { browserSkipped: true, runCommand: execute });
    assert.equal(result.runtimeValid, true);
    assert.equal(result.browserStatus, "skipped");
    assert.deepEqual(calls.find(({ options }) => options.stage === "dependency install").args, ["install", "--network-concurrency", "1"]);
    assert(!calls.some(({ options }) => options.stage.startsWith("Chromium")));
    assert(calls.every(({ options }) => Number.isFinite(options.timeout)));
    // Value: protects=successful prepare removes populated Bun cache; fails_when=cache contents remain; why_new=prior runtime test checked directories but not cache cleanup; seam=none
    const cacheDirectory = path.join(checkout, ".repo-pattern-runtime", "bun-cache");
    await fs.mkdir(cacheDirectory, { recursive: true });
    await fs.writeFile(path.join(cacheDirectory, "stale-cache"), "cache");
    await prepareGstackRuntime(checkout, { browserSkipped: true });
    await assert.rejects(fs.access(cacheDirectory), { code: "ENOENT" });
    // Value: protects=prepare rejects failed post-build readiness without deleting cache; fails_when=invalid dependencies pass or cache is lost; why_new=validator failure was checked independently of prepare rejection; seam=none
    await fs.mkdir(cacheDirectory);
    await fs.writeFile(path.join(cacheDirectory, "retained-on-failure"), "cache");
    await assert.rejects(prepareGstackRuntime(checkout, { browserSkipped: true, runCommand: async (_command, _args, options) => {
      if (options.stage === "dependency install") return "";
      if (options.stage === "runtime build") return "";
      if (options.stage === "dependencies") throw new Error("readiness failure");
      return "";
    } }), /readiness failure/);
    assert.equal(await fs.readFile(path.join(cacheDirectory, "retained-on-failure"), "utf8"), "cache");
    result = await prepareGstackRuntime(checkout, { browserSkipped: false });
    assert.equal(result.browserStatus, "ready");
    assert.deepEqual(await fs.readdir(path.join(checkout, ".repo-pattern-runtime", "tmp")), []);
    // Value: protects=browser probe rejects unexpected page content and cleans temp files; fails_when=content guard or finally cleanup removed; why_new=fixture currently only returns expected text; seam=none
    const browserFixture = path.join(checkout, "node_modules", "playwright", "index.mjs");
    await fs.writeFile(browserFixture, "export const chromium={launch:async()=>({newPage:async()=>({goto:async()=>{},textContent:async()=> 'unexpected'}),close:async()=>{}})}");
    let probeError;
    result = await validateGstackRuntime(checkout, { runCommand: async (command, args, options) => {
      try {
        return await runRuntimeCommand(command, args, options);
      } catch (error) {
        if (options.stage === "Chromium launch") probeError = error;
        throw error;
      }
    } });
    assert.match(probeError.gstackOutput, /local HTML probe failed/);
    assert.equal(result.browserStatus, "failed");
    assert.match(result.runtimeChecks.find(({ stage }) => stage === "Chromium launch").error, /failed \(exit 1\)/);
    assert.deepEqual(await fs.readdir(path.join(checkout, ".repo-pattern-runtime", "tmp")), []);
    await fs.writeFile(browserFixture, "export const chromium={launch:async()=>({newPage:async()=>({goto:async()=>{},textContent:async()=> 'repo-pattern-ready'}),close:async()=>{}})}");
    await fs.chmod(path.join(checkout, "design", "dist", "design"), 0o644);
    result = await validateGstackRuntime(checkout, { browserSkipped: true });
    assert.equal(result.runtimeValid, false);
    assert.match(result.runtimeChecks.find(({ stage }) => stage === "design/dist/design").error, /Non-executable/);
    await fs.chmod(path.join(checkout, "design", "dist", "design"), 0o755);
    // Value: protects=runtime validation never follows binary symlinks; fails_when=symlink target executes as a binary; why_new=existing binary checks cover missing and non-executable files only; seam=none
    const outsideBinary = path.join(checkout, "outside-binary");
    const marker = path.join(checkout, "outside-binary-ran");
    await fs.writeFile(outsideBinary, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
    await fs.rm(path.join(checkout, "browse", "dist", "browse"));
    await fs.symlink(outsideBinary, path.join(checkout, "browse", "dist", "browse"));
    result = await validateGstackRuntime(checkout, { browserSkipped: true });
    assert.match(result.runtimeChecks[0].error, /Invalid runtime/);
    await assert.rejects(fs.lstat(marker), { code: "ENOENT" });
    await fs.rm(path.join(checkout, "browse", "dist", "browse"));
    result = await validateGstackRuntime(checkout);
    assert.equal(result.browserStatus, "missing");
    assert.match(result.runtimeChecks[0].error, /Missing runtime/);
    await fs.writeFile(path.join(checkout, "browse", "dist", "browse"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await fs.rm(outsideBinary);
    result = await validateGstackRuntime(checkout);
    assert.equal(result.runtimeValid, true);
    assert.equal(result.browserStatus, "ready");
    for (const stage of ["dependency install", "runtime build", "Chromium install"]) {
      await assert.rejects(prepareGstackRuntime(checkout, { runCommand: async (_command, _args, options) => {
        if (options.stage === stage) throw new Error(`injected ${stage}`);
      } }), new RegExp(stage));
    }
    await prepareGstackRuntime(checkout, { browserSkipped: true });
    result = await validateGstackRuntime(checkout, { runCommand: async (_command, _args, options) => {
      if (options.stage === "dependencies") throw new Error("dependency broken");
    } });
    assert.equal(result.runtimeValid, false);
    result = await validateGstackRuntime(checkout, { runCommand: async (_command, _args, options) => {
      if (options.stage === "Chromium launch") throw new Error("Chromium broken");
    } });
    assert.equal(result.browserStatus, "failed");
    assert.deepEqual(await fs.readdir(path.join(checkout, ".repo-pattern-runtime", "tmp")), []);
    await assert.rejects(runRuntimeCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: checkout, timeout: 20, stage: "deadline probe" }), /timed out after 20ms/);
    await assert.rejects(runRuntimeCommand(process.execPath, ["-e", "process.exit(2)"], { cwd: checkout, timeout: 1000, stage: "exit probe" }), /exit 2/);
    await assert.rejects(runRuntimeCommand("repo-pattern-missing-command", [], { cwd: checkout, timeout: 1000 }), /ENOENT/);
    // Value: protects=command output stays bounded on success and failure; fails_when=prefix retained or tail lost; why_new=exit checks did not inspect captured output; seam=none
    const boundedOutput = "discarded-prefix" + "x".repeat(5000) + "retained-tail";
    assert.equal(await runRuntimeCommand(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(boundedOutput)})`], { cwd: checkout, timeout: 5000 }), boundedOutput.slice(-4000));
    await assert.rejects(runRuntimeCommand(process.execPath, ["-e", `process.stderr.write(${JSON.stringify(boundedOutput)}); process.exitCode = 2;`], { cwd: checkout, timeout: 5000 }), (error) => {
      assert.equal(error.gstackOutput, boundedOutput.slice(-4000));
      assert.doesNotMatch(error.message, /discarded-prefix|retained-tail/);
      return true;
    });
    // Value: protects=missing-library failures give administrator remediation; fails_when=guidance omitted or OS installation claimed; why_new=generic exit checks omit prerequisite diagnostics; seam=none
    await assert.rejects(runRuntimeCommand(process.execPath, ["-e", "process.stderr.write('Host system is missing dependencies'); process.exitCode = 1;"], { cwd: checkout, timeout: 5000, stage: "Chromium launch" }), (error) => {
      assert.match(error.message, /Missing Linux system libraries/);
      assert.match(error.message, /ask your administrator/);
      assert.match(error.message, /no OS packages were installed/);
      assert.equal(error.gstackStage, "Chromium launch");
      return true;
    });
    if (process.platform === "linux") {
      const pidFile = path.join(checkout, "descendant.pid");
      const script = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', ${JSON.stringify("require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)")}, process.argv[1]], { stdio: 'ignore' }); child.unref(); const wait = () => require('node:fs').existsSync(process.argv[1]) ? process.exit(0) : setTimeout(wait, 10); wait();`;
      let pid;
      try {
        assert.equal(await runRuntimeCommand(process.execPath, ["-e", script, pidFile], { cwd: checkout, timeout: 5000, stage: "descendant cleanup probe" }), "");
        pid = Number(await fs.readFile(pidFile, "utf8"));
        assert(Number.isInteger(pid) && pid > 0);
        const deadline = Date.now() + 1000;
        let stopped = false;
        do {
          const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8").catch((error) => {
            if (error.code === "ENOENT" || error.code === "ESRCH") return "";
            throw error;
          });
          stopped = !stat || stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ");
          if (!stopped) await new Promise((resolve) => setTimeout(resolve, 10));
        } while (!stopped && Date.now() < deadline);
        assert(stopped, "successful probe must terminate its background descendant");
        // Value: protects=timed-out probes terminate background descendants; fails_when=timeout kills only the parent; why_new=existing descendant check covers successful parent exit only; seam=none
        await fs.rm(pidFile);
        await assert.rejects(runRuntimeCommand(process.execPath, ["-e", script.replace("process.exit(0)", "setInterval(() => {}, 1000)"), pidFile], { cwd: checkout, timeout: 1000, stage: "descendant timeout probe" }), /timed out/);
        pid = Number(await fs.readFile(pidFile, "utf8"));
        const timeoutDeadline = Date.now() + 1000;
        stopped = false;
        do {
          const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8").catch((error) => {
            if (error.code === "ENOENT" || error.code === "ESRCH") return "";
            throw error;
          });
          stopped = !stat || stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ");
          if (!stopped) await new Promise((resolve) => setTimeout(resolve, 10));
        } while (!stopped && Date.now() < timeoutDeadline);
        assert(stopped, "timed-out probe must terminate its background descendant");
      } finally {
        pid ??= Number(await fs.readFile(pidFile, "utf8").catch((error) => {
          if (error.code === "ENOENT" || error.code === "ESRCH") return "";
          throw error;
        }));
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
        }
      }
    }
  } finally { await fs.rm(checkout, { recursive: true, force: true }); }
}

if (process.argv[1] === new URL(import.meta.url).pathname) await runGstackRuntimeChecks();
