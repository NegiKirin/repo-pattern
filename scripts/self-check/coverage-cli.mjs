import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const node = process.execPath;
const cliSource = path.join(repoRoot, "scripts", "check-diff-coverage.mjs");
const runnerSource = path.join(repoRoot, "scripts", "test-coverage.mjs");

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 20000 });
  if (result.error) throw result.error;
  return result;
}

function runGit(args, cwd) {
  const result = run("git", args, cwd);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

async function makeFixture(root, name) {
  const repo = path.join(root, name);
  const scripts = path.join(repo, "scripts");
  const lib = path.join(scripts, "lib");
  await fs.mkdir(lib, { recursive: true });
  await fs.copyFile(cliSource, path.join(scripts, "check-diff-coverage.mjs"));
  const fixture = path.join(lib, "fixture.mjs");
  await fs.writeFile(fixture, "export const answer = 42;\n");
  runGit(["init", "-q"], repo);
  runGit(["add", "scripts/lib/fixture.mjs", "scripts/check-diff-coverage.mjs"], repo);
  runGit(["-c", "user.name=Self Check", "-c", "user.email=self-check@example.invalid", "commit", "-qm", "baseline"], repo);
  await fs.writeFile(fixture, "export const answer = 43;\n");
  const untracked = path.join(lib, "new-fixture.mjs");
  await fs.writeFile(untracked, "export const newAnswer = 44;\n");
  const coverage = path.join(root, `${name}-coverage`);
  await fs.mkdir(coverage);
  const result = [fixture, untracked].map((file) => ({ url: `file://${file}`, functions: [{ ranges: [{ startOffset: 0, endOffset: 1000, count: 1 }] }] }));
  await fs.writeFile(path.join(coverage, "report.json"), JSON.stringify({ result }));
  return { repo, coverage, fixture, untracked };
}

export async function runCoverageCliChecks() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-coverage-cli-"));
  try {
    // Value: protects=coverage CLI includes modified and untracked production files; fails_when=untracked file omitted or valid fixture coverage rejected; why_new=prior check matched fixture path text without exercising Git discovery; seam=none
    const successFixture = await makeFixture(root, "success");
    const success = run(node, ["scripts/check-diff-coverage.mjs", "HEAD"], successFixture.repo, { ...process.env, NODE_V8_COVERAGE: successFixture.coverage });
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /scripts\/lib\/new-fixture\.mjs/);
    assert.match(success.stdout, /scripts\/lib\/fixture\.mjs/);

    // Value: protects=coverage CLI rejects changed production files with no report; fails_when=missing report succeeds; why_new=helper predicate did not exercise command failure; seam=none
    const missingFixture = await makeFixture(root, "missing");
    await fs.rm(path.join(missingFixture.coverage, "report.json"));
    const missing = run(node, ["scripts/check-diff-coverage.mjs", "HEAD"], missingFixture.repo, { ...process.env, NODE_V8_COVERAGE: missingFixture.coverage });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Missing V8 coverage report/);

    // Value: protects=coverage CLI exits nonzero below threshold; fails_when=uncovered fixture exits zero; why_new=prior assertion did not observe process status; seam=none
    const thresholdFixture = await makeFixture(root, "threshold");
    await fs.writeFile(path.join(thresholdFixture.coverage, "report.json"), JSON.stringify({ result: [thresholdFixture.fixture, thresholdFixture.untracked].map((file) => ({ url: `file://${file}`, functions: [{ ranges: [{ startOffset: 0, endOffset: 1, count: 0 }] }] })) }));
    const threshold = run(node, ["scripts/check-diff-coverage.mjs", "HEAD"], thresholdFixture.repo, { ...process.env, NODE_V8_COVERAGE: thresholdFixture.coverage });
    assert.equal(threshold.status, 1, threshold.stderr);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }

  const runnerRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-coverage-runner-"));
  try {
    await fs.mkdir(path.join(runnerRoot, "scripts"));
    await fs.copyFile(runnerSource, path.join(runnerRoot, "scripts", "test-coverage.mjs"));
    const events = path.join(runnerRoot, "events.jsonl");
    await fs.writeFile(path.join(runnerRoot, "scripts", "lane.mjs"), `import fs from 'node:fs/promises'; import path from 'node:path'; const event={lane:path.basename(process.argv[1]), coverage:process.env.NODE_V8_COVERAGE}; await fs.appendFile(process.env.RUNNER_EVENTS, JSON.stringify(event)+'\\n'); if(event.lane===process.env.RUNNER_FAIL_ON) process.exit(7);`);
    const laneNames = ["self-check.mjs", "check-ecc-coverage.mjs", "check-diff-coverage.mjs"];
    for (const name of laneNames) await fs.writeFile(path.join(runnerRoot, "scripts", name), "import './lane.mjs';\n");
    const runLanes = (failure) => run(node, ["scripts/test-coverage.mjs", "HEAD"], runnerRoot, { ...process.env, RUNNER_EVENTS: events, RUNNER_FAIL_ON: failure });
    const assertCleanup = async (eventFile, expectedLanes, status) => {
      assert.equal(status.status, expectedLanes.length === laneNames.length ? 0 : 1, status.stderr);
      const eventsRead = (await fs.readFile(eventFile, "utf8")).trim().split("\n").map(JSON.parse);
      assert.deepEqual(eventsRead.map(({ lane }) => lane), expectedLanes);
      for (const { coverage } of eventsRead) {
        assert(coverage);
        await assert.rejects(fs.access(coverage), { code: "ENOENT" });
      }
    };
    // Value: protects=runner executes lanes in order and removes generated coverage after success; fails_when=order wrong or directory remains; why_new=suite pass did not independently assert orchestration; seam=none
    const success = runLanes("");
    await assertCleanup(events, laneNames, success);
    await fs.writeFile(events, "");
    // Value: protects=runner stops on first failed lane and cleans coverage; fails_when=later lane runs or temp directory remains; why_new=no failure-path runner cleanup assertion existed; seam=none
    const failed = runLanes("check-ecc-coverage.mjs");
    await assertCleanup(events, laneNames.slice(0, 2), failed);
  } finally {
    await fs.rm(runnerRoot, { recursive: true, force: true });
  }
}
