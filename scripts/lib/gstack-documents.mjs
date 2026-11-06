import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export const GSTACK_DOCUMENT_MANIFEST = "documents.json";
const excluded = /(?:^|\/)(?:\.git|node_modules|test|tests|fixtures|vendor|dependencies|codex|openclaw|contrib)(?:\/|$)|(?:^|\/)(?:CLAUDE|AGENTS|CONTRIBUTING|CHANGELOG|TODOS|README|ETHOS)\.md$/i;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const upstream = (checkout, relative) => execFileSync("git", ["-C", checkout, "show", `HEAD:${relative}`], { maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const comparableText = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));

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
