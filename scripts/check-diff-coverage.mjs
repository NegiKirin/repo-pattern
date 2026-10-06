import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function firstTokenOffsets(source, changedLines) {
  const selected = new Map();
  let offset = 0;
  for (const [index, rawLine] of source.split("\n").entries()) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const text = line.trim();
    if ((!changedLines || changedLines.has(index + 1)) && text && !/^(?:\/\/|\/\*|\*)/.test(text) && /[\p{L}\p{N}_$]/u.test(text)) selected.set(index + 1, offset + line.search(/\S/));
    offset += rawLine.length + 1;
  }
  return selected;
}

export function measureFile(source, changedLines, reports) {
  const selected = firstTokenOffsets(source, changedLines);
  const reportLines = [];
  const reportBlocks = [];
  for (const functions of reports) {
    const ranges = [];
    const blocks = [];
    for (const fn of functions) {
      const rootRange = fn.ranges[0];
      for (const range of fn.ranges) {
        ranges.push({ start: range.startOffset, end: range.endOffset, covered: range.count > 0 });
        if (fn.isBlockCoverage && range !== rootRange) blocks.push({ start: range.startOffset, end: range.endOffset, covered: range.count > 0 });
      }
    }
    reportLines.push(ranges);
    reportBlocks.push(blocks);
  }
  const lines = [...selected].map(([line, offset]) => {
    const executedInAnyReport = reportLines.some((ranges) => {
      const matching = ranges.filter((range) => range.start <= offset && offset < range.end).sort((a, b) => (a.end - a.start) - (b.end - b.start));
      return matching[0]?.covered === true;
    });
    return { line, covered: executedInAnyReport };
  });
  const blockMap = new Map();
  for (const blocks of reportBlocks) {
    for (const block of blocks) {
      if (![...selected.values()].some((offset) => block.start <= offset && offset < block.end)) continue;
      const key = `${block.start}:${block.end}`;
      blockMap.set(key, (blockMap.get(key) || false) || block.covered);
    }
  }
  return { lines, branches: [...blockMap.values()] };
}

export function coveragePasses(result, minimum = 0.8) {
  return result.lines.length === 0 || result.lines.filter((line) => line.covered).length / result.lines.length >= minimum;
}

export function regressionChecks() {
  const parentAndChild = [{ isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 45, count: 5 }, { startOffset: 20, endOffset: 34, count: 0 }] }];
  const uncovered = measureFile("function outer() {\n  work();\n}\n", new Set([2]), [parentAndChild]);
  assert.equal(uncovered.lines[0].covered, false, "zero child range must not inherit parent count");
  const splitReports = [parentAndChild, [{ isBlockCoverage: false, ranges: [{ startOffset: 0, endOffset: 45, count: 1 }] }]];
  assert.equal(measureFile("function outer() {\n  work();\n}\n", new Set([2]), splitReports).lines[0].covered, true, "reports with different range partitions are OR-combined per report");
  assert.deepEqual(measureFile("function f() {\r\n  work();\r\n}\r\n", new Set([2]), [[{ ranges: [{ startOffset: 0, endOffset: 29, count: 1 }] }]]).lines.map(({ covered }) => covered), [true], "CRLF offsets retain original source lengths");
  assert.equal(firstTokenOffsets("// comment\n;\n\nconst value = 1;", null).size, 1, "comments, blank and punctuation-only lines are excluded");
  assert.equal(measureFile("function f(){\n x();\n}", new Set([2]), []).lines[0].covered, false, "missing source coverage is uncovered");
  assert.equal(missingSourceCoverage("file:///source.mjs", []), true, "missing V8 source reports are detected");
  assert.equal(missingSourceCoverage("file:///source.mjs", ["file:///source.mjs"]), false, "present V8 source reports are accepted");
  assert.equal(["scripts/lib/new.mjs", "scripts/self-check/new.mjs"].filter((file) => /^scripts\/lib\/.*\.m?js$/.test(file)).length, 1, "only untracked production lib sources enter scope");
  assert.equal(measureFile("function f(){\n x();\n}", null, [[{ ranges: [{ startOffset: 0, endOffset: 28, count: 1 }] }, { ranges: [{ startOffset: 0, endOffset: 28, count: 1 }] }]]).lines.filter((line) => line.covered).length, 2, "duplicate reports do not duplicate source lines");
  assert.equal(measureFile("function f(){\n x();\n}", new Set([2]), [[{ isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 28, count: 1 }, { startOffset: 14, endOffset: 20, count: 0 }] }]]).branches[0], false, "fn.isBlockCoverage identifies V8 block ranges");
  assert.equal(["scripts/lib/new.mjs"].filter((file) => /^scripts\/lib\/.*\.m?js$/.test(file)).length, 1, "new production files are in scope");
  assert.equal(coveragePasses({ lines: [{ covered: false }] }), false, "below-threshold line coverage fails");
}

