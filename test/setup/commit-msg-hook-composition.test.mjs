import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { installCommitMsgHook } from "../../src/setup/commit-msg-hook.mjs";

const contract = "protects=existing commit-msg hook composition; fails_when=hook contract, status, or cleanup order changes; no_claim=unsupported hook managers or server enforcement";

async function repo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-compose-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  await fs.mkdir(path.join(root, ".claude"));
  await fs.writeFile(path.join(root, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ _repo_pattern_source: "generated-attribution-removal", _repo_pattern_attribution_mode: "off" }] } }));
  return root;
}

test("preserves executable hook and cleans trailer added by it", async () => {
  // protects=single existing-hook invocation and post-success cleanup; fails_when=bytes/mode/count or trailer cleanup changes; no_claim=linked worktree integration
  const root = await repo();
  const hook = path.join(root, ".git", "hooks", "commit-msg");
  await fs.writeFile(hook, "#!/bin/sh\nprintf '%s\\n' \"$0|$1|$PWD|$TEST_COMPOSE\" > \"$PWD/invocation\"\nprintf 'Co-Authored-By: Claude Hook <noreply@anthropic.com>\\n' >> \"$1\"\n", { mode: 0o755 });
  const original = await fs.readFile(hook);
  const mode = (await fs.stat(hook)).mode & 0o7777;
  await installCommitMsgHook({ target: root, sourceRoot: path.resolve(".") });
  const backup = await fs.readFile(path.join(root, ".git", "hooks", "commit-msg.repo-pattern-original"));
  assert.deepEqual(backup.subarray(0, original.length), original, contract);
  assert.equal((await fs.stat(path.join(root, ".git", "hooks", "commit-msg.repo-pattern-original"))).mode & 0o7777, mode, contract);
  const message = path.join(root, "message");
  await fs.writeFile(message, "Subject\n");
  const result = spawnSync(path.join(root, ".git", "hooks", "commit-msg"), [message], { cwd: root, env: { ...process.env, TEST_COMPOSE: "yes" }, stdio: "inherit" });
  assert.equal(result.status, 0, contract);
  assert.match(await fs.readFile(path.join(root, "invocation"), "utf8"), /commit-msg\.repo-pattern-original.*message.*yes/, contract);
  assert.doesNotMatch(await fs.readFile(message, "utf8"), /Co-Authored-By: Claude Hook/, contract);
});

test("preserves rejection status and skips cleanup", async () => {
  // protects=existing-hook rejection precedence; fails_when=cleanup runs or status changes; no_claim=Git commit validation
  const root = await repo();
  const hook = path.join(root, ".git", "hooks", "commit-msg");
  await fs.writeFile(hook, "#!/bin/sh\nprintf 'Co-Authored-By: Claude Rejected <noreply@anthropic.com>\\n' >> \"$1\"\nexit 37\n", { mode: 0o755 });
  await installCommitMsgHook({ target: root, sourceRoot: path.resolve(".") });
  const message = path.join(root, "message");
  await fs.writeFile(message, "Subject\n");
  const result = spawnSync(path.join(root, ".git", "hooks", "commit-msg"), [message], { cwd: root, stdio: "inherit" });
  assert.equal(result.status, 37, contract);
  assert.match(await fs.readFile(message, "utf8"), /Co-Authored-By: Claude Rejected/, contract);
});

test("shared linked-worktree hook reads each worktree mode", async () => {
  // protects=worktree-local mode lookup through a shared hook; fails_when=one worktree uses another mode or cleanup is skipped; no_claim=all linked-worktree Git configurations
  const main = await repo();
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: main });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: main });
  await fs.writeFile(path.join(main, "tracked"), "tracked\n");
  execFileSync("git", ["add", "tracked"], { cwd: main });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: main });
  const linked = `${main} linked worktree`;
  execFileSync("git", ["worktree", "add", "-q", "-b", "linked-mode", linked], { cwd: main });
  const sharedHooks = path.join(main, ".git", "shared hooks");
  await fs.mkdir(sharedHooks);
  execFileSync("git", ["config", "core.hooksPath", sharedHooks], { cwd: main });
  await fs.rm(path.join(main, ".claude"), { recursive: true, force: true });
  await fs.mkdir(path.join(main, ".claude"));
  await fs.writeFile(path.join(main, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ _repo_pattern_source: "generated-attribution-removal", _repo_pattern_attribution_mode: "off" }] } }));
  await fs.rm(path.join(linked, ".claude"), { recursive: true, force: true });
  await fs.mkdir(path.join(linked, ".claude"));
  await fs.writeFile(path.join(linked, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ _repo_pattern_source: "generated-attribution-removal", _repo_pattern_attribution_mode: "on" }] } }));
  await installCommitMsgHook({ target: main, sourceRoot: path.resolve(".") });
  const hook = path.join(sharedHooks, "commit-msg");
  for (const [cwd, expected] of [[main, "Subject\n"], [linked, "Subject\nCo-Authored-By: Claude <noreply@anthropic.com>\n"]]) {
    const message = path.join(cwd, "message");
    await fs.writeFile(message, "Subject\nCo-Authored-By: Claude <noreply@anthropic.com>\n");
    const result = spawnSync(process.execPath, [hook, message], { cwd, stdio: "inherit" });
    assert.equal(result.status, 0, contract);
    assert.equal(await fs.readFile(message, "utf8"), expected, contract);
  }
});
