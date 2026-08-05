import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { provisionProject } from "../lib/provision.mjs";

function withInteractiveTerminal(callback, { stdinTTY = true, stdoutTTY = true, env = {} } = {}) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalStdinTty = process.stdin.isTTY;
  const originalStdoutTty = process.stdout.isTTY;
  const originalStdinSetRawMode = process.stdin.setRawMode;
  const originalStdoutWrite = process.stdout.write;
  const originalEnv = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  const output = [];
  const warnings = [];

  Object.defineProperties(process.stdin, { isTTY: { value: stdinTTY, configurable: true } });
  Object.defineProperties(process.stdout, { isTTY: { value: stdoutTTY, configurable: true } });
  Object.assign(process.env, env);
  process.stdin.setRawMode = () => {};
  process.stdout.write = (chunk) => {
    output.push(String(chunk));
    return true;
  };
  console.log = (line = "") => output.push(`${line}\n`);
  console.warn = (line = "") => warnings.push(`${line}\n`);

  return callback({ output, warnings }).finally(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    process.stdout.write = originalStdoutWrite;
    process.stdin.setRawMode = originalStdinSetRawMode;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    Object.defineProperties(process.stdin, { isTTY: { value: originalStdinTty, configurable: true } });
    Object.defineProperties(process.stdout, { isTTY: { value: originalStdoutTty, configurable: true } });
  });
}

