import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { discoverGstackDocuments, normalizeGstackDocuments, verifyGstackDocuments, restoreGstackDocuments } from "../lib/gstack-documents.mjs";
import { replaceGstackPaths } from "../lib/gstack.mjs";

// Fixtures stay inside the repository; no global install or downloaded code is used.
const root = await fs.mkdtemp(path.resolve(".gstack-documents-test-"));
try {
  const checkout = path.join(root, "checkout");
  const state = path.join(root, "state");
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
  const normalize = (source) => replaceGstackPaths(source, checkout, state);
  const manifest = await normalizeGstackDocuments(checkout, ["SKILL.md"], normalize);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.files.length, 3);
  assert.equal((await verifyGstackDocuments(checkout, manifest)).length, 0);
  await write("line-endings.md", "first\nsecond\n");
  // Simulate a CRLF checkout with a committed LF blob.
  const lineEndingsGit = (...args) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" });
  lineEndingsGit("add", "line-endings.md");
  lineEndingsGit("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "line endings");
  await fs.writeFile(path.join(checkout, "line-endings.md"), "first\r\nsecond\r\n");
  const lineEndingManifest = await normalizeGstackDocuments(checkout, ["line-endings.md"], (source) => source);
  assert.equal(lineEndingManifest.files[0].upstreamSha256, lineEndingManifest.files[0].normalizedSha256);
  assert.equal((await verifyGstackDocuments(checkout, lineEndingManifest)).length, 0);
  await fs.writeFile(path.join(checkout, "line-endings.md"), "first\nsecond\n");
  const actual = await fs.readFile(path.join(checkout, "SKILL.md"), "utf8");
  assert(actual.includes(`${checkout}/bin/gstack-design-detect.ts`));
  assert(!actual.includes("$HOME"));
  assert.equal(normalize(actual), actual);
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
  await restoreGstackDocuments(checkout, manifest);
  assert.equal(git("diff"), "");
  assert.deepEqual(await normalizeGstackDocuments(checkout, ["SKILL.md"], normalize), manifest);
  const deleted = path.join(checkout, "shared.md");
  assert.equal(execFileSync("git", ["-C", checkout, "rm", "--cached", "shared.md"], { encoding: "utf8" }), "rm 'shared.md'\n");
  assert.equal(execFileSync("git", ["-C", checkout, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "remove upstream document"], { encoding: "utf8" }), "");
  // Value: protects=restore leaves manifest documents absent from upstream untouched; fails_when=restore errors or rewrites a managed file when another is absent; why_new=existing coverage tests only restoration when every manifest document exists in HEAD; seam=none
  await restoreGstackDocuments(checkout, manifest);
  assert.equal(await fs.readFile(deleted, "utf8"), "Read [guide](references/guide.md).\n");
  assert.match((await verifyGstackDocuments(checkout, { version: 999, files: [] })).join("\n"), /manifest/);
  assert.match((await verifyGstackDocuments(checkout, { version: 1, files: [{ path: "../outside.md" }] })).join("\n"), /manifest/);
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
  for (const prefix of ["~", "$HOME", "${HOME}"]) {
    const source = `${prefix}/.claude/skills/gstack/bin/detect ${prefix}/.gstack/state`;
    assert(!normalize(source).includes(prefix));
  }
  // Value: protects=shell roots preserve backslash and escaped-quote syntax; fails_when=quoting corrupts an escaped shell operand; why_new=existing paths test spaces quotes and dollars but not backslashes; seam=none
  for (const project of ["project\\\\checkout\\", "project with spaces", "project's checkout", 'project "quoted"', "project $literal"]) {
    const installation = path.join(root, project);
    for (const operand of ["$HOME/.claude/skills/gstack/bin/detect", '"$HOME/.claude/skills/gstack/bin/detect"', "'~/.claude/skills/gstack/bin/detect'"]) {
      const rewritten = replaceGstackPaths(`\`\`\`bash\nprintf '%s' ${operand}\n\`\`\`\n`, installation, state);
      const command = rewritten.split("\n").slice(1, -2).join("\n");
      assert.equal(execFileSync("bash", ["-c", command], { encoding: "utf8" }), `${installation}/bin/detect`);
      assert.equal(replaceGstackPaths(rewritten, installation, state), rewritten);
    }
  }
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
