import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installGstackRuntimeFixture } from "./fixtures.mjs";
import { GSTACK_REVIEW_SIDECARS, gstackCheckoutPath, gstackStatePath, setupGstack } from "../lib/gstack.mjs";

const hashes = {
  "careful/bin/check-careful.sh": "23dc8fa32afa75ac44a93328157d2e9afc8a286eb41cccfdd6340bbfd72bfed2",
  "careful/bin/hook-extract.sh": "5be66386d4945f27ba52ac3df720a8f84755634de1713eacbd239376050106c9",
  "freeze/bin/check-freeze.sh": "97e6013a990911ef544e4e80fc464560286e298d85ffbdf391b860e9910376f4",
  "bin/gstack-paths": "42365c4cd5f0042e2d7c86a929252d18e051884a5abc125c2a8893c1ae636060"
};

export async function runGstackPinnedSafetyChecks() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-pinned 'safety-"));
  const target = path.join(root, "project with spaces 'and quotes'");
  const home = path.join(root, "home");
  const originalHome = process.env.HOME;
  try {
    await fs.mkdir(home);
    process.env.HOME = home;
    const checkout = gstackCheckoutPath(target);
    const statePath = gstackStatePath(target);
    await fs.mkdir(checkout, { recursive: true });
    await fs.cp(new URL("./fixtures/gstack-safety/", import.meta.url), checkout, { recursive: true });
    for (const [relative, hash] of Object.entries(hashes)) {
      assert.equal(createHash("sha256").update(await fs.readFile(path.join(checkout, relative))).digest("hex"), hash);
    }
    await fs.chmod(path.join(checkout, "bin/gstack-paths"), 0o755);
    await fs.writeFile(path.join(checkout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
    await fs.writeFile(path.join(checkout, "SKILL.md"), "Fixture root\n");
    await fs.appendFile(path.join(checkout, "freeze/SKILL.md"), '\neval "$(~/.claude/skills/gstack/bin/gstack-paths)"\n');
    for (const sidecar of GSTACK_REVIEW_SIDECARS) {
      await fs.mkdir(path.dirname(path.join(checkout, sidecar)), { recursive: true });
      await fs.writeFile(path.join(checkout, sidecar), `Fixture ${sidecar}`);
    }
    await installGstackRuntimeFixture(checkout);
    await fs.writeFile(path.join(checkout, ".gitignore"), "node_modules/\n.repo-pattern-runtime/\n*/dist/\nbun.lock\n");
    assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: checkout }).status, 0);
    assert.equal(spawnSync("git", ["add", "."], { cwd: checkout }).status, 0);
    assert.equal(spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Pinned fixture baseline"], { cwd: checkout }).status, 0);
    const installed = await setupGstack({ target, silent: true });
    assert.equal(installed.status, "installed", installed.error);
    const unmanaged = path.join(root, "unmanaged");
    await fs.mkdir(unmanaged);
    const rejectedUpgrade = spawnSync(process.execPath, [new URL("../repo-pattern.mjs", import.meta.url).pathname, "upgrade-gstack", "--target", unmanaged, "--dry-run"], { env: { ...process.env, HOME: home }, encoding: "utf8" });
    assert.equal(rejectedUpgrade.status, 1, rejectedUpgrade.stderr);
    assert.match(rejectedUpgrade.stderr, /repo-pattern-managed gstack installation is required/);
    assert.deepEqual(await fs.readdir(unmanaged), []);
    const beforeUpgrade = await fs.readFile(path.join(target, ".claude/skills/careful/SKILL.md"), "utf8");
    const upgradePreview = spawnSync(process.execPath, [new URL("../repo-pattern.mjs", import.meta.url).pathname, "upgrade-gstack", "--target", target, "--dry-run"], { env: { ...process.env, HOME: home }, encoding: "utf8" });
    assert.equal(upgradePreview.status, 0, upgradePreview.stderr);
    assert.equal(await fs.readFile(path.join(target, ".claude/skills/careful/SKILL.md"), "utf8"), beforeUpgrade);
    const settingsFile = path.join(target, ".claude/settings.json");
    const originalSettings = await fs.readFile(settingsFile, "utf8");
    await fs.writeFile(settingsFile, "{");
    const invalidSettingsUpgrade = spawnSync(process.execPath, [new URL("../repo-pattern.mjs", import.meta.url).pathname, "upgrade-gstack", "--target", target, "--dry-run"], { env: { ...process.env, HOME: home }, encoding: "utf8" });
    assert.equal(invalidSettingsUpgrade.status, 1, invalidSettingsUpgrade.stderr);
    assert.ok(invalidSettingsUpgrade.stderr.trim());
    assert.equal(await fs.readFile(settingsFile, "utf8"), "{");
    assert.equal(await fs.readFile(path.join(target, ".claude/skills/careful/SKILL.md"), "utf8"), beforeUpgrade);
    await fs.writeFile(settingsFile, originalSettings);
    await fs.writeFile(path.join(checkout, "local-note.txt"), "preserve local edits");
    const dirtyUpgrade = spawnSync(process.execPath, [new URL("../repo-pattern.mjs", import.meta.url).pathname, "upgrade-gstack", "--target", target, "--dry-run"], { env: { ...process.env, HOME: home }, encoding: "utf8" });
    assert.equal(dirtyUpgrade.status, 1, dirtyUpgrade.stderr);
    assert.match(dirtyUpgrade.stderr, /Git checkout operation failed/);
    assert.equal(await fs.readFile(path.join(checkout, "local-note.txt"), "utf8"), "preserve local edits");
    assert.equal(await fs.readFile(path.join(target, ".claude/skills/careful/SKILL.md"), "utf8"), beforeUpgrade);
    const boundary = path.join(target, "allowed dir 'quoted'");
    const outside = path.join(target, "outside.txt");
    await fs.mkdir(boundary);
    await fs.writeFile(outside, "unchanged");
    await fs.writeFile(path.join(statePath, "freeze-dir.txt"), `${boundary}\n`);
    const baselineState = path.join(root, "baseline");
    await fs.mkdir(baselineState);
    await fs.writeFile(path.join(baselineState, "freeze-dir.txt"), `${boundary}\n`);
    const env = { ...process.env, HOME: home };
    delete env.GSTACK_HOME;
    const execute = (args, payload, environment = env) => {
      const result = spawnSync(args[0], args.slice(1), { cwd: target, env: environment, input: JSON.stringify(payload), encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    let count = 0;
    let freezeWrapper;
    for (const [skill, tools] of [["careful", ["Bash"]], ["guard", ["Bash", "Edit", "Write"]], ["freeze", ["Edit", "Write"]]]) {
      const content = await fs.readFile(path.join(target, ".claude/skills", skill, "SKILL.md"), "utf8");
      if (skill === "freeze") freezeWrapper = content;
      const commands = [...content.matchAll(/^\s*command: (.+)$/gm)].map((match) => JSON.parse(match[1]));
      assert.equal(commands.length, tools.length);
      for (const [index, command] of commands.entries()) {
        const tool = tools[index];
        const cases = tool === "Bash"
          ? [["printf '%s' 'safe'", "allow"], ["rm -rf ./dangerous-output", "ask"], ["rm -rf /", "deny"]]
          : [[path.join(boundary, "new file.txt"), "allow"], [outside, "deny"]];
        for (const [value, expected] of cases) {
          const payload = { tool_name: tool, tool_input: { [tool === "Bash" ? "command" : "file_path"]: value } };
          const generated = execute(["/bin/sh", "-c", command], payload);
          const hook = tool === "Bash" ? "careful" : "freeze";
          const baseline = execute(["bash", path.join(checkout, hook, "bin", `check-${hook}.sh`)], payload, { ...env, GSTACK_HOME: baselineState });
          assert.deepEqual(generated, baseline);
          assert.equal(generated.hookSpecificOutput?.permissionDecision ?? "allow", expected);
        }
        count++;
      }
    }
    assert.equal(count, 6);
    const writerCommand = freezeWrapper.match(/^eval "\$\((.+)\)"$/m)?.[1];
    assert.ok(writerCommand);
    const writer = spawnSync("bash", ["-c", `eval "$( ${writerCommand} )"; printf '%s' "$GSTACK_STATE_ROOT"`], { cwd: target, env, encoding: "utf8" });
    assert.equal(writer.status, 0, writer.stderr);
    assert.equal(writer.stdout, statePath);
    assert.equal(await fs.readFile(outside, "utf8"), "unchanged");
    assert.deepEqual(await fs.readdir(home), []);
    const settings = JSON.parse(await fs.readFile(path.join(target, ".claude/settings.json"), "utf8"));
    assert.deepEqual(settings.hooks || {}, {});
  } finally {
    process.env.HOME = originalHome;
    await fs.rm(root, { recursive: true, force: true });
  }
}
