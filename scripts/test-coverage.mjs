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
  const testArgs = ["--test", "--test-concurrency=1", process.env.RUNNER_TEST_PATH || "test/*/*.test.mjs"];
  await run(process.execPath, testArgs, { ...process.env, NODE_V8_COVERAGE: coverageDirectory });
  await run(process.execPath, ["scripts/check-coverage.mjs"], { ...process.env, NODE_V8_COVERAGE: coverageDirectory, RUNNER_LANE: "check-coverage.mjs" });
  await run(process.execPath, ["scripts/check-diff-coverage.mjs", process.argv[2] || "HEAD"], { ...process.env, NODE_V8_COVERAGE: coverageDirectory, RUNNER_LANE: "check-diff-coverage.mjs" });
} finally {
  await rm(coverageDirectory, { recursive: true, force: true });
}
