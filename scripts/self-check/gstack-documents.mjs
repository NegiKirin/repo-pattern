import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { discoverGstackDocuments, recordGstackDocuments, rewriteGstackPaths, verifyGstackDocuments } from "../../src/gstack/gstack-documents.mjs";

// Fixtures stay inside the repository; no global install or downloaded code is used.
const root = await fs.mkdtemp(path.resolve(".gstack-documents-test-"));
try {
  const checkout = path.join(root, "checkout");
  const write = async (relative, content) => {
    const file = path.join(checkout, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  };
  await write("SKILL.md", 'Read [guide](references/guide.md#steps).\n```bash\nbun run $HOME/.claude/skills/gstack/bin/gstack-design-detect.ts\n```\n');
  await write("references/guide.md", "Read `../shared.md` and [again](../shared.md). State: ${HOME}/.gstack\n");
  await write("shared.md", "Read [guide](references/guide.md).\n");
  await write("references/guide (copy).md", "spaced guide\n");
  await write("references/guide (notes).md", "spaced notes\n");
  for (const file of ["SKILL.md.tmpl", "test/SKILL.md", "node_modules/x.md", "CONTRIBUTING.md", "bin/source.ts"]) await write(file, "$HOME/.gstack");
  const git = (...args) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
  const inventory = await discoverGstackDocuments(checkout, ["SKILL.md"]);
  assert.deepEqual(inventory, ["SKILL.md", "references/guide.md", "shared.md"]);
  const manifest = await recordGstackDocuments(checkout, ["SKILL.md"]);
  assert.equal(manifest.version, 2);
  assert.match((await verifyGstackDocuments(checkout, { ...manifest, version: 1 })).join("\n"), /unsupported/);
  assert.deepEqual(manifest.files.map(({ path }) => path), inventory);
  assert(manifest.files.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)));
  assert.equal((await verifyGstackDocuments(checkout, manifest)).length, 0);
  const rewritten = rewriteGstackPaths("State ${GSTACK_HOME:-$HOME/.gstack} and ~/.claude/skills/gstack/bin/tool\n```bash\necho '$HOME/.gstack'\n````", "/tmp/project's checkout/.claude/skills/gstack", "/tmp/project's checkout/.repo-pattern/gstack");
  assert(!rewritten.includes("$HOME/.gstack"));
  assert(rewritten.includes("/tmp/project's checkout/.repo-pattern/gstack"));
  await write("line-endings.md", "first\nsecond\n");
  const lineEndingsGit = (...args) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" });
  lineEndingsGit("add", "line-endings.md");
  lineEndingsGit("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "line endings");
  await fs.writeFile(path.join(checkout, "line-endings.md"), "first\r\nsecond\r\n");
  const lineEndingManifest = await recordGstackDocuments(checkout, ["line-endings.md"]);
  assert.equal((await verifyGstackDocuments(checkout, lineEndingManifest)).length, 0);
  await fs.writeFile(path.join(checkout, "line-endings.md"), "first\nsecond\n");
  const actual = await fs.readFile(path.join(checkout, "SKILL.md"), "utf8");
  assert(actual.includes("$HOME"));
  for (const file of ["SKILL.md.tmpl", "test/SKILL.md", "node_modules/x.md", "CONTRIBUTING.md", "bin/source.ts"]) assert.equal(await fs.readFile(path.join(checkout, file), "utf8"), "$HOME/.gstack");
  await fs.appendFile(path.join(checkout, "shared.md"), "user edit");
  assert.match((await verifyGstackDocuments(checkout, manifest)).join("\n"), /shared.md/);
  await fs.writeFile(path.join(checkout, "shared.md"), "Read [guide](references/guide.md).\n");
  await fs.rm(path.join(checkout, "shared.md"));
  assert.match((await verifyGstackDocuments(checkout, manifest)).join("\n"), /shared.md/);
  await fs.symlink(path.join(checkout, "SKILL.md"), path.join(checkout, "shared.md"));
  assert.match((await verifyGstackDocuments(checkout, manifest)).join("\n"), /shared.md/);
  await assert.rejects(() => discoverGstackDocuments(checkout, ["SKILL.md"]), /symlink/);
  await fs.rm(path.join(checkout, "shared.md"));
  await write("shared.md", "Read [guide](references/guide.md).\n");
  assert.equal((await verifyGstackDocuments(checkout, manifest)).length, 0);
  assert.match((await verifyGstackDocuments(checkout, { version: 999, files: [] })).join("\n"), /manifest/);
  assert.match((await verifyGstackDocuments(checkout, { version: 2, files: [{ path: "../outside.md" }] })).join("\n"), /manifest/);
  for (const reference of ["../outside.md", "$DOCS/guide.md", "missing.md"]) {
    await write("references/guide.md", `Read \`${reference}\``);
    if (reference === "../outside.md") continue;
    await assert.rejects(() => discoverGstackDocuments(checkout, ["SKILL.md"]), /references\/guide.md:1/);
  }
  await write("references/guide.md", "Read [outside](../../outside.md)");
  await assert.rejects(() => discoverGstackDocuments(checkout, ["SKILL.md"]), /outside checkout/);
  await write("references/guide.md", "Read https://example.com/manual.md and `<name>.md`.");
  assert.deepEqual(await discoverGstackDocuments(checkout, ["SKILL.md"]), ["SKILL.md", "references/guide.md"]);
  await write("references/guide.md", "Read `$HOME/.claude/skills/gstack/shared.md#section`");
  assert.deepEqual(await discoverGstackDocuments(checkout, ["SKILL.md"]), inventory);
  const diagnostics = [];
  await write("references/guide.md", "Read `$DOCS/guide.md` and `missing.md`");
  assert.deepEqual(await discoverGstackDocuments(checkout, ["SKILL.md"], { diagnostics }), ["SKILL.md", "references/guide.md"]);
  assert.equal(diagnostics.length, 2);
  for (const reference of ["*/SKILL.md", "/docs/auth-architecture.md"]) {
    const warnings = [];
    await write("references/guide.md", `Read '${reference}'`);
    assert.deepEqual(await discoverGstackDocuments(checkout, ["SKILL.md"], { diagnostics: warnings }), ["SKILL.md", "references/guide.md"]);
    assert.equal(warnings.length, 1);
    await assert.rejects(() => discoverGstackDocuments(checkout, ["SKILL.md"]), /references\/guide.md:1/);
  }
  await write("references/guide.md", "Read `SKILL.md.tmpl`");
  assert.deepEqual(await discoverGstackDocuments(checkout, ["SKILL.md"]), ["SKILL.md", "references/guide.md"]);
  await write("references/guide.md", "See [copy](guide (copy).md) and [notes](<guide (notes).md>).");
  assert.deepEqual(await discoverGstackDocuments(checkout, ["SKILL.md"]), ["SKILL.md", "references/guide (copy).md", "references/guide (notes).md", "references/guide.md"]);
  await write("references/guide (copy).md", "nested paren reference: [deep](deep (nested).md)");
  await write("references/deep (nested).md", "nested destination\n");
  assert.deepEqual(await discoverGstackDocuments(checkout, ["SKILL.md"]), ["SKILL.md", "references/deep (nested).md", "references/guide (copy).md", "references/guide (notes).md", "references/guide.md"]);
  await write("references/guide (copy).md", "nested paren reference: [deep](<deep (nested).md>)");
  assert.deepEqual(await discoverGstackDocuments(checkout, ["SKILL.md"]), ["SKILL.md", "references/deep (nested).md", "references/guide (copy).md", "references/guide (notes).md", "references/guide.md"]);
  console.log("gstack document checks passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
