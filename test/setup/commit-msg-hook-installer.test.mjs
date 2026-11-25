import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installCommitMsgHook, resolveEffectiveHooks, COMMIT_MSG_MARKER, ORIGINAL_HOOK_MARKER } from "../../src/setup/commit-msg-hook.mjs";

const contract = "protects=effective Git hooks ownership and existing-hook preservation; fails_when=unsafe paths or unknown arrangements are overwritten; no_claim=all third-party hook-manager formats";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-installer-"));
  await fs.mkdir(path.join(root, ".git", "hooks"), { recursive: true });
  await fs.writeFile(path.join(root, ".git", "config"), "[core]\n\trepositoryformatversion = 0\n\tbare = false\n");
  await import("node:child_process").then(({ execFileSync }) => execFileSync("git", ["init", "-q"], { cwd: root }));
  return root;
}

test("resolves standard, relative, and spaced hooks paths", async () => {
  // protects=Git-discovered effective hook path; fails_when=caller cwd or spaces select wrong path; no_claim=linked-worktree runtime composition
  const root = await fixture();
  const result = await resolveEffectiveHooks({ target: root });
  assert.equal(result.status, "ready", contract);
  assert.equal(path.basename(result.hooksDir), "hooks", contract);

  const relative = path.join(root, "hooks with spaces");
  await fs.mkdir(relative);
  const config = await fs.readFile(path.join(root, ".git", "config"), "utf8");
  await fs.writeFile(path.join(root, ".git", "config"), `${config}[core]\n\thooksPath = hooks with spaces\n`);
  const relativeResult = await resolveEffectiveHooks({ target: root });
  assert.equal(relativeResult.status, "ready", contract);
  assert.equal(relativeResult.hooksDir, relative, contract);
});

test("skips non-Git targets and refuses unproven hooks paths", async () => {
  // protects=non-Git skip and administrative boundary; fails_when=installer initializes or writes outside ownership; no_claim=global Git configuration
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-nongit-"));
  assert.deepEqual(await resolveEffectiveHooks({ target: root }), { status: "skipped", reason: "target is not a Git worktree" }, contract);
  const external = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-external-"));
  const fake = await fixture();
  const result = await resolveEffectiveHooks({ target: fake, gitRunner: (target, args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return fake;
    if (args[1] === "--git-path") return external;
    if (args[1] === "--git-common-dir") return path.join(fake, ".git");
    return null;
  }});
  assert.equal(result.status, "conflict", contract);
});

test("dry-run does not create an absent hooks directory", async () => {
  // protects=dry-run side-effect freedom; fails_when=hooks directory or files are created; no_claim=setup transaction rollback
  const root = await fixture();
  const hooksDir = path.join(root, ".git", "new-hooks");
  await fs.writeFile(path.join(root, ".git", "config"), "[core]\n\thooksPath = new-hooks\n");
  const result = await installCommitMsgHook({ target: root, sourceRoot: path.resolve("."), dryRun: true });
  assert.equal(result.status, "dry-run", contract);
  await assert.rejects(() => fs.stat(hooksDir), { code: "ENOENT" }, contract);
});

test("installs and reruns without nesting managed pairs", async () => {
  // protects=marker ownership and idempotence; fails_when=backup duplicates or wrapper nesting occurs; no_claim=setup integration
  const root = await fixture();
  const sourceRoot = path.resolve(".");
  const first = await installCommitMsgHook({ target: root, sourceRoot });
  assert.equal(first.status, "installed", contract);
  const wrapper = await fs.readFile(path.join(root, ".git", "hooks", "commit-msg"), "utf8");
  assert.match(wrapper, new RegExp(COMMIT_MSG_MARKER), contract);
  const second = await installCommitMsgHook({ target: root, sourceRoot });
  assert.equal(second.status, "managed", contract);
  assert.equal((await fs.readdir(path.join(root, ".git", "hooks"))).filter((name) => name.includes("repo-pattern-original")).length, 1, contract);
  assert.equal(ORIGINAL_HOOK_MARKER.startsWith("# repo-pattern:"), true, contract);
});

test("preserves nonexecutable hooks and unknown backups", async () => {
  // protects=conflict preservation; fails_when=nonexecutable or unknown hook state is changed; no_claim=hook manager interoperability
  const root = await fixture();
  const hook = path.join(root, ".git", "hooks", "commit-msg");
  await fs.writeFile(hook, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
  const sourceRoot = path.resolve(".");
  const result = await installCommitMsgHook({ target: root, sourceRoot });
  assert.equal(result.status, "conflict", contract);
  assert.equal((await fs.stat(hook)).mode & 0o111, 0, contract);
  await fs.writeFile(path.join(root, ".git", "hooks", "commit-msg.repo-pattern-original"), "unknown");
  assert.equal((await installCommitMsgHook({ target: root, sourceRoot })).status, "conflict", contract);
});

test("refuses mutated managed wrapper and backup", async () => {
  // protects=managed-pair ownership fingerprints; fails_when=marker-preserving mutation is accepted or overwritten; no_claim=recovery automation
  for (const file of ["commit-msg", "commit-msg.repo-pattern-original"]) {
    const root = await fixture();
    const sourceRoot = path.resolve(".");
    await installCommitMsgHook({ target: root, sourceRoot });
    const target = path.join(root, ".git", "hooks", file);
    const before = await fs.readFile(target);
    await fs.writeFile(target, Buffer.concat([before, Buffer.from("mutation")]))
    const result = await installCommitMsgHook({ target: root, sourceRoot });
    assert.equal(result.status, "conflict", contract);
    assert.deepEqual(await fs.readFile(target), Buffer.concat([before, Buffer.from("mutation")]), contract);
  }
});
