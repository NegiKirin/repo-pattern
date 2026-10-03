import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { provisionProject } from "../lib/provision.mjs";
import { OPTIONAL_SKILLS } from "../lib/skills.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export async function runHerdrChecks() {
  const { applyHerdrHook, installHerdrIntegration, HERDR_COMMAND } = await import("../lib/herdr.mjs");
  const other = { matcher: "startup", hooks: [{ type: "command", command: "keep-me" }] };
  const input = { custom: { kept: true }, hooks: { SessionStart: [other], Stop: [other] } };
  const merged = applyHerdrHook(input);
  assert.deepEqual(input.hooks.SessionStart, [other]);
  assert.deepEqual(merged.custom, input.custom);
  assert.deepEqual(merged.hooks.Stop, [other]);
  assert.deepEqual(merged.hooks.SessionStart[0], other);
  assert.equal(merged.hooks.SessionStart.length, 2);
  assert.deepEqual(applyHerdrHook(merged), merged);
  const duplicate = { hooks: [{ type: "command", command: HERDR_COMMAND }, { type: "command", command: "keep-me" }] };
  const deduped = applyHerdrHook({ ...input, hooks: { ...input.hooks, SessionStart: [other, duplicate, duplicate] } });
  assert.equal(deduped.hooks.SessionStart.flatMap((entry) => entry.hooks).filter((hook) => hook.command === HERDR_COMMAND).length, 1);
  assert.equal(deduped.hooks.SessionStart.flatMap((entry) => entry.hooks).filter((hook) => hook.command === "keep-me").length, 3);
  assert.match(HERDR_COMMAND, /\$CLAUDE_PROJECT_DIR/);
  assert.doesNotMatch(HERDR_COMMAND, /HOME|\/home\//);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rp-herdr-"));
  const oldHome = process.env.HOME;
  const oldLog = console.log;
  const skill = OPTIONAL_SKILLS.find((entry) => entry.value === "herdr");
  const oldRevision = skill.revision;
  try {
    const home = path.join(root, "home");
    await fs.mkdir(path.join(home, ".claude"), { recursive: true });
    const homeSettings = '{"hooks":{"SessionStart":[{"hooks":[{"command":"global-sentinel"}]}]},"custom":true}\n';
    await fs.writeFile(path.join(home, ".claude", "settings.json"), homeSettings);
    process.env.HOME = home;
    console.log = () => {};
    const target = path.join(root, "selected project");
    const cache = path.join(target, ".repo-pattern", "cache", "skills", "herdr");
    await fs.mkdir(cache, { recursive: true });
    await fs.writeFile(path.join(cache, "SKILL.md"), "fixture skill\n");
    const git = (args) => {
      const result = spawnSync("git", args, { cwd: cache, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git(["init"]);
    git(["add", "."]);
    git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture"]);
    skill.revision = git(["rev-parse", "HEAD"]);
    git(["remote", "add", "origin", cache]);
    await fs.mkdir(path.join(target, ".claude"));
    await fs.writeFile(path.join(target, ".claude", "settings.json"), JSON.stringify({ custom: true }));
    await provisionProject({ sourceRoot: repoRoot, target, setupPipeline: "none", optionalSkills: ["herdr"], mcpServers: [] });
    const script = path.join(target, ".claude", "hooks", "herdr-agent-state.sh");
    assert.equal(await fs.readFile(script, "utf8"), await fs.readFile(path.join(repoRoot, "scripts", "vendor", "herdr", "herdr-agent-state.sh"), "utf8"));
    await fs.access(path.join(target, ".claude", "skills", "herdr", "SKILL.md"));
    const settingsFile = path.join(target, ".claude", "settings.json");
    const settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
    assert.equal(settings.custom, true);
    assert.equal(settings.hooks.SessionStart.length, 1);
    await installHerdrIntegration({ target });
    assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, "utf8")), settings);

    const without = path.join(root, "without");
    await fs.mkdir(without);
    await provisionProject({ sourceRoot: repoRoot, target: without, setupPipeline: "none", mcpServers: [] });
    await assert.rejects(fs.access(path.join(without, ".claude", "hooks", "herdr-agent-state.sh")), { code: "ENOENT" });
    assert.equal(JSON.parse(await fs.readFile(path.join(without, ".claude", "settings.json"), "utf8")).hooks.SessionStart, undefined);
    const preview = path.join(root, "preview");
    await fs.mkdir(preview);
    const logs = [];
    console.log = (...args) => logs.push(args.join(" "));
    await provisionProject({ sourceRoot: repoRoot, target: preview, setupPipeline: "none", optionalSkills: ["herdr"], dryRun: true, mcpServers: [] });
    assert.deepEqual(await fs.readdir(preview), []);
    assert.match(logs.join("\n"), /herdr-agent-state\.sh/);
    assert.match(logs.join("\n"), /SessionStart/);
    assert.equal(await fs.readFile(path.join(home, ".claude", "settings.json"), "utf8"), homeSettings);
    assert.deepEqual(await fs.readdir(home), [".claude"]);
    assert.deepEqual(await fs.readdir(path.join(home, ".claude")), ["settings.json"]);

    const socketPath = path.join(root, "socket");
    const messages = [];
    const server = net.createServer((client) => {
      let data = "";
      client.on("data", (chunk) => {
        data += chunk;
        if (data.includes("\n")) {
          messages.push(JSON.parse(data.trim()));
          client.end('{}\n');
        }
      });
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
    const run = (input, env = {}) => new Promise((resolve, reject) => {
      const child = spawn("sh", [script, "session"], { env: { PATH: process.env.PATH, HOME: home, HERDR_ENV: "1", HERDR_SOCKET_PATH: socketPath, HERDR_PANE_ID: "pane-test", ...env }, stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => { try { assert.equal(code, 0, stderr); resolve(); } catch (error) { reject(error); } });
      child.stdin.end(JSON.stringify(input));
    });
    try {
      const payload = { hook_event_name: "SessionStart", session_id: "session-test", source: "startup", transcript_path: "/tmp/transcript" };
      await run(payload);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].method, "pane.report_agent_session");
      assert.equal(messages[0].params.agent_session_id, "session-test");
      assert.equal(messages[0].params.pane_id, "pane-test");
      assert.equal(messages[0].params.agent, "claude");
      await run(payload, { HERDR_ENV: "0" });
      await run({ ...payload, agent_id: "subagent" });
      await run(payload, { HERDR_SOCKET_PATH: path.join(root, "missing") });
      await run(payload, { PATH: "/bin", CURSOR_VERSION: "test" });
      assert.equal(messages.length, 1);
      const commandResult = spawnSync("sh", ["-c", HERDR_COMMAND], { input: JSON.stringify(payload), env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: target, HOME: home }, encoding: "utf8" });
      assert.equal(commandResult.status, 0, commandResult.stderr);
      await new Promise((resolve, reject) => {
        const child = spawn("sh", ["-c", HERDR_COMMAND], {
          env: { PATH: process.env.PATH, HOME: home, CLAUDE_PROJECT_DIR: target, HERDR_ENV: "1", HERDR_SOCKET_PATH: socketPath, HERDR_PANE_ID: "pane-command" },
          stdio: ["pipe", "pipe", "pipe"]
        });
        child.on("error", reject);
        child.on("close", (code) => { try { assert.equal(code, 0); resolve(); } catch (error) { reject(error); } });
        child.stdin.end(JSON.stringify(payload));
      });
      assert.equal(messages.length, 2);
      assert.equal(messages[1].method, "pane.report_agent_session");
      assert.equal(messages[1].params.pane_id, "pane-command");
      assert.equal(messages[1].params.agent_session_id, "session-test");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    skill.revision = oldRevision;
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    console.log = oldLog;
    await fs.rm(root, { recursive: true, force: true });
  }
}
