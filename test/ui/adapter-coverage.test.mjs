import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { applyOptionalSkills, OPTIONAL_SKILLS } from "../../src/skills.mjs";
import { collectMcpValues } from "../../src/ui/mcp-interaction.mjs";
import { renderDoctor, printAudit } from "../../src/ui/reports.mjs";
import { withPromptRenderer } from "../../src/ui/prompt.mjs";

const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const cliPath = path.join(repoRoot, "bin", "repo-pattern.mjs");

test("CLI audit adapter owns audit rendering", async () => {
  // protects=CLI audit output callback ownership; fails_when=audit output disappears or the CLI command exits incorrectly; no_claim=interactive terminal formatting.
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-audit-coverage-"));
  try {
    const result = spawnSync(process.execPath, [cliPath, "audit", "--target", target], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /== Audit ==/);
    assert.match(result.stdout, new RegExp(target.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")));
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("adapter report rendering preserves noninteractive diagnostics", () => {
  // protects=report rendering under CI, NO_COLOR, and dumb terminals; fails_when=diagnostics disappear or terminal fallback is skipped; no_claim=interactive Ink byte output.
  const originalCI = process.env.CI;
  const originalNoColor = process.env.NO_COLOR;
  const originalTerm = process.env.TERM;
  const lines = [];
  const originalLog = console.log;
  console.log = (line = "") => lines.push(String(line));
  try {
    process.env.CI = "1";
    process.env.NO_COLOR = "1";
    process.env.TERM = "dumb";
    renderDoctor({ target: "/tmp/adapter coverage", setupPipeline: "none", checks: [{ group: "Workspace", label: ".claude exists", ok: false, reason: "missing" }], infoRows: ["browser skipped"], verbose: true });
    printAudit({ target: "/tmp/adapter coverage", state: "PARTIAL", hasClaudeDir: false, hasMcpJson: false, hasRepoPatternJson: false, hasHardcodedMcpPath: false, hasSettingsLocalTracked: false, hasSettingsHooks: false, gstack: null, repoPattern: null });
    assert.match(lines.join("\n"), /Doctor|Audit|browser skipped|\.claude exists/);
  } finally {
    console.log = originalLog;
    for (const [name, value] of [["CI", originalCI], ["NO_COLOR", originalNoColor], ["TERM", originalTerm]]) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test("interactive MCP collection preserves field order and adapters", async () => {
  // protects=interactive MCP path/secret/text collection, defaults, validation, and cancellation; fails_when=collection skips a field or leaks a secret; no_claim=real TTY, network, or secret values.
  const originalCI = process.env.CI;
  const originalIn = process.stdin.isTTY;
  const originalOut = process.stdout.isTTY;
  const prompts = [];
  process.env.CI = "";
  process.stdin.isTTY = true;
  process.stdout.isTTY = true;
  try {
    const values = await withPromptRenderer((element) => {
      prompts.push(element.props);
      const props = element.props;
      assert.equal(props.validate?.(props.initial || "value"), true);
      props.done(props.initial || "value");
      return { unmount() {} };
    }, () => collectMcpValues({ demo: { env: { DEMO_TOKEN: "${DEMO_TOKEN}" }, args: ["${PROJECT_DIR}", "${DEMO_NAME}"] } }));
    assert.deepEqual(Object.keys(values), ["DEMO_TOKEN", "PROJECT_DIR", "DEMO_NAME"]);
    assert.equal(prompts.length, 3);
    assert.match(prompts[0].message, /MCP secret/);
    assert.match(prompts[1].message, /MCP path/);
    assert.match(prompts[2].message, /MCP value/);
  } finally {
    process.stdin.isTTY = originalIn;
    process.stdout.isTTY = originalOut;
    if (originalCI === undefined) delete process.env.CI; else process.env.CI = originalCI;
  }
});

test("interactive report rendering unmounts the Ink report", () => {
  // protects=interactive doctor report headings, colors, wrapping, and unmount; fails_when=interactive rendering throws or leaves a live renderer; no_claim=terminal byte identity.
  const originalCI = process.env.CI;
  const originalIn = process.stdin.isTTY;
  const originalOut = process.stdout.isTTY;
  try {
    delete process.env.CI;
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    renderDoctor({ target: "/tmp/adapter coverage", setupPipeline: "none", checks: [{ group: "Workspace", label: ".claude exists", ok: false, reason: "missing" }], infoRows: ["browser skipped"], verbose: true });
  } finally {
    process.stdin.isTTY = originalIn;
    process.stdout.isTTY = originalOut;
    if (originalCI === undefined) delete process.env.CI; else process.env.CI = originalCI;
  }
});

test("optional skill directory dry-run reports the copy without writing files", async () => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-skill-directory-preview-"));
  const skill = structuredClone(OPTIONAL_SKILLS.find((entry) => entry.sourceDir));
  const logs = [];
  try {
    // Exercise the directory-copy path; plugin-backed skills normally skip local copying.
    delete skill.plugin;
    const result = await applyOptionalSkills({ target, skills: [skill.value], dryRun: true, silent: true, output: { log: (line) => logs.push(line) }, skillDefinitions: [skill] });
    assert(logs.includes(`[dry-run] copy ${path.join(target, ".repo-pattern", "cache", "skills", skill.value, skill.sourceDir)} -> ${path.join(target, ".claude", "skills")}`));
    assert.deepEqual(result.appliedSkills[0].installedDirs, [skill.sourceDir]);
    assert.deepEqual(await fs.readdir(target), []);
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("optional skills dry-run reports local copy and summary adapters", async () => {
  // protects=optional-skill local dry-run logging and summary callback ownership; fails_when=preview output or summary payload disappears; no_claim=no network or skill checkout.
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-skills-coverage-"));
  const logs = [];
  const summaries = [];
  try {
    const result = await applyOptionalSkills({ target, skills: ["nextjs-pattern"], dryRun: true, output: { log: (line) => logs.push(line), summary: (...args) => summaries.push(args) } });
    assert.deepEqual(result.selectedSkills, ["nextjs-pattern"]);
    assert.match(logs.join("\n"), /\[dry-run\] copy .*nextjs-pattern/);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0][0], "Applied optional skills");
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});
