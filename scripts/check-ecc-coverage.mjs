import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_MINIMUM = 80;

function sourcePath(url) {
  return url.startsWith("file:") ? fileURLToPath(url) : null;
}

function isScopedFile(file, projectRoot) {
  const relative = path.relative(projectRoot, file).split(path.sep).join("/");
  return relative === "scripts/lib/rules.mjs" || /^scripts\/lib\/ecc-.*\.mjs$/.test(relative);
}

function rangesFor(functions, select) {
  const ranges = new Map();
  for (const entry of functions) {
    const root = entry.ranges[0];
    for (const range of entry.ranges.filter((range, index) => select(range, root, index))) {
      const key = `${range.startOffset}:${range.endOffset}`;
      ranges.set(key, Math.max(ranges.get(key) || 0, range.count));
    }
  }
  return [...ranges.values()];
}

function coveredTotal(counts) {
  return { covered: counts.filter((count) => count > 0).length, total: counts.length };
}

function percentage({ covered, total }) {
  return total === 0 ? 100 : (covered / total) * 100;
}

function lineCounts(source, functions) {
  const ranges = functions.flatMap((entry) => entry.ranges);
  const offsets = [];
  let offset = 0;
  for (const line of source.split(/\r?\n/)) {
    offsets.push([offset, offset + line.length, line]);
    offset += line.length + 1;
  }
  return coveredTotal(offsets.flatMap(([start, end, line]) => {
    if (!line.trim()) return [];
    const matching = ranges.filter((range) => range.startOffset < end && range.endOffset > start);
    if (matching.length === 0) return [];
    return [Math.max(...matching.map((range) => range.count))];
  }));
}

async function scopedFiles(projectRoot) {
  const lib = path.join(projectRoot, "scripts", "lib");
  const entries = await fs.readdir(lib, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && isScopedFile(path.join(lib, entry.name), projectRoot)).map((entry) => path.join(lib, entry.name));
}

export async function summarizeEccCoverage({ coverageDirectory, projectRoot }) {
  const reports = await fs.readdir(coverageDirectory).catch(() => []);
  const scripts = new Map();
  for (const report of reports) {
    const entries = JSON.parse(await fs.readFile(path.join(coverageDirectory, report), "utf8"));
    for (const script of entries.result || []) {
      const file = sourcePath(script.url);
      if (file && isScopedFile(file, projectRoot)) {
        const existing = scripts.get(file) || [];
        existing.push(...script.functions);
        scripts.set(file, existing);
      }
    }
  }
  if (scripts.size === 0) throw new Error("ECC coverage failed: no scoped V8 report found.");
  const missing = (await scopedFiles(projectRoot)).filter((file) => !scripts.has(file));
  if (missing.length) throw new Error(`ECC coverage failed: missing V8 report for ${missing.map((file) => path.relative(projectRoot, file)).join(", ")}.`);
  const files = [];
  for (const [file, functions] of scripts) {
    const source = await fs.readFile(file, "utf8");
    files.push({
      file: path.relative(projectRoot, file).split(path.sep).join("/"),
      line: lineCounts(source, functions),
      function: coveredTotal(rangesFor(functions, (_range, _root, index) => index === 0)),
      branch: coveredTotal(rangesFor(functions, (range, root) => range !== root && range.isBlockCoverage === true))
    });
  }
  const aggregate = ["line", "function", "branch"].reduce((result, metric) => {
    result[metric] = files.reduce((total, file) => ({ covered: total.covered + file[metric].covered, total: total.total + file[metric].total }), { covered: 0, total: 0 });
    return result;
  }, {});
  return { files, aggregate };
}

function formatMetric(name, result) {
  return `${name} ${result.covered}/${result.total} (${percentage(result).toFixed(1)}%)`;
}

export async function checkEccCoverage({ coverageDirectory = process.env.NODE_V8_COVERAGE, projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url))), minimum = DEFAULT_MINIMUM, report = true } = {}) {
  if (!coverageDirectory) throw new Error("ECC coverage failed: NODE_V8_COVERAGE is not set.");
  const summary = await summarizeEccCoverage({ coverageDirectory, projectRoot });
  if (report) {
    for (const file of summary.files) console.log(`${file.file}: ${["line", "function", "branch"].map((metric) => formatMetric(metric, file[metric])).join(", ")}`);
    console.log(`aggregate: ${["line", "function", "branch"].map((metric) => formatMetric(metric, summary.aggregate[metric])).join(", ")}`);
  }
  const failed = ["line", "function", "branch"].filter((metric) => percentage(summary.aggregate[metric]) < minimum);
  if (failed.length) throw new Error(`ECC coverage failed: ${failed.join(", ")} below ${minimum}%.`);
  return summary;
}

export function v8Fixture(url, functions) {
  return JSON.stringify({ result: [{ url: pathToFileURL(url).href, functions }] });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkEccCoverage().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
