import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const selector = join(process.cwd(), "scripts/select-evals.mjs");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

test("eval selector identifies changed prompt sources and contract suites", () => {
  const fixture = mkdtempSync(join(tmpdir(), "repo-pattern-eval-selector-"));
  try {
    git(fixture, ["init", "--quiet"]);
    git(fixture, ["config", "user.email", "test@example.invalid"]);
    git(fixture, ["config", "user.name", "repo-pattern test"]);
    writeFileSync(join(fixture, "README.md"), "baseline\n");
    git(fixture, ["add", "."]);
    git(fixture, ["commit", "--quiet", "-m", "baseline"]);
    mkdirSync(join(fixture, "src", "ui"), { recursive: true });
    writeFileSync(join(fixture, "src/ui/mcp-interaction.mjs"), "prompt\n");
    writeFileSync(join(fixture, "src/core.mjs"), "core\n");

    const result = JSON.parse(execFileSync(process.execPath, [selector], {
      cwd: fixture,
      encoding: "utf8"
    }));

    assert.deepEqual(result.promptSources, ["src/ui/mcp-interaction.mjs"]);
    assert.deepEqual(result.suites, [
      "test/setup/setup-contract.test.mjs",
      "test/setup/mcp-and-settings.test.mjs"
    ]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