export async function runInteractiveProvisionChecks(repoRoot) {
  const successTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-interactive-output-"));
  try {
    await withInteractiveTerminal(async ({ output, warnings }) => {
      await provisionProject({
        sourceRoot: repoRoot,
        target: successTarget,
        profile: "backend",
        setupPipeline: "none",
        dryRun: true,
        mcpValues: { CONTEXT7_API_KEY: "interactive-test-key", TAVILY_API_KEY: "interactive-tavily-key" },
        interactiveSetup: true
      });
      const rendered = output.join("");
      const labels = ["ECC & gstack", "Extended skills", "Setup"];
      for (const label of labels) assert.match(rendered, new RegExp(label));
      assert(rendered.indexOf(labels[0]) < rendered.indexOf(labels[1]));
      assert(rendered.indexOf(labels[1]) < rendered.indexOf(labels[2]));
      assert.match(rendered, /ECC & gstack Skipped/);
      assert.match(rendered, /Extended skills Skipped/);
      assert.match(rendered, /Setup preview/);
      assert.match(rendered, /Setup complete/);
      assert.match(rendered, /Status\s+preview only/);
      assert.doesNotMatch(rendered, /Warnings\s+/);
      assert.doesNotMatch(rendered, /Generating workspace|Generating MCP workspace|\[████|%|Provisioning target|== Audit ==|MCP generated|Detected stack|Selected ECC rules|Applied optional skills|Backup created|\[dry-run\]/);
      assert.equal(warnings.length, 0);
    });
    assert.equal((await fs.readdir(successTarget)).length, 0);
  } finally {
    await fs.rm(successTarget, { recursive: true, force: true });
  }

  const pluginTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-interactive-plugin-"));
  try {
    await withInteractiveTerminal(async ({ output }) => {
      await provisionProject({
        sourceRoot: repoRoot,
        target: pluginTarget,
        profile: "backend",
        setupPipeline: "none",
        optionalSkills: ["taste"],
        dryRun: true,
        mcpValues: { CONTEXT7_API_KEY: "interactive-test-key", TAVILY_API_KEY: "interactive-tavily-key" },
        interactiveSetup: true
      });
      const rendered = output.join("");
      assert.match(rendered, /Extended skills completed/);
      assert.match(rendered, /Setup preview/);
      assert.doesNotMatch(rendered, /Syncing taste|Copying taste|%|\[████/);
    });
    assert.equal((await fs.readdir(pluginTarget)).length, 0);
  } finally {
    await fs.rm(pluginTarget, { recursive: true, force: true });
  }

  const parityTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-interactive-parity-"));
  try {
    await withInteractiveTerminal(async ({ output }) => {
      await provisionProject({
        sourceRoot: repoRoot,
        target: parityTarget,
        profile: "backend",
        setupPipeline: "both",
        optionalSkills: ["document-specialist"],
        dryRun: true,
        mcpValues: { CONTEXT7_API_KEY: "interactive-test-key", TAVILY_API_KEY: "interactive-tavily-key" },
        interactiveSetup: true
      });
      const rendered = output.join("");
      for (const label of ["ECC & gstack", "Extended skills", "Setup"]) assert.match(rendered, new RegExp(label));
      assert.match(rendered, /ECC & gstack completed/);
      assert.match(rendered, /Extended skills completed/);
      assert.match(rendered, /Setup preview/);
      assert.match(rendered, /Status\s+preview only/);
      assert.doesNotMatch(rendered, /Backing up workspace|Generating workspace|Generating MCP workspace|Syncing ECC cache|Staging ECC rules and agents|Backing up ECC rules|Backing up local skills|Syncing document-specialist|Copying document-specialist|Downloading gstack|Bootstrapping gstack|Writing gstack hooks|\[████|%|\[dry-run\]|Setup pipeline|Doctor|Applied optional skills/);
    });
    assert.equal((await fs.readdir(parityTarget)).length, 0);
  } finally {
    await fs.rm(parityTarget, { recursive: true, force: true });
  }

  for (const ttyOptions of [
    { stdinTTY: true, stdoutTTY: false },
    { stdinTTY: false, stdoutTTY: true },
    { env: { CI: "true" } }
  ]) {
    const asymmetricTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-interactive-asymmetric-"));
    try {
      await withInteractiveTerminal(async ({ output }) => {
        await provisionProject({
          sourceRoot: repoRoot,
          target: asymmetricTarget,
          profile: "backend",
          setupPipeline: "none",
          dryRun: true,
          mcpValues: { CONTEXT7_API_KEY: "interactive-test-key", TAVILY_API_KEY: "interactive-tavily-key" },
          interactiveSetup: true
        });
        const rendered = output.join("");
        assert.doesNotMatch(rendered, /\x1b\[/);
        if (ttyOptions.env) assert.match(rendered, /Setup 0%/);
      }, ttyOptions);
    } finally {
      await fs.rm(asymmetricTarget, { recursive: true, force: true });
    }
  }

  const completionFailureTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-interactive-completion-failure-"));
  try {
    await withInteractiveTerminal(async ({ output }) => {
      await assert.rejects(
        () => provisionProject({
          sourceRoot: repoRoot,
          target: completionFailureTarget,
          profile: "backend",
          setupPipeline: "none",
          dryRun: true,
          mcpValues: { CONTEXT7_API_KEY: "interactive-test-key", TAVILY_API_KEY: "interactive-tavily-key" },
          interactiveSetup: true,
          onBeforeSuccessSummary: async () => {
            throw new Error("setup status persistence failed");
          }
        }),
        (error) => {
          assert.match(error.message, /setup status persistence failed/);
          assert.match(error.message, /Rollback: not required; setup content was completed\./);
          assert.match(error.message, /Recovery: rerun repo-pattern setup/);
          return true;
        }
      );
      const rendered = output.join("");
      assert.match(rendered, /Setup failed/);
      assert.doesNotMatch(rendered, /Setup complete/);
    });
  } finally {
    await fs.rm(completionFailureTarget, { recursive: true, force: true });
  }

  const warningTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-interactive-warning-"));
  try {
    await withInteractiveTerminal(async ({ output }) => {
      await provisionProject({
        sourceRoot: repoRoot,
        target: warningTarget,
        profile: "backend",
        setupPipeline: "none",
        dryRun: true,
        interactiveSetup: true
      });
      const rendered = output.join("");
      assert.match(rendered, /Warnings\s+MCP values pending: CONTEXT7_API_KEY, TAVILY_API_KEY/);
      assert.doesNotMatch(rendered, /MCP values missing:|\[dry-run\]/);
    });
  } finally {
    await fs.rm(warningTarget, { recursive: true, force: true });
  }

  const gstackFailureTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-interactive-gstack-failure-"));
  try {
    await fs.writeFile(path.join(gstackFailureTarget, "CLAUDE.md"), "existing instructions\n", "utf8");
    await withInteractiveTerminal(async ({ output }) => {
      const originalPath = process.env.PATH;
      process.env.PATH = path.join(gstackFailureTarget, "missing-bin");
      try {
        await assert.rejects(
          () => provisionProject({
            sourceRoot: repoRoot,
            target: gstackFailureTarget,
            profile: "backend",
            setupPipeline: "gstack",
            mcpValues: { CONTEXT7_API_KEY: "interactive-test-key", TAVILY_API_KEY: "interactive-tavily-key" },
            interactiveSetup: true
          }),
          (error) => {
            output.push(`\nERROR: ${error.message}\n`);
            assert.match(error.message, /gstack setup failed/);
            assert.match(error.message, /Bun prerequisite failed/);
            assert.match(error.message, /Rollback: completed\./);
            assert.match(error.message, /Backup: /);
            assert.match(error.message, /Recovery: install Bun v1\.0\+ or fix gstack, then rerun repo-pattern setup/);
            return true;
          }
        );
      } finally {
        process.env.PATH = originalPath;
      }
      const rendered = output.join("");
      assert.match(rendered, /ECC & gstack Downloading gstack failed/);
      assert.match(rendered, /Setup failed/);
      assert.ok(rendered.indexOf("Setup failed") < rendered.indexOf("\nERROR: gstack setup failed"));
      assert.doesNotMatch(rendered, /Setup complete/);
    });
  } finally {
    await fs.rm(gstackFailureTarget, { recursive: true, force: true });
  }

  const failureTarget = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-interactive-failure-"));
  try {
    await fs.writeFile(path.join(failureTarget, "CLAUDE.md"), "existing instructions\n", "utf8");
    await fs.writeFile(path.join(failureTarget, ".gitignore"), "existing-ignore\n", "utf8");
    await fs.mkdir(path.join(failureTarget, ".claude"), { recursive: true });
    await fs.writeFile(path.join(failureTarget, ".claude", "settings.json"), "{\"existing\":true}\n", "utf8");
    await fs.writeFile(path.join(failureTarget, ".claude", "settings.local.json"), "{\"local\":true}\n", "utf8");
    await withInteractiveTerminal(async ({ output }) => {
      await assert.rejects(
        () => provisionProject({
          sourceRoot: repoRoot,
          target: failureTarget,
          profile: "backend",
          setupPipeline: "none",
          interactiveSetup: true,
          optionalSkills: ["nope"]
        }),
        (error) => {
          output.push(`\nERROR: ${error.message}\n`);
          assert.match(error.message, /Unknown optional skill\(s\): nope/);
          assert.match(error.message, /Rollback: completed\./);
          assert.match(error.message, /Backup: /);
          assert.match(error.message, /Recovery: rerun repo-pattern setup/);
          assert.ok(error.message.indexOf("Unknown optional skill(s): nope") < error.message.indexOf("Rollback: completed."));
          assert.ok(error.message.indexOf("Rollback: completed.") < error.message.indexOf("Backup: "));
          assert.ok(error.message.indexOf("Backup: ") < error.message.indexOf("Recovery: rerun"));
          return true;
        }
      );
      const rendered = output.join("");
      assert.match(rendered, /Setup failed/);
      assert.ok(rendered.indexOf("Setup failed") < rendered.indexOf("\nERROR: Unknown optional skill(s): nope"));
      assert.doesNotMatch(rendered, /Setup complete/);
    });
    assert.equal(await fs.readFile(path.join(failureTarget, "CLAUDE.md"), "utf8"), "existing instructions\n");
    assert.equal(await fs.readFile(path.join(failureTarget, ".gitignore"), "utf8"), "existing-ignore\n");
    assert.equal(await fs.readFile(path.join(failureTarget, ".claude", "settings.json"), "utf8"), "{\"existing\":true}\n");
    assert.equal(await fs.readFile(path.join(failureTarget, ".claude", "settings.local.json"), "utf8"), "{\"local\":true}\n");
    for (const relativePath of [".claude/CLAUDE.md", ".mcp.json", ".repo-pattern/.repo-pattern.json", ".repo-pattern/.repo-pattern.lock.json"]) {
      await assert.rejects(() => fs.access(path.join(failureTarget, relativePath)), { code: "ENOENT" });
    }
  } finally {
    await fs.rm(failureTarget, { recursive: true, force: true });
  }
}
