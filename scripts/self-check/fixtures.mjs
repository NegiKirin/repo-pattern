import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const gstackSafetyFixture = path.join(repoRoot, "self-check", "fixtures", "gstack-safety");

export async function installGstackSafetyFixture(checkout) {
  for (const entry of ["careful", "freeze", "guard", "bin/gstack-paths"]) {
    const source = path.join(gstackSafetyFixture, entry);
    const destination = path.join(checkout, entry);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, { recursive: true });
  }
  await fs.chmod(path.join(checkout, "bin", "gstack-paths"), 0o755);
  await installGstackRuntimeFixture(checkout);
}

export async function installGstackRuntimeFixture(checkout) {
  await fs.writeFile(path.join(checkout, "package.json"), JSON.stringify({ type: "module", scripts: { build: "bun fixture-build.mjs" } }));
  await fs.writeFile(path.join(checkout, "fixture-build.mjs"), `import fs from 'node:fs/promises'; import path from 'node:path'; for(const file of ['browse/dist/browse','browse/dist/find-browse','design/dist/design','make-pdf/dist/pdf']) { await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,'#!/bin/sh\\nexit 0\\n',{mode:0o755}); } await fs.mkdir('node_modules/playwright',{recursive:true}); await fs.writeFile('node_modules/playwright/package.json',JSON.stringify({type:'module',exports:'./index.mjs'})); await fs.writeFile('node_modules/playwright/index.mjs',"export const chromium={launch:async()=>({newPage:async()=>({goto:async()=>{},textContent:async()=> 'repo-pattern-ready'}),close:async()=>{}})}"); await fs.writeFile('node_modules/playwright/cli.js','');`);
}

export async function writeEccGitFixture(target, { origin = "https://github.com/affaan-m/ECC.git", withAgents = true } = {}) {
  const cache = path.join(target, ".repo-pattern", "cache", "ECC");
  await fs.mkdir(path.join(cache, "rules", "common"), { recursive: true });
  await fs.writeFile(path.join(cache, "rules", "common", "rule.md"), "new rule", "utf8");
  if (withAgents) {
    await fs.mkdir(path.join(cache, "agents"), { recursive: true });
    await fs.writeFile(path.join(cache, "agents", "new-agent.md"), "new", "utf8");
  }
  spawnSync("git", ["init"], { cwd: cache, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: cache, stdio: "ignore" });
  spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "fixture"], { cwd: cache, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", origin], { cwd: cache, stdio: "ignore" });
  return cache;
}
