import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cleanMessageFile, readManagedMode, removeClaudeCoAuthorLines } from "../../.claude.example/hooks/clean-commit-attribution.cjs";

const contract = "protects=raw-byte commit-message cleaning; fails_when=recognized or nonmatching lines are handled incorrectly; no_claim=Git installation or server-side enforcement";

test("removes only exact Claude co-author lines", () => {
  // protects=matcher grammar; fails_when=near matches change; no_claim=Git hook installation
  const input = Buffer.from([
    "Subject\r\n",
    "Co-Authored-By: Claude <noreply@anthropic.com>\n",
    " co-authored-by \t: Claude Opus 4.8 <NOREPLY@ANTHROPIC.COM>\r\n",
    "Co-Authored-By: Claude\tModel X <noreply@anthropic.com>\n",
    "Co-Authored-By: ClaudeBot <noreply@anthropic.com>\n",
    "Co-Authored-By: Claude <other@noreply.anthropic.com>\n",
    "Prose Co-Authored-By: Claude <noreply@anthropic.com>\n",
    "Signed-off-by: Human <human@example.com>"
  ].join(""));
  const expected = Buffer.from("Subject\r\nCo-Authored-By: ClaudeBot <noreply@anthropic.com>\nCo-Authored-By: Claude <other@noreply.anthropic.com>\nProse Co-Authored-By: Claude <noreply@anthropic.com>\nSigned-off-by: Human <human@example.com>");
  assert.deepEqual(removeClaudeCoAuthorLines(input), expected, contract);
});

test("preserves separators, invalid bytes, Unicode, and final-newline state", () => {
  // protects=all nonremoved bytes; fails_when=bytes or final-newline state drift; no_claim=Git's commit-object formatting
  const input = Buffer.concat([
    Buffer.from("é\r\n", "utf8"),
    Buffer.from([0xff, 0x00, 0xfe, 0x0a]),
    Buffer.from("Co-Authored-By:\tClaude X\t<noreply@anthropic.com>\r"),
    Buffer.from("tail", "utf8")
  ]);
  const expected = Buffer.concat([Buffer.from("é\r\n", "utf8"), Buffer.from([0xff, 0x00, 0xfe, 0x0a]), Buffer.from("tail", "utf8")]);
  assert.deepEqual(removeClaudeCoAuthorLines(input), expected, contract);
});

test("does not rewrite an unchanged message file", async () => {
  // protects=unchanged-file no-write; fails_when=mtime or bytes change without a match; no_claim=atomic installation
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-hook-"));
  const file = path.join(directory, "message");
  await fs.writeFile(file, "Subject\n");
  const before = await fs.stat(file);
  await cleanMessageFile(file, "off");
  const after = await fs.stat(file);
  assert.equal(after.mtimeMs, before.mtimeMs, contract);
  assert.deepEqual(await fs.readFile(file), Buffer.from("Subject\n"), contract);
});

test("cleans only in off mode and preserves on/custom", async () => {
  // protects=mode gate; fails_when=on/custom rewrites or off preserves; no_claim=setup integration
  for (const mode of ["on", "custom"]) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-hook-"));
    const file = path.join(directory, "message");
    const input = Buffer.from("Subject\nCo-Authored-By: Claude <noreply@anthropic.com>\n");
    await fs.writeFile(file, input);
    await cleanMessageFile(file, mode);
    assert.deepEqual(await fs.readFile(file), input, contract);
  }
});

test("rejects malformed mode and message paths", async () => {
  // protects=operational errors; fails_when=missing config or unsafe message succeeds; no_claim=installer ownership
  await assert.rejects(() => readManagedMode("/definitely/missing"), /Cannot read managed attribution mode/);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-hook-"));
  const target = path.join(directory, "target");
  await fs.mkdir(target);
  await assert.rejects(() => cleanMessageFile(target, "off"), /regular, non-symlink/);
});
