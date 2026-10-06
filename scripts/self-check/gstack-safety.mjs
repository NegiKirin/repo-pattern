import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installGstackRuntimeFixture } from "./fixtures.mjs";
import { GSTACK_REVIEW_SIDECARS, gstackCheckoutPath, resolveGstackCheckout, setupGstack, validateProjectGstack } from "../lib/gstack.mjs";

export async function runGstackSafetyChecks() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-gstack-safety-"));
  const originalHome = process.env.HOME;
  try {
    const home = path.join(root, "home");
    await fs.mkdir(home);
    process.env.HOME = home;
    const invalidTarget = path.join(root, "invalid");
    const invalidCheckout = gstackCheckoutPath(invalidTarget);
    await fs.mkdir(invalidCheckout, { recursive: true });
    await fs.writeFile(path.join(invalidCheckout, "user-note"), "preserve");
    await assert.rejects(resolveGstackCheckout({ target: invalidTarget, silent: true }), /Existing gstack checkout is invalid/);
    assert.equal(await fs.readFile(path.join(invalidCheckout, "user-note"), "utf8"), "preserve");
    for (const name of ["project", "project with spaces", "project's checkout", "upstream single quoted"]) {
      const target = path.join(root, name);
      const checkout = gstackCheckoutPath(target);
      await fs.mkdir(checkout, { recursive: true });
      await fs.writeFile(path.join(checkout, "setup"), "#!/bin/sh\n", { mode: 0o755 });
      await fs.writeFile(path.join(checkout, "SKILL.md"), "Project-local gstack\n");
      for (const sidecar of GSTACK_REVIEW_SIDECARS) {
        await fs.mkdir(path.dirname(path.join(checkout, sidecar)), { recursive: true });
        await fs.writeFile(path.join(checkout, sidecar), `Fixture ${sidecar}`);
      }
      await fs.mkdir(path.join(checkout, "scripts"));
      for (const skill of ["careful", "freeze"]) {
        await fs.mkdir(path.join(checkout, skill, "bin"), { recursive: true });
        for (const directory of ["scripts", `${skill}/bin`]) {
          await fs.writeFile(path.join(checkout, directory, `check-${skill}.sh`), "#!/bin/sh\nprintf 'fixture executed'\n", { mode: 0o755 });
        }
      }
      await fs.writeFile(path.join(checkout, "careful", "bin", "hook-extract.sh"), "#!/bin/bash\ngstack_hook_extract_field() { :; }\ngstack_hook_decision() { :; }\ngstack_hook_json_string() { :; }\ngstack_hook_state_root() { :; }\ngstack_hook_log_fire() { :; }\n");
      for (const [skill, tools] of [["careful", ["Bash"]], ["guard", ["Bash", "Edit", "Write"]], ["freeze", ["Edit", "Write"]]]) {
        await fs.mkdir(path.join(checkout, skill), { recursive: true });
        const declarations = tools.map((tool) => {
          const hook = tool === "Bash" ? "careful" : "freeze";
          const command = name === "project" ? `~/.claude/skills/gstack/scripts/check-${hook}.sh` : `bash $HOME/.claude/skills/gstack/${hook}/bin/check-${hook}.sh`;
          const declaration = name === "upstream single quoted"
            ? String.raw`'bash -c "exec bash \"$HOME/.claude/skills/gstack/${hook}/bin/check-${hook}.sh\""'`
            : `"${command}"`;
          return `    - matcher: "${tool}"\n      hooks:\n        - type: command\n          command: ${declaration}`;
        }).join("\n");
        await fs.writeFile(path.join(checkout, skill, "SKILL.md"), `---\nname: ${skill}\nhooks:\n  PreToolUse:\n${declarations}\n---\nFixture skill body\n`);
      }
      await fs.mkdir(path.join(checkout, "gstack-upgrade"));
      await fs.writeFile(path.join(checkout, "gstack-upgrade", "SKILL.md"), "---\nname: gstack-upgrade\n---\nUpstream upgrade body\n");
      await installGstackRuntimeFixture(checkout);
      await fs.writeFile(path.join(checkout, ".gitignore"), "node_modules/\n.repo-pattern-runtime/\n*/dist/\nbun.lock\n");
      assert.equal(spawnSync("git", ["init"], { cwd: checkout, stdio: "ignore" }).status, 0);
      assert.equal(spawnSync("git", ["add", "."], { cwd: checkout, stdio: "ignore" }).status, 0);
      assert.equal(spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Fixture baseline"], { cwd: checkout, stdio: "ignore" }).status, 0);
      const projectManifest = JSON.stringify({ private: true, workspaces: [".claude/skills/**"], dependencies: { "must-not-install": "file:missing" } });
      await fs.writeFile(path.join(target, "package.json"), projectManifest);
      await fs.writeFile(path.join(target, "bun.lock"), "preserve project lockfile\n");
      const result = await setupGstack({ target, silent: true });
      assert.equal(result.status, "installed", result.error);
      assert.equal(await fs.readFile(path.join(target, "package.json"), "utf8"), projectManifest);
      assert.equal(await fs.readFile(path.join(target, "bun.lock"), "utf8"), "preserve project lockfile\n");
      await assert.rejects(fs.lstat(path.join(target, "node_modules")), { code: "ENOENT" });
      assert(!(await fs.readdir(path.dirname(checkout))).some((entry) => entry.startsWith(".gstack-")));
      const upgradeSkill = await fs.readFile(path.join(target, ".claude", "skills", "gstack-upgrade", "SKILL.md"), "utf8");
      assert.match(upgradeSkill, /repo-pattern upgrade-gstack --target/);
      assert.doesNotMatch(upgradeSkill, /Upstream upgrade body/);
      const upgradeCommand = upgradeSkill.match(/^repo-pattern upgrade-gstack --target .+$/m)?.[0];
      const commandArguments = spawnSync("bash", ["-c", `repo-pattern() { printf '%s' "$3"; }; ${upgradeCommand}`], { encoding: "utf8" });
      assert.equal(commandArguments.status, 0, commandArguments.stderr);
      assert.equal(commandArguments.stdout, target);
      assert.equal(await fs.readFile(path.join(checkout, "gstack-upgrade", "SKILL.md"), "utf8"), "---\nname: gstack-upgrade\n---\nUpstream upgrade body\n");
      let count = 0;
      for (const skill of ["careful", "guard", "freeze"]) {
        const file = path.join(target, ".claude", "skills", skill, "SKILL.md");
        const content = await fs.readFile(file, "utf8");
        for (const match of content.matchAll(/command: (.+)/g)) {
          const command = JSON.parse(match[1]);
          const execution = spawnSync("/bin/sh", ["-c", command], { cwd: target, env: { ...process.env, HOME: home }, encoding: "utf8" });
          assert.equal(execution.status, 0, `${skill}: ${execution.stderr}`);
          assert.equal(execution.stdout, "fixture executed");
          count++;
        }
      }
      assert.equal(count, 6);
      const repairSkill = path.join(checkout, "repair");
      await fs.appendFile(path.join(checkout, ".gitignore"), "repair/\n");
      assert.equal(spawnSync("git", ["add", ".gitignore"], { cwd: checkout }).status, 0);
      assert.equal(spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Ignore repair fixture"], { cwd: checkout }).status, 0);
      await fs.mkdir(path.join(repairSkill, "sections"), { recursive: true });
      await fs.writeFile(path.join(repairSkill, "SKILL.md"), "```bash\ncat ~/.claude/skills/gstack/repair/sections/check.md\n```\n");
      await fs.writeFile(path.join(repairSkill, "sections", "check.md"), "```bash\ncat ~/.claude/skills/gstack/repair/sections/check.md\n```\n");
      assert.equal((await setupGstack({ target, silent: true })).status, "installed");
      for (const relative of ["repair/SKILL.md", "repair/sections/check.md"]) {
        const installedFile = path.join(target, ".claude", "skills", relative);
        await fs.writeFile(installedFile, `\`\`\`bash\ncat ${path.join(checkout, "repair/sections/check.md")}\n\`\`\`\n`);
      }
      assert.equal((await setupGstack({ target, silent: true })).status, "installed");
      assert.match(await fs.readFile(path.join(target, ".claude", "skills", "repair", "SKILL.md"), "utf8"), /export PLAYWRIGHT_BROWSERS_PATH=/);
      const rootSource = path.join(checkout, "SKILL.md");
      await fs.appendFile(rootSource, "User source edit\n");
      const dirtyResult = await setupGstack({ target, silent: true });
      assert.equal(dirtyResult.status, "failed");
      assert.match(await fs.readFile(rootSource, "utf8"), /User source edit/);
      await fs.writeFile(rootSource, "Project-local gstack\n");
      const removedSkills = path.join(root, `removed-skills-${name}`);
      await fs.mkdir(removedSkills);
      for (const skill of ["careful", "guard", "freeze"]) await fs.rename(path.join(checkout, skill), path.join(removedSkills, skill));
      assert.equal((await setupGstack({ target, silent: true })).status, "failed");
      for (const skill of ["careful", "guard", "freeze"]) await fs.rename(path.join(removedSkills, skill), path.join(checkout, skill));
      const sourceSkill = path.join(checkout, "careful", "SKILL.md");
      const validSource = await fs.readFile(sourceSkill, "utf8");
      for (const invalidSource of [validSource.replace("PreToolUse:", "PostToolUse:"), validSource.replace("type: command", "type: prompt")]) {
        await fs.writeFile(sourceSkill, invalidSource);
        assert.equal((await setupGstack({ target, silent: true })).status, "failed");
      }
      await fs.writeFile(sourceSkill, validSource);
      const wrapper = path.join(target, ".claude", "skills", "careful", "SKILL.md");
      const expected = await fs.readFile(wrapper, "utf8");
      assert.equal((await setupGstack({ target, silent: true })).status, "installed");
      assert.equal(await fs.readFile(wrapper, "utf8"), expected);
      await fs.writeFile(wrapper, await fs.readFile(path.join(checkout, "careful", "SKILL.md"), "utf8"));
      const regenerated = await fs.readFile(wrapper, "utf8");
      const snapshot = async () => {
        const files = await fs.readdir(target, { recursive: true });
        return Promise.all(files.sort().map(async (relative) => {
          const file = path.join(target, relative);
          const stat = await fs.lstat(file);
          return [relative, stat.mode, stat.isFile() ? (await fs.readFile(file)).toString("base64") : null];
        }));
      };
      const beforeDryRun = await snapshot();
      assert.equal((await setupGstack({ target, dryRun: true, silent: true })).status, "dry-run");
      assert.deepEqual(await snapshot(), beforeDryRun);
      assert.equal(await fs.readFile(wrapper, "utf8"), regenerated);
      assert.equal((await setupGstack({ target, silent: true })).status, "installed");
      assert.equal(await fs.readFile(wrapper, "utf8"), expected);
      const legacy = (await fs.readFile(path.join(checkout, "careful", "SKILL.md"), "utf8"))
        .replaceAll("~/.claude/skills/gstack", checkout)
        .replaceAll("$HOME/.claude/skills/gstack", checkout);
      await fs.writeFile(wrapper, legacy);
      assert.equal((await setupGstack({ target, silent: true })).status, "installed");
      assert.equal(await fs.readFile(wrapper, "utf8"), expected);
      const dependency = path.join(checkout, name === "project" ? "scripts/check-freeze.sh" : "careful/bin/hook-extract.sh");
      const dependencyContent = await fs.readFile(dependency, "utf8");
      const dependencyMode = (await fs.stat(dependency)).mode;
      await fs.rm(dependency);
      assert.equal((await validateProjectGstack(target)).wrappersValid, false);
      assert.equal((await setupGstack({ target, silent: true })).status, "failed");
      assert.equal(await fs.readFile(wrapper, "utf8"), expected);
      if (name !== "project") {
        await fs.writeFile(dependency, dependencyContent.replace("gstack_hook_state_root", "outdated_state_root"), { mode: dependencyMode });
        assert.equal((await setupGstack({ target, silent: true })).status, "failed");
        assert.equal(await fs.readFile(wrapper, "utf8"), expected);
      }
      await fs.writeFile(dependency, "if then\n", { mode: 0o755 });
      assert.equal((await setupGstack({ target, silent: true })).status, "failed");
      assert.equal(await fs.readFile(wrapper, "utf8"), expected);
      await fs.rm(dependency);
      const linkedDependency = path.join(root, `dependency-${name}`);
      await fs.writeFile(linkedDependency, dependencyContent, { mode: 0o755 });
      await fs.symlink(linkedDependency, dependency);
      assert.equal((await setupGstack({ target, silent: true })).status, "failed");
      assert.equal(await fs.readFile(wrapper, "utf8"), expected);
      await fs.rm(dependency);
      await fs.writeFile(dependency, dependencyContent, { mode: dependencyMode });
      assert.equal((await setupGstack({ target, silent: true })).status, "installed");
      const userFile = path.join(checkout, "user-notes.txt");
      await fs.writeFile(userFile, "Preserve local notes\n");
      let cloneCalled = false;
      await assert.rejects(resolveGstackCheckout({ target, upgrade: true, silent: true, clone: async () => { cloneCalled = true; } }), /checkout has local changes/);
      assert.equal(cloneCalled, false);
      assert.equal(await fs.readFile(userFile, "utf8"), "Preserve local notes\n");
      await fs.rm(userFile);
      const candidate = path.join(root, `candidate-${name}`);
      await fs.cp(checkout, candidate, { recursive: true });
      await fs.appendFile(path.join(candidate, "careful", "SKILL.md"), "Upgraded fixture\n");
      const resolveCheckout = (options) => resolveGstackCheckout({ ...options, clone: (destination) => fs.cp(candidate, destination, { recursive: true }) });
      assert.equal((await setupGstack({ target, upgrade: true, dryRun: true, resolveCheckout, silent: true })).status, "dry-run");
      assert.equal(await fs.readFile(wrapper, "utf8"), expected);
      const upgraded = await setupGstack({ target, upgrade: true, resolveCheckout, silent: true });
      assert.equal(upgraded.status, "installed", upgraded.error);
      const upgradedWrapper = await fs.readFile(wrapper, "utf8");
      assert.match(upgradedWrapper, /Upgraded fixture/);
      assert.equal((await validateProjectGstack(target)).wrappersValid, true);
      await fs.rm(path.join(candidate, path.relative(checkout, dependency)));
      const failedUpgrade = await setupGstack({ target, upgrade: true, resolveCheckout, silent: true });
      assert.equal(failedUpgrade.status, "failed");
      assert.equal(await fs.readFile(wrapper, "utf8"), upgradedWrapper);
      assert.equal(await fs.readFile(dependency, "utf8"), dependencyContent);
      assert.equal((await validateProjectGstack(target)).wrappersValid, true);
      const sidecar = path.join(target, ".claude", "skills", GSTACK_REVIEW_SIDECARS[0]);
      const sidecarContent = await fs.readFile(sidecar, "utf8");
      await fs.writeFile(sidecar, "User-owned sidecar\n");
      const sidecarConflict = await setupGstack({ target, silent: true });
      assert.equal(sidecarConflict.status, "failed");
      assert.match(sidecarConflict.error, /ownership conflict/);
      assert.equal(await fs.readFile(sidecar, "utf8"), "User-owned sidecar\n");
      await fs.writeFile(sidecar, sidecarContent);
      const upgradeWrapper = path.join(target, ".claude", "skills", "gstack-upgrade", "SKILL.md");
      const managedUpgrade = await fs.readFile(upgradeWrapper, "utf8");
      await fs.writeFile(upgradeWrapper, "User-owned upgrade skill\n");
      assert.equal((await setupGstack({ target, silent: true })).status, "failed");
      assert.equal(await fs.readFile(upgradeWrapper, "utf8"), "User-owned upgrade skill\n");
      await fs.writeFile(upgradeWrapper, managedUpgrade);
      const rootWrapper = path.join(target, ".claude", "skills", "_gstack-command", "SKILL.md");
      const managedRoot = await fs.readFile(rootWrapper, "utf8");
      await fs.writeFile(rootWrapper, "User-owned root skill\n");
      const rootConflict = await setupGstack({ target, silent: true });
      assert.equal(rootConflict.status, "failed");
      assert.match(rootConflict.error, /ownership conflict/);
      assert.equal(await fs.readFile(rootWrapper, "utf8"), "User-owned root skill\n");
      await fs.writeFile(rootWrapper, managedRoot);
      const foreign = "User-owned careful skill\n";
      await fs.writeFile(wrapper, foreign);
      const conflict = await setupGstack({ target, silent: true });
      assert.equal(conflict.status, "failed");
      assert.match(conflict.error, /safety skill ownership conflict/);
      assert.equal(await fs.readFile(wrapper, "utf8"), foreign);
      assert.deepEqual(await fs.readdir(home), []);
    }
  } finally {
    process.env.HOME = originalHome;
    await fs.rm(root, { recursive: true, force: true });
  }
}
