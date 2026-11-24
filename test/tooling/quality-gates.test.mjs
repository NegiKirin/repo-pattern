import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkEccCoverage, v8Fixture } from "../../scripts/check-coverage.mjs";
import { checkModuleLimits } from "../../scripts/check-module-limits.mjs";

let fixtureFunctionId = 0;

function functionRange(startOffset, endOffset, count, blocks = []) {
  return { functionName: `fixture-${fixtureFunctionId++}`, ranges: [{ startOffset, endOffset, count, isBlockCoverage: blocks.length > 0 }, ...blocks] };
}

async function coverageFixture(name, functions, { spaced = false, extraScoped = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-coverage-"));
  const lib = path.join(root, "src", "ecc");
  const bin = path.join(root, "bin");
  const coverage = path.join(root, "coverage");
  const file = path.join(lib, spaced ? "ecc-fixture space.mjs" : "ecc-fixture.mjs");
  await Promise.all([fs.mkdir(lib, { recursive: true }), fs.mkdir(bin), fs.mkdir(coverage, { recursive: true })]);
  await fs.writeFile(file, "one\ntwo\nthree\nfour\nfive\n", "utf8");
  if (extraScoped) await fs.writeFile(path.join(lib, "ecc-unreported.mjs"), "unreported\n", "utf8");
  await fs.writeFile(path.join(coverage, "coverage.json"), v8Fixture(file, functions), "utf8");
  return { root, coverage, file };
}

async function rejectsCoverage(name, functions, error) {
  const fixture = await coverageFixture(name, functions);
  try {
    await assert.rejects(() => checkEccCoverage({ coverageDirectory: fixture.coverage, projectRoot: fixture.root, report: false }), error);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
}

async function runQualityGateChecks() {
  await checkModuleLimits();
  const passing = await coverageFixture("passing", [
    functionRange(0, 3, 1), functionRange(4, 7, 1), functionRange(8, 13, 1), functionRange(14, 18, 1),
    functionRange(19, 23, 0, [{ startOffset: 19, endOffset: 22, count: 1, isBlockCoverage: true }])
  ]);
  try {
    await checkEccCoverage({ coverageDirectory: passing.coverage, projectRoot: passing.root, report: false });
  } finally {
    await fs.rm(passing.root, { recursive: true, force: true });
  }
  await rejectsCoverage("function", [
    functionRange(0, 3, 1), functionRange(4, 7, 1), functionRange(8, 13, 0), functionRange(14, 18, 0), functionRange(19, 23, 0)
  ], /function/);
  await rejectsCoverage("branch", [
    functionRange(0, 23, 1, [
      { startOffset: 0, endOffset: 3, count: 1, isBlockCoverage: true },
      { startOffset: 4, endOffset: 7, count: 1, isBlockCoverage: true },
      { startOffset: 8, endOffset: 13, count: 1, isBlockCoverage: true },
      { startOffset: 14, endOffset: 18, count: 0, isBlockCoverage: true }
    ])
  ], /branch/);
  const missing = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-coverage-missing-"));
  try {
    await assert.rejects(() => checkEccCoverage({ coverageDirectory: missing, projectRoot: missing }), /no scoped V8 report/);
  } finally {
    await fs.rm(missing, { recursive: true, force: true });
  }
  const unreported = await coverageFixture("unreported", [functionRange(0, 23, 1)], { extraScoped: true });
  try {
    await assert.rejects(() => checkEccCoverage({ coverageDirectory: unreported.coverage, projectRoot: unreported.root, report: false }), /missing V8 report/);
  } finally {
    await fs.rm(unreported.root, { recursive: true, force: true });
  }
  const spaced = await coverageFixture("spaces", [functionRange(0, 23, 1)], { spaced: true });
  try {
    await checkEccCoverage({ coverageDirectory: spaced.coverage, projectRoot: spaced.root, report: false });
  } finally {
    await fs.rm(spaced.root, { recursive: true, force: true });
  }
}

test("quality gates checks", async () => {
  // protects=module limits and ECC line, function, branch, missing-report, scope, and path handling; fails_when=quality gate accepts invalid coverage or leaves fixtures; no_claim=live coverage generation.
  await runQualityGateChecks();
});
