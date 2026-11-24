import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import packageJson from "../../package.json" with { type: "json" };

const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const cliPath = path.join(repoRoot, "bin", "repo-pattern.mjs");
const evidenceRoot = path.join(repoRoot, "test", "fixtures", "cli-baseline");
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
    stderr: await readFile(path.join(evidenceRoot, `${name}.stderr`)).catch((error) => error.code === "ENOENT" ? Buffer.alloc(0) : Promise.reject(error))
  };
}

async function assertBaseline(name, args, expectedStatus) {
  const expected = await baselineStreams(name);
  const result = runCli(args);
  assert.equal(result.status, expectedStatus);
  assert.deepEqual(result.stdout, expected.stdout);
  assert.deepEqual(result.stderr, expected.stderr);
}

test("help output exposes the CLI contract", async () => {
  // protects=help status, stream, and required command/option guidance; fails_when=help is unsuccessful, diagnostic output goes to stderr, or required guidance disappears; no_claim=incidental whitespace, ANSI bytes, or exact historical Linux output.
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr.length, 0);
  assert.match(result.stdout.toString(), /repo-pattern help/);
  assert.match(result.stdout.toString(), /--setup-pipeline <ecc\\|gstack\\|both\\|none>/);
  assert.match(result.stdout.toString(), /--with-plan-tune-hooks/);
  await assertBaseline("help", ["--help"], 0);
});

test("version output exposes package metadata", async () => {
  // protects=version status, stream, and package version metadata; fails_when=version is unsuccessful, writes diagnostics to stderr, or reports the wrong version; no_claim=incidental whitespace or exact historical Linux output.
  const result = runCli(["--version"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.toString().trim(), `repo-pattern ${packageJson.version}`);
  assert.equal(result.stderr.length, 0);
  const ciWorkflow = await readFile(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  assert.ok(ciWorkflow.includes(`test "$version" = "repo-pattern ${packageJson.version}"`));
});

test("invalid command output is diagnostic-only", () => {
  // protects=invalid-command diagnostic stream and nonzero status; fails_when=unknown commands look successful or write usage to stdout; no_claim=all invalid argument combinations.
  const result = runCli(["not-a-command"]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout.length, 0);
  assert.match(result.stderr.toString(), /^Unknown command: not-a-command\n$/);
});

test("noninteractive dry-run reports a preview without writing", async () => {
  // protects=none-pipeline dry-run status, preview semantics, target identity, and no-write behavior; fails_when=dry-run claims failure, omits the target/preview, or creates workspace files; no_claim=incidental whitespace, ANSI bytes, or live upstream output.
  const target = await mkdtemp(path.join(os.tmpdir(), "repo-pattern-cli-dry-run-"));
  try {
    const result = runCli(["setup", "--target", target, "--setup-pipeline", "none", "--yes", "--dry-run"]);
    assert.equal(result.status, 0);
    assert.match(result.stderr.toString(), /MCP values missing:/);
    assert.match(result.stdout.toString(), /dry-run|preview/i);
    assert.match(result.stdout.toString(), new RegExp(target.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")));
    const expected = await baselineStreams("dry-run");
    assert.match(expected.stdout.toString(), /\[dry-run\] mkdir -p/);
    assert.match(expected.stdout.toString(), /Setup 100%/);
    assert.match(expected.stderr.toString(), /MCP values missing:/);
    assert.deepEqual(await fs.readdir(target), []);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("conflicting setup flags fail with a diagnostic and no stdout", async () => {
  // protects=force-and-migrate rejection status, diagnostic, and stream ownership; fails_when=conflicting flags succeed, emit stdout, or omit an actionable error; no_claim=incidental whitespace or exact historical baseline bytes.
  const result = runCli(["setup", "--force", "--migrate"]);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout.length, 0);
  assert.match(result.stderr.toString(), /force|migrate|conflict/i);
  const expected = await readFile(path.join(evidenceRoot, "force-migrate.stderr"));
  assert.equal(result.status, Number((await readFile(path.join(evidenceRoot, "force-migrate.exit"), "utf8")).trim().replace("exit=", "")));
  assert.deepEqual(result.stderr, expected);
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
