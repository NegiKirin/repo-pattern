import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: environment });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)));
  });
}

const coverageDirectory = await mkdtemp(path.join(os.tmpdir(), "repo-pattern-v8-"));
try {
  await run(process.execPath, ["scripts/self-check.mjs"], { ...process.env, NODE_V8_COVERAGE: coverageDirectory });
  await run(process.execPath, ["scripts/check-ecc-coverage.mjs"], { ...process.env, NODE_V8_COVERAGE: coverageDirectory });
} finally {
  await rm(coverageDirectory, { recursive: true, force: true });
}
