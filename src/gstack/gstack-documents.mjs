import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export const GSTACK_DOCUMENT_MANIFEST = "documents.json";
const excluded = /(?:^|\/)(?:\.git|node_modules|test|tests|fixtures|vendor|dependencies|codex|openclaw|contrib)(?:\/|$)|(?:^|\/)(?:CLAUDE|AGENTS|CONTRIBUTING|CHANGELOG|TODOS|README|ETHOS)\.md$/i;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const upstream = (checkout, relative) => execFileSync("git", ["-C", checkout, "show", `HEAD:${relative}`], { maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const comparableText = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function quoteShellPaths(source, replacements) {
  return source.replace(/(```(?:bash|sh|shell)\r?\n)([\s\S]*?)(^```)/gm, (_match, opening, body, closing) => opening + body.split("\n").map((line) => {
    let quote = null;
    let result = "";
    for (let index = 0; index < line.length;) {
      const entry = replacements.find(([original]) => line.startsWith(original, index));
      if (entry) {
        const [original, replacement] = entry;
        result += quote === '"' ? replacement.replace(/["$`\\]/g, "\\$&") : quote === "'" ? replacement.replaceAll("'", `'"'"'`) : shellQuote(replacement);
        index += original.length;
        continue;
      }
      const character = line[index++];
      if (character === "\\" && quote !== "'" && index < line.length) result += character + line[index++];
      else { result += character; if (character === quote) quote = null; else if (!quote && (character === "'" || character === '"')) quote = character; }
    }
    return result;
  }).join("\n") + closing);
}

export function rewriteGstackPaths(source, checkout, statePath) {
  const roots = [["/.claude/skills/gstack", checkout], ["/.gstack", statePath], ["/.claude.json", path.join(statePath, "claude.json")], ["/.claude", path.join(statePath, "claude")], ["/.codex", path.join(statePath, "codex")], ["/.bun", path.join(statePath, "bun")]];
  const replacements = [["${GSTACK_HOME:-$HOME/.gstack}", statePath], ...roots.flatMap(([suffix, destination]) => ["~", "$HOME", "${HOME}"].map((home) => [home + suffix, destination]))];
  let rewritten = quoteShellPaths(source, replacements);
  for (const [original, destination] of replacements) rewritten = rewritten.replaceAll(original, destination);
  return rewritten;
}

export function normalizeGstackDocument(source, checkout, statePath, renderRoot = null) {
  const rendered = renderRoot ? source.replaceAll(renderRoot, "~/.claude/skills/gstack").replaceAll(checkout, "~/.claude/skills/gstack") : source;
  return rewriteGstackPaths(rendered, checkout, statePath);
}

export async function normalizeGstackRenderedDocuments(renderRoot, checkout, statePath) {
  const files = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".md")) {
        const source = await fs.readFile(file, "utf8");
        await fs.writeFile(file, normalizeGstackDocument(source, checkout, statePath, renderRoot));
        files.push(file);
      }
    }
  }
  await walk(renderRoot);
  return files;
}

async function safeFile(root, relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => part === "..") || !relative.endsWith(".md") || excluded.test(relative)) throw new Error(`invalid document path: ${relative}`);
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`document symlink: ${relative}`);
  }
  if (!(await fs.lstat(current)).isFile()) throw new Error(`document is not a file: ${relative}`);
  return current;
}

function markdownDestinations(line) {
  const destinations = [];
  const links = /!?(?:\[[^\]]*\])\(/g;
  for (const match of line.matchAll(links)) {
    let end = match.index + match[0].length;
    let depth = 0;
    let angleDestination = false;
    for (; end < line.length; end++) {
      if (line[end] === "\\") { end++; continue; }
      if (line[end] === "<" && end === match.index + match[0].length) angleDestination = true;
      else if (line[end] === ">" && angleDestination) angleDestination = false;
      else if (!angleDestination && line[end] === "(") depth++;
      else if (!angleDestination && line[end] === ")") {
        if (depth === 0) break;
        depth--;
      }
    }
    if (end === line.length) continue;
    const destination = line.slice(match.index + match[0].length, end).trim().replace(/\\([ ()])/g, "$1").replace(/^<|>$/g, "").split(/\s+(?=["'])/, 1)[0];
    if (/\.md(?:#[\w-]+)?$/.test(destination)) destinations.push({ reference: destination, link: true });
  }
  const references = /(?:https?:\/\/[^\s`<>"')]+|(?:\$\{HOME\}|\$HOME|~)\/\.claude\/skills\/gstack\/[^\s`<>"')]+|[\w.$~{}/-]+\.md(?:#[\w-]+)?)/g;
  for (const match of line.matchAll(references)) destinations.push({ reference: match[0], link: false });
  return destinations;
}

export async function discoverGstackDocuments(checkout, seeds, { clean = false, diagnostics = null } = {}) {
  const pending = [...seeds];
  const found = new Set();
  while (pending.length) {
    const relative = pending.shift();
    if (found.has(relative) || excluded.test(relative)) continue;
    const file = await safeFile(checkout, relative);
    found.add(relative);
    const lines = (clean ? upstream(checkout, relative).toString("utf8") : await fs.readFile(file, "utf8")).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      // Markdown links, inline paths, and shell/prose paths share the same local resolver.
      const seen = new Set();
      for (const { reference, link } of markdownDestinations(line)) {
        if (seen.has(reference)) continue;
        seen.add(reference);
        const position = line.indexOf(reference);
        if (/^https?:/.test(reference)) continue;
        if (!link && (!/\.md(?:#.*)?$/.test(reference) || /<[^>]+>/.test(line.slice(position - 1, position + reference.length + 1)))) continue;
        if (!link && (line[position - 1] === "<" || line[position + reference.length] === ">" || line.slice(position + reference.length).startsWith(".tmpl"))) continue;
        if (line[position - 1] === "*" || reference.includes("*")) {
          const message = `${relative}:${index + 1}: unresolved glob document reference ${reference}`;
          if (diagnostics) { diagnostics.push(message); continue; }
          throw new Error(message);
        }
        const local = reference.replace(/^(?:\$\{HOME\}|\$HOME|~)\/\.claude\/skills\/gstack\//, "");
        if (/[${}~]/.test(local)) {
          const message = `${relative}:${index + 1}: unresolved dynamic document reference ${reference}`;
          if (diagnostics) { diagnostics.push(message); continue; }
          throw new Error(message);
        }
        const rooted = local !== reference;
        if (!rooted && path.isAbsolute(local) && !local.startsWith(`${path.resolve(checkout)}${path.sep}`)) {
          const message = `${relative}:${index + 1}: document reference outside checkout: ${reference}`;
          if (diagnostics) { diagnostics.push(message); continue; }
          throw new Error(message);
        }
        const candidate = path.resolve(rooted ? checkout : path.dirname(file), local.split("#")[0]);
        const resolved = path.relative(checkout, candidate).split(path.sep).join("/");
        if (resolved === ".." || resolved.startsWith("../") || path.isAbsolute(resolved)) throw new Error(`${relative}:${index + 1}: document reference outside checkout: ${reference}`);
        if (excluded.test(resolved)) continue;
        try { await safeFile(checkout, resolved); }
        catch (error) {
          const message = `${relative}:${index + 1}: unresolved document reference ${reference}`;
          if (error.code === "ENOENT" && diagnostics) { diagnostics.push(message); continue; }
          throw new Error(`${message}: ${error.message}`);
        }
        pending.push(resolved);
      }
    }
  }
  return [...found].sort();
}

export async function normalizeGstackDocuments(checkout, seeds, normalize) {
  const diagnostics = [];
  const inventory = await discoverGstackDocuments(checkout, seeds, { clean: true, diagnostics });
  const files = [];
  for (const relative of inventory) {
    const file = await safeFile(checkout, relative);
    const actual = comparableText(await fs.readFile(file));
    const clean = comparableText(upstream(checkout, relative));
    if (!actual.equals(clean)) throw new Error(`gstack document ownership conflict: ${relative} differs from Git upstream`);
    const normalized = comparableText(Buffer.from(normalize(clean.toString("utf8"))));
    await fs.writeFile(file, normalized);
    files.push({ path: relative, upstreamSha256: hash(clean), normalizedSha256: hash(normalized) });
  }
  return { version: 1, files, ...(diagnostics.length ? { diagnostics: [...new Set(diagnostics)] } : {}) };
}

export async function restoreGstackDocuments(checkout, manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.files)) throw new Error("documents.json: invalid managed document manifest");
  const errors = await verifyGstackDocuments(checkout, manifest);
  if (errors.length) throw new Error(`gstack document ownership conflict: ${errors.join("; ")}`);
  for (const entry of manifest.files) await fs.writeFile(await safeFile(checkout, entry.path), upstream(checkout, entry.path));
}

export async function recordGstackDocuments(checkout, seeds) {
  const diagnostics = [];
  const inventory = await discoverGstackDocuments(checkout, seeds, { diagnostics });
  const files = [];
  for (const relative of inventory) {
    const file = await safeFile(checkout, relative);
    const original = comparableText(await fs.readFile(file));
    const clean = comparableText(upstream(checkout, relative));
    if (!original.equals(clean)) throw new Error(`gstack document ownership conflict: ${relative} differs from Git upstream`);
    files.push({ path: relative, sha256: hash(original) });
  }
  return { version: 2, files, ...(diagnostics.length ? { diagnostics: [...new Set(diagnostics)] } : {}) };
}

export async function verifyGstackDocuments(checkout, manifest) {
  const errors = [];
  if (manifest?.version === 1) {
    if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.some((entry) => !entry || !/^[a-f0-9]{64}$/.test(entry.upstreamSha256) || !/^[a-f0-9]{64}$/.test(entry.normalizedSha256))) return ["documents.json: invalid or unsupported upstream document manifest; reinstall gstack using upstream setup"];
    for (const entry of manifest.files) {
      try {
        const file = await safeFile(checkout, entry.path);
        const actual = hash(comparableText(await fs.readFile(file)));
        const clean = hash(comparableText(upstream(checkout, entry.path)));
        if (actual !== entry.normalizedSha256 && actual !== clean) throw new Error("managed bytes changed");
        if (clean !== entry.upstreamSha256) throw new Error("upstream hash mismatch");
      } catch (error) { errors.push(`${entry?.path || "documents.json"}: document manifest integrity failure: ${error.message}; preserve user changes and rerun repo-pattern setup`); }
    }
    return errors;
  }
  if (manifest?.version !== 2 || !Array.isArray(manifest.files) || !manifest.files.length) return ["documents.json: invalid or unsupported upstream document manifest; reinstall gstack using upstream setup"];
  const seen = new Set();
  for (const entry of manifest.files) {
    try {
      if (!entry || seen.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("invalid manifest entry");
      seen.add(entry.path);
      const file = await safeFile(checkout, entry.path);
      if (hash(comparableText(upstream(checkout, entry.path))) !== entry.sha256) throw new Error("upstream hash mismatch");
      if (hash(comparableText(await fs.readFile(file))) !== entry.sha256) throw new Error("managed bytes changed");
    } catch (error) { errors.push(`${entry?.path || "documents.json"}: document manifest integrity failure: ${error.message}; preserve user changes and rerun repo-pattern setup`); }
  }
  return errors;
}
