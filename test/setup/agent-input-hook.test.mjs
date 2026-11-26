import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const hook = path.join(testDir, "../../.claude.example/hooks/sanitize-agent-input.mjs");
const context = "Agent effort and isolation were removed by the user hook. Do not assume worktree or remote isolation; verify the actual working directory and checkout.";

function run(input, cwd = testDir) {
  return spawnSync(process.execPath, [hook], { input, cwd, encoding: "utf8" });
}

function runValid(toolInput) {
  const result = run(JSON.stringify({ tool_input: toolInput }));
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("sanitizes valid Agent inputs and preserves unrelated data", () => {
  // protects=valid Agent input contract; fails_when=effort/isolation or unrelated data is mishandled; no_claim=does not prove live provider hook behavior
  assert.deepEqual(runValid({}), {});
  assert.deepEqual(runValid({ prompt: "p", effort: "high" }).hookSpecificOutput.updatedInput, { prompt: "p" });
  assert.deepEqual(runValid({ isolation: "worktree", model: "m" }).hookSpecificOutput.updatedInput, { model: "m" });
  const both = runValid({ prompt: "p", model: "m", effort: "low", isolation: "remote" });
  assert.deepEqual(both.hookSpecificOutput.updatedInput, { prompt: "p", model: "m" });
  assert.deepEqual(runValid({ effort: null, isolation: null, keep: false }).hookSpecificOutput.updatedInput, { keep: false });
  const nested = runValid({ effort: "high", nested: { effort: "keep", isolation: ["keep"] }, prompt: "prompt" });
  assert.deepEqual(nested.hookSpecificOutput.updatedInput, { nested: { effort: "keep", isolation: ["keep"] }, prompt: "prompt" });
  assert.equal(nested.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(nested.hookSpecificOutput.additionalContext, context);
});

test("rejects invalid JSON and top-level values", () => {
  // protects=invalid top-level input rejection; fails_when=invalid input exits successfully or emits updatedInput; no_claim=does not prove all provider protocol errors are handled
  for (const input of ["{", "null", "[]", JSON.stringify("text"), "42"]) {
    const result = run(input);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Invalid (JSON|top-level)/);
    assert.doesNotMatch(result.stdout, /updatedInput/);
  }
});

test("rejects missing and invalid tool_input values", () => {
  // protects=tool_input validation boundary; fails_when=missing, null, array, or primitive tool_input is accepted; no_claim=does not prove live Agent dispatch validation
  for (const payload of [{}, { tool_input: null }, { tool_input: [] }, { tool_input: "text" }, { tool_input: 1 }]) {
    const result = run(JSON.stringify(payload));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Invalid tool_input/);
    assert.doesNotMatch(result.stdout, /updatedInput/);
  }
});

test("runs from a project path containing spaces", async () => {
  // protects=quoted-path runtime invocation; fails_when=Node cannot launch the hook from a spaced path; no_claim=does not prove Claude Code provider execution
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo pattern hook "));
  try {
    const result = run(JSON.stringify({ tool_input: { effort: null, prompt: "ok" } }), root);
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout).hookSpecificOutput.updatedInput, { prompt: "ok" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