export function missingSourceCoverage(sourceUrl, coverageUrls) {
  return !coverageUrls.includes(sourceUrl);
}

const directExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (directExecution) {
  regressionChecks();
  const base = process.argv[2] || "HEAD";
  const coverageDirectory = process.env.NODE_V8_COVERAGE;
  if (!coverageDirectory) throw new Error("Set NODE_V8_COVERAGE by running npm run test:coverage.");
  const changed = new Map();
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  const untracked = status.split(/\r?\n/).filter((line) => line.startsWith("?? ")).map((line) => line.slice(3).replaceAll("\\", "/"));
  const diff = execFileSync("git", ["diff", "--no-ext-diff", "--unified=0", base, "--", "scripts/lib"], { cwd: root, encoding: "utf8" });
  let current;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      current = line.slice(6);
      changed.set(current, changed.get(current) || new Set());
    } else if (line.startsWith("@@") && current) {
      const match = line.match(/\+(\d+)(?:,(\d+))?/);
      if (match) for (let n = Number(match[1]), end = n + Number(match[2] ?? 1); n < end; n++) changed.get(current).add(n);
    }
  }
  for (const file of untracked) if (/^scripts\/lib\/.*\.m?js$/.test(file)) changed.set(file, null);
  const reportsByFile = new Map();
  for (const report of await fs.readdir(coverageDirectory)) {
    const data = JSON.parse(await fs.readFile(path.join(coverageDirectory, report), "utf8"));
    for (const script of data.result || []) {
      let file;
      try { file = fileURLToPath(script.url); } catch { continue; }
      const relative = path.relative(root, file).split(path.sep).join("/");
      if (!changed.has(relative)) continue;
      const reports = reportsByFile.get(relative) || [];
      reports.push(script.functions);
      reportsByFile.set(relative, reports);
    }
  }
  const result = [];
  for (const [file, changedLines] of changed) {
    if (!/^scripts\/lib\/.*\.m?js$/.test(file)) continue;
    const source = await fs.readFile(path.join(root, file), "utf8");
    const reports = reportsByFile.get(file) || [];
    if (!reports.length) throw new Error(`Missing V8 coverage report for changed production source ${file}.`);
    result.push({ file, ...measureFile(source, changedLines, reports) });
  }
  for (const entry of result) {
    const covered = entry.lines.filter((line) => line.covered).length;
    const uncovered = entry.lines.filter((line) => !line.covered).map((line) => line.line);
    const branchCovered = entry.branches.filter(Boolean).length;
    console.log(`${entry.file}: first-token changed source lines ${covered}/${entry.lines.length}; V8 block ranges ${branchCovered}/${entry.branches.length}; uncovered lines ${uncovered.length ? uncovered.join(",") : "none"}`);
  }
  const allLines = result.flatMap((entry) => entry.lines);
  const allBranches = result.flatMap((entry) => entry.branches);
  const covered = allLines.filter((line) => line.covered).length;
  const branchesCovered = allBranches.filter(Boolean).length;
  console.log(`scripts/lib aggregate: first-token changed source lines ${covered}/${allLines.length} (${allLines.length ? (100 * covered / allLines.length).toFixed(1) : "n/a"}%); V8 block ranges ${branchesCovered}/${allBranches.length} (${allBranches.length ? (100 * branchesCovered / allBranches.length).toFixed(1) : "n/a"}%). V8 block ranges are not syntactic branch coverage.`);
  if (result.some((entry) => !coveragePasses(entry))) process.exitCode = 1;
}
