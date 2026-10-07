import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { doctorProject } from "../lib/doctor.mjs";
import { provisionProject } from "../lib/provision.mjs";
import { gstackCheckoutPath, gstackStatePath, validateProjectGstack } from "../lib/gstack.mjs";

export async function runGstackDoctorChecks(target, sourceRoot) {
  await provisionProject({ sourceRoot, target, setupPipeline: "gstack", migrate: true, applyRules: false });
  const output = [];
  const previousLog = console.log;
  console.log = (...args) => output.push(args.join(" "));
  try {
    // Value: protects=doctor reports ready Chromium; fails_when=ready browser reported as skipped or failed; why_new=runtime checks do not verify public doctor output; seam=none
    await doctorProject(target, { verbose: true });
    assert.match(output.join("\n"), /gstack Chromium ready/);
    assert.doesNotMatch(output.join("\n"), /browser skipped/);
    const stateFile = path.join(gstackStatePath(target), "state.json");
    const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
    // Value: protects=doctor distinguishes persisted browser opt-out from readiness; fails_when=skipped browser fails doctor or claims ready; why_new=runtime opt-out assertions omit persisted doctor reporting; seam=none
    await fs.writeFile(stateFile, JSON.stringify({ ...state, browserSkipped: true }));
    output.length = 0;
    await doctorProject(target);
    assert.match(output.join("\n"), /browser skipped by persisted GSTACK_SKIP_PLAYWRIGHT=1/);
    assert.doesNotMatch(output.join("\n"), /gstack Chromium ready/);
    await fs.writeFile(stateFile, JSON.stringify({ ...state, browserSkipped: false }));
    const checkout = gstackCheckoutPath(target);
    const binary = path.join(checkout, "browse", "dist", "browse");
    const binaryContent = await fs.readFile(binary);
    // Value: protects=doctor rejects missing runtime with repair guidance; fails_when=missing binary passes doctor or loses diagnostic; why_new=validator checks omit public doctor rejection; seam=none
    await fs.rm(binary);
    output.length = 0;
    await assert.rejects(() => doctorProject(target), /Doctor failed/);
    assert.match(output.join("\n"), /Missing runtime: browse\/dist\/browse/);
    assert.match(output.join("\n"), /gstack Chromium missing; rerun repo-pattern setup to repair/);
    await fs.writeFile(binary, binaryContent, { mode: 0o755 });
    // Value: protects=doctor rejects failed Chromium without blaming executable runtimes; fails_when=browser failure passes doctor or reports missing browser; why_new=browser validator assertions omit public diagnostics; seam=none
    await fs.writeFile(path.join(checkout, "node_modules", "playwright", "index.mjs"), "export const chromium={launch:async()=>{throw new Error('fixture browser failure')}}");
    output.length = 0;
    await assert.rejects(() => doctorProject(target), /Doctor failed/);
    assert.match(output.join("\n"), /gstack Chromium failed; rerun repo-pattern setup to repair/);
    assert.match(output.join("\n"), /gstack Chromium launch:.*failed/);
    assert.equal((await validateProjectGstack(target)).runtimeValid, true);
  } finally {
    console.log = previousLog;
  }
}
