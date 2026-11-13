import { spawn } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

// Downloads/builds get ten minutes; read-only probes get thirty seconds.
export const GSTACK_RUNTIME_TIMEOUTS = Object.freeze({ install: 600000, build: 600000, browser: 600000, probe: 30000 });
const BINARIES = [["browse/dist/browse", ["--help"]], ["browse/dist/find-browse", ["--help"]], ["design/dist/design", []], ["make-pdf/dist/pdf", ["version"]]];

export function runtimeEnvironment(checkout, environment = process.env) {
  return { ...environment, BUN_INSTALL: path.join(checkout, ".repo-pattern-runtime", "bun"), GSTACK_ROOT: checkout, GSTACK_HOME: path.join(checkout, ".repo-pattern-runtime", "state"), PLAYWRIGHT_BROWSERS_PATH: path.join(checkout, ".repo-pattern-runtime", "chromium"), BUN_INSTALL_CACHE_DIR: path.join(checkout, ".repo-pattern-runtime", "bun-cache"), TMPDIR: path.join(checkout, ".repo-pattern-runtime", "tmp"), GSTACK_SETUP_RUNNING: "1", GSTACK_SETUP_SKIP_CSO_BUILD: "1" };
}

export async function runRuntimeCommand(command, args, { cwd, env, timeout = GSTACK_RUNTIME_TIMEOUTS.probe, stage = "probe" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let expired = false;
    const terminate = () => {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch (error) { if (error.code !== "ESRCH") reject(error); }
    };
    const timer = setTimeout(() => { expired = true; terminate(); }, timeout);
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-4000); });
    child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-4000); });
    child.once("error", (error) => { clearTimeout(timer); reject(new Error(`gstack ${stage} failed: ${error.code || "spawn error"}`, { cause: error })); });
    child.once("close", (code) => {
      clearTimeout(timer);
      // A probe must not leave its daemon/browser descendants alive.
      terminate();
      if (expired || code !== 0) {
        const error = new Error(`gstack ${stage} ${expired ? `timed out after ${timeout}ms` : `failed (exit ${code})`}. Rerun repo-pattern setup to repair.${/shared libraries|Host system is missing|lib.*\.so/.test(output) ? " Missing Linux system libraries: ask your administrator to install Playwright Chromium prerequisites; no OS packages were installed." : ""}`);
        error.gstackOutput = output;
        error.gstackStage = stage;
        reject(error);
      } else resolve(output);
    });
  });
}

async function runtimeDirectories(checkout, create = true) {
  for (const directory of ["", "state", "tmp", "chromium", "bun", "bun-cache"]) {
    const destination = path.join(checkout, ".repo-pattern-runtime", directory);
    try {
      const stat = await fs.lstat(destination);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid gstack runtime directory; preserve local files and rerun setup.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (create) await fs.mkdir(destination, { recursive: true });
    }
  }
}

async function browserProbe(checkout, runCommand, env) {
  const probe = await fs.mkdtemp(path.join(env.TMPDIR, "probe-"));
  try {
    const html = path.join(probe, "index.html");
    await fs.writeFile(html, "<!doctype html><title>repo-pattern probe</title><p>repo-pattern-ready</p>");
    const source = `import { chromium } from ${JSON.stringify(path.join(checkout, "node_modules", "playwright", "index.mjs"))}; import { pathToFileURL } from 'node:url'; let browser; try { browser = await chromium.launch({headless:true,timeout:15000}); const page = await browser.newPage(); await page.goto(pathToFileURL(${JSON.stringify(html)}).href,{timeout:10000}); if(await page.textContent('p') !== 'repo-pattern-ready') throw new Error('local HTML probe failed'); } finally { if(browser) await browser.close(); }`;
    await runCommand("bun", ["--eval", source], { cwd: checkout, env, timeout: GSTACK_RUNTIME_TIMEOUTS.probe, stage: "Chromium launch" });
  } finally { await fs.rm(probe, { recursive: true, force: true }); }
}

export async function validateGstackRuntime(checkout, { browserSkipped = false, runCommand = runRuntimeCommand } = {}) {
  const checks = [];
  try { await runtimeDirectories(checkout, false); }
  catch (error) { return { runtimeValid: false, browserStatus: "failed", runtimeChecks: [{ stage: "runtime directories", ok: false, error: error.message }] }; }
  const env = runtimeEnvironment(checkout);
  const check = async (stage, operation) => {
    try { await operation(); checks.push({ stage, ok: true }); }
    catch (error) { checks.push({ stage, ok: false, error: error.message }); }
  };
  for (const [relative, args] of BINARIES) await check(relative, async () => {
    const file = path.join(checkout, relative);
    const stat = await fs.lstat(file).catch(() => { throw new Error(`Missing runtime: ${relative}. Rerun repo-pattern setup.`); });
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid runtime: ${relative}`);
    await fs.access(file, constants.X_OK).catch(() => { throw new Error(`Non-executable runtime: ${relative}. Rerun repo-pattern setup.`); });
    await runCommand(file, args, { cwd: checkout, env, timeout: GSTACK_RUNTIME_TIMEOUTS.probe, stage: `${relative} execution` });
  });
  await check("dependencies", async () => {
    await runCommand("bun", ["--eval", "import {chromium} from 'playwright'; if(!chromium) throw new Error('invalid playwright');"], { cwd: checkout, env, timeout: GSTACK_RUNTIME_TIMEOUTS.probe, stage: "dependencies" });
  });
  let browserStatus = browserSkipped ? "skipped" : "missing";
  if (!browserSkipped && checks.every(({ ok }) => ok)) {
    await check("Chromium launch", async () => { await browserProbe(checkout, runCommand, env); });
    browserStatus = checks.at(-1).ok ? "ready" : "failed";
  }
  return { runtimeValid: checks.filter(({ stage }) => stage !== "Chromium launch").every(({ ok }) => ok), browserStatus, runtimeChecks: checks };
}

export async function prepareGstackRuntime(checkout, { browserSkipped = process.env.GSTACK_SKIP_PLAYWRIGHT === "1", runCommand = runRuntimeCommand } = {}) {
  await runtimeDirectories(checkout);
  const env = runtimeEnvironment(checkout);
  await runCommand("bun", ["install", "--network-concurrency", "1"], { cwd: checkout, env, timeout: GSTACK_RUNTIME_TIMEOUTS.install, stage: "dependency install" });
  await runCommand("bun", ["run", "build"], { cwd: checkout, env, timeout: GSTACK_RUNTIME_TIMEOUTS.build, stage: "runtime build" });
  if (!browserSkipped) await runCommand("bun", ["node_modules/playwright/cli.js", "install", "chromium"], { cwd: checkout, env, timeout: GSTACK_RUNTIME_TIMEOUTS.browser, stage: "Chromium install" });
  const readiness = await validateGstackRuntime(checkout, { browserSkipped, runCommand });
  if (!readiness.runtimeValid || !["ready", "skipped"].includes(readiness.browserStatus)) throw new Error(readiness.runtimeChecks.filter(({ ok }) => !ok).map(({ error }) => error).join("; "));
  await fs.rm(env.BUN_INSTALL_CACHE_DIR, { recursive: true, force: true });
  return { browserSkipped, ...readiness };
}
