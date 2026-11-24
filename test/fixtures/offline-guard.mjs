import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { before, after } from "node:test";

const keys = ["HOME", "CLAUDE_CONFIG_DIR", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_ALLOW_PROTOCOL", "PATH"];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
let home;
before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-offline-home-"));
  const bin = path.join(home, "bin");
  await fs.mkdir(bin);
  const bun = path.join(bin, "bun");
  // ponytail: fixture build/install only; real upstream dependency installation belongs in an opt-in integration lane.
  await fs.writeFile(`${bun}.mjs`, `import fs from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") { console.log("1.4.3"); process.exit(0); }
let fixture = false;
try { fixture = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts?.build === "bun fixture-build.mjs" && fs.existsSync("fixture-build.mjs"); } catch {}
if (fixture && args[0] === "install") process.exit(0);
if (fixture && args[0] === "node_modules/playwright/cli.js" && args[1] === "install" && fs.readFileSync(args[0], "utf8") === "") process.exit(0);
if (fixture && args[0] === "--eval") {
  const result = spawnSync(${JSON.stringify(process.execPath)}, ["--input-type=module", "--eval", args[1]], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
if (fixture && ((args[0] === "run" && args[1] === "build") || args[0] === "fixture-build.mjs")) {
  const result = spawnSync(${JSON.stringify(process.execPath)}, ["fixture-build.mjs"], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
console.error("Offline fixture guard rejected Bun command:", args.join(" "));
process.exit(97);
`);
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  await fs.writeFile(bun, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(`${bun}.mjs`)} "$@"\n`, { mode: 0o755 });
  Object.assign(process.env, {
    HOME: home, CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
    GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1",
    GIT_ALLOW_PROTOCOL: "file", PATH: `${bin}${path.delimiter}${original.PATH || ""}`
  });
  assert.equal(spawnSync(bun, ["--version"], { encoding: "utf8" }).stdout.trim(), "1.4.3");
  assert.equal(spawnSync(bun, ["x", "playwright", "install"], { cwd: home }).status, 97);
  assert.notEqual(spawnSync("git", ["ls-remote", "https://example.invalid/fixture.git"], { cwd: home, stdio: "ignore" }).status, 0);
});
after(async () => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (home) await fs.rm(home, { recursive: true, force: true });
});
