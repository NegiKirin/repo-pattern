import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import packageJson from "../../package.json" with { type: "json" };

const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const cliPath = path.join(repoRoot, "bin", "repo-pattern.mjs");
const evidenceRoot = path.join(repoRoot, "scripts", "phase-1-baseline");
const baselineTarget = (await readFile(path.join(evidenceRoot, "dry-run.target"), "utf8")).trim();

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: repoRoot });
}

function normalizeDryRun(output, target, sourceRoot) {
  const wrappedTarget = new RegExp([...target].map((character) => character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")).join("\\s*"), "g");
  return output.replace(wrappedTarget, baselineTarget).replaceAll(sourceRoot, "<repo-root>");
}

function baselineSourceRoot(output) {
  return output.match(/\[dry-run\] copy (.+?)\/\.claude\.example\//)?.[1];
}

async function baselineStreams(name) {
  return {
    stdout: await readFile(path.join(evidenceRoot, `${name}.stdout`)),
    stderr: await readFile(path.join(evidenceRoot, `${name}.stderr`))
  };
}

async function assertBaseline(name, args, expectedStatus) {
  const expected = await baselineStreams(name);
  const result = runCli(args);
  assert.equal(result.status, expectedStatus);
  assert.deepEqual(result.stdout, expected.stdout);
  assert.deepEqual(result.stderr, expected.stderr);
}

test("help output remains byte-identical to the Phase 0 baseline", async () => {
  // protects=help stdout/stderr bytes and exit status; fails_when=whitespace, ANSI, stream, or status changes; no_claim=platforms other than this Linux baseline.
  await assertBaseline("help", ["--help"], 0);
});

test("version output remains byte-identical to the Phase 0 baseline", async () => {
  // protects=version stdout/stderr bytes and exit status; fails_when=version output, stream, or status changes; no_claim=package metadata after source relocation.
  await assertBaseline("version", ["--version"], 0);
});

test("invalid command output is diagnostic-only", () => {
  // protects=invalid-command diagnostic stream and nonzero status; fails_when=unknown commands look successful or write usage to stdout; no_claim=all invalid argument combinations.
  const result = runCli(["not-a-command"]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout.length, 0);
  assert.match(result.stderr.toString(), /^Unknown command: not-a-command\n$/);
});

test("noninteractive dry-run output remains byte-identical to the Phase 0 baseline", async () => {
  // protects=none-pipeline dry-run stdout/stderr bytes and exit status; fails_when=preview ordering, paths, warnings, streams, or status changes; no_claim=interactive output or live upstream output.
  const target = await mkdtemp(path.join(os.tmpdir(), "repo-pattern-cli-dry-run-"));
  try {
    const expected = await baselineStreams("dry-run");
    const result = runCli(["setup", "--target", target, "--setup-pipeline", "none", "--yes", "--dry-run"]);
    assert.equal(result.status, 0);
    const baselineRoot = baselineSourceRoot(expected.stdout.toString());
    assert.ok(baselineRoot);
    assert.equal(normalizeDryRun(result.stdout.toString(), target, repoRoot), normalizeDryRun(expected.stdout.toString(), baselineTarget, baselineRoot));
    assert.deepEqual(result.stderr, expected.stderr);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("conflicting setup flags remain byte-identical to the Phase 1 baseline", async () => {
  // protects=force-and-migrate rejection bytes and exit status; fails_when=whitespace, ANSI, stream, or status changes; no_claim=provision transaction behavior.
  const result = runCli(["setup", "--force", "--migrate"]);
  assert.equal(result.status, Number((await readFile(path.join(evidenceRoot, "force-migrate.exit"), "utf8")).trim().replace("exit=", "")));
  assert.deepEqual(result.stdout, Buffer.alloc(0));
  assert.deepEqual(result.stderr, await readFile(path.join(evidenceRoot, "force-migrate.stderr")));
});

test("CLI option validation preserves errors and exit codes", () => {
  // protects=unknown arguments, missing values, and invalid setup selections; fails_when=parser accepts invalid input or changes its error stream/status; no_claim=provision behavior after validation.
  for (const [args, expected] of [
    [["doctor", "--bogus"], /Unknown argument: --bogus/],
    [["setup", "--target"], /Missing value for --target/],
    [["setup", "--with-skill", "nope"], /Unknown optional skill\(s\): nope/],
    [["setup", "--setup-pipeline", "nope", "--yes"], /Unknown setup pipeline: nope\. Available: ecc, gstack/],
    [["setup", "--setup-pipeline", "ecc", "--with-plan-tune-hooks", "--yes"], /--with-plan-tune-hooks requires --setup-pipeline gstack or both/],
    [["mcp", "--profile", "minimal", "--yes", "--dry-run"], /Unknown argument: --profile/],
    [["mcp", "--mcp", "nope", "--yes"], /Unknown MCP server\(s\): nope\. Available: .*context7.*shadcn-studio/]
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 2);
    assert.match(result.stderr.toString(), expected);
    assert.equal(result.stdout.length, 0);
  }
});

test("CLI help and version aliases preserve command contracts", () => {
  // protects=help content and version aliases; fails_when=aliases fail, required help entries disappear, or output uses the wrong stream/status; no_claim=full byte parity for these non-baseline invocations.
  for (const args of [["version"], ["-V"], ["--version"]]) {
    const result = runCli(args);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.toString().trim(), `repo-pattern ${packageJson.version}`);
    assert.equal(result.stderr.length, 0);
  }
  const result = runCli(["help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout.toString(), /repo-pattern help/);
  assert.match(result.stdout.toString(), /--setup-pipeline <ecc\|gstack\|both\|none>/);
  assert.match(result.stdout.toString(), /--with-plan-tune-hooks/);
  assert.equal(result.stderr.length, 0);
});
