import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const gstackSafetyFixture = path.join(repoRoot, "self-check", "fixtures", "gstack-safety");

export async function installGstackSafetyFixture(checkout) {
  for (const entry of ["careful", "freeze", "guard", "bin/gstack-paths"]) {
    const source = path.join(gstackSafetyFixture, entry);
    const destination = path.join(checkout, entry);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, { recursive: true });
  }
  await fs.chmod(path.join(checkout, "bin", "gstack-paths"), 0o755);
  await installGstackRuntimeFixture(checkout);
}

export async function installGstackRuntimeFixture(checkout) {
  await fs.writeFile(path.join(checkout, "package.json"), JSON.stringify({ type: "module", scripts: { build: "bun fixture-build.mjs" } }));
  await fs.writeFile(path.join(checkout, "fixture-build.mjs"), `import fs from 'node:fs/promises'; import path from 'node:path'; for(const file of ['browse/dist/browse','browse/dist/find-browse','design/dist/design','make-pdf/dist/pdf']) { await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,'#!/usr/bin/env node\\nprocess.exit(0);\\n',{mode:0o755}); } await fs.mkdir('node_modules/playwright',{recursive:true}); await fs.writeFile('node_modules/playwright/package.json',JSON.stringify({type:'module',exports:'./index.mjs'})); await fs.writeFile('node_modules/playwright/index.mjs',"export const chromium={launch:async()=>({newPage:async()=>({goto:async()=>{},textContent:async()=> 'repo-pattern-ready'}),close:async()=>{}})}"); await fs.writeFile('node_modules/playwright/cli.js','');`);
}

export async function installGstackUpstreamSetupFixture(checkout, { failOnHookSymlink = false, failAfterPublish = false } = {}) {
  const nodeExecutable = process.execPath.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
  await fs.mkdir(path.join(checkout, "bin"), { recursive: true });
  await fs.writeFile(path.join(checkout, "setup"), `#!${nodeExecutable}
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const source = path.dirname(fileURLToPath(import.meta.url));
const build = spawnSync("bun", ["run", "build"], { cwd: source, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status || 1);
const args = process.argv.slice(2);
if (!args.includes("--local")) process.exit(8);
const target = process.cwd();
if (${failOnHookSymlink ? "true" : "false"} && (await fs.lstat(path.join(source, "hosts", "claude", "hooks")).catch(() => null))?.isSymbolicLink()) process.exit(9);
const skillsRoot = path.join(target, ".claude", "skills");
const entries = await fs.readdir(source, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory() || entry.name.startsWith(".") || ["node_modules", "codex", "openclaw"].includes(entry.name)) continue;
  const skill = path.join(source, entry.name);
  if (!await fs.access(path.join(skill, "SKILL.md")).then(() => true, () => false)) continue;
  const destination = path.join(skillsRoot, entry.name);
  await fs.cp(skill, destination, { recursive: true, force: true });
  const skillFile = path.join(destination, "SKILL.md");
  if (await fs.access(skillFile).then(() => true, () => false)) {
    const content = await fs.readFile(skillFile, "utf8");
    const rendered = content.replace(/^([ \\t]*command:) (.+)$/gm, (line, prefix, declaration) => {
      const hook = declaration.includes("check-careful.sh") ? "careful" : declaration.includes("check-freeze.sh") ? "freeze" : null;
      if (!hook) return line;
      const relative = declaration.includes("/scripts/") ? "scripts/check-" + hook + ".sh" : hook + "/bin/check-" + hook + ".sh";
      const executable = "'" + path.join(source, relative).replaceAll("'", "'\\\"'\\\"'") + "'";
      return prefix + " " + JSON.stringify("bash " + executable);
    });
    await fs.writeFile(skillFile, rendered.replace(/(?:~|\\$HOME)\\/\\.claude\\/skills\\/gstack(\\/[^\\s\\x60"'<>)]*)?/g, (_, suffix = "") => "'" + (source + suffix).replaceAll("'", "'\\\"'\\\"'") + "'"));
  }
}
await fs.mkdir(path.join(skillsRoot, "_gstack-command"), { recursive: true });
const rootSkill = path.join(source, "SKILL.md");
if (await fs.access(rootSkill).then(() => true, () => false)) await fs.copyFile(rootSkill, path.join(skillsRoot, "_gstack-command", "SKILL.md"));
await fs.mkdir(path.join(target, ".repo-pattern-runtime", "renders"), { recursive: true });
await fs.writeFile(path.join(target, ".repo-pattern-runtime", "renders", "upstream-render.txt"), "upstream local render\\n");
if (${failAfterPublish ? "true" : "false"}) process.exit(9);
`, { mode: 0o755 });
}

export async function installGstackRenderedUpstreamSetupFixture(checkout) {
  await installGstackUpstreamSetupFixture(checkout);
  const nodeExecutable = process.execPath.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
  await fs.writeFile(path.join(checkout, "setup"), `#!${nodeExecutable}
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const source = path.dirname(fileURLToPath(import.meta.url));
const build = spawnSync("bun", ["run", "build"], { cwd: source, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status || 1);
const args = process.argv.slice(2);
if (!args.includes("--local")) process.exit(8);
const target = process.cwd();
const skillsRoot = path.join(target, ".claude", "skills");
const renderRoot = path.join(process.env.GSTACK_STATE_ROOT, "render", "installs", "claude-id");
await fs.mkdir(renderRoot, { recursive: true });
const entries = await fs.readdir(source, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory() || entry.name.startsWith(".") || ["node_modules", "codex", "openclaw"].includes(entry.name)) continue;
  const skill = path.join(source, entry.name);
  if (!await fs.access(path.join(skill, "SKILL.md")).then(() => true, () => false)) continue;
  const rendered = path.join(renderRoot, entry.name);
  await fs.cp(skill, rendered, { recursive: true, force: true });
  const published = path.join(skillsRoot, entry.name);
  await fs.mkdir(published, { recursive: true });
  await fs.symlink(path.join(rendered, "SKILL.md"), path.join(published, "SKILL.md"));
  for (const directory of ["sections", "templates", "references"]) {
    if (await fs.lstat(path.join(rendered, directory)).then((stat) => stat.isDirectory(), () => false)) {
      await fs.symlink(path.join(rendered, directory), path.join(published, directory));
    }
  }
}
await fs.mkdir(path.join(skillsRoot, "_gstack-command"), { recursive: true });
const rootSkill = path.join(source, "SKILL.md");
if (await fs.access(rootSkill).then(() => true, () => false)) await fs.symlink(rootSkill, path.join(skillsRoot, "_gstack-command", "SKILL.md"));
await fs.mkdir(path.join(renderRoot, "autoplan", "hooks"), { recursive: true });
await fs.writeFile(path.join(renderRoot, "autoplan", "hooks", "published-hook"), path.join(source, "hosts", "claude", "hooks", "question-log-hook") + "\\n");
`, { mode: 0o755 });
}

export function commitGstackFixture(checkout) {
  for (const args of [["add", "."], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture upstream"]]) {
    const result = spawnSync("git", args, { cwd: checkout, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "Cannot commit gstack fixture");
  }
}

export async function writeEccGitFixture(target, { origin = "https://github.com/affaan-m/ECC.git", withAgents = true } = {}) {
  const cache = path.join(target, ".repo-pattern", "cache", "ECC");
  await fs.mkdir(path.join(cache, "rules", "common"), { recursive: true });
  await fs.writeFile(path.join(cache, "rules", "common", "rule.md"), "new rule", "utf8");
  if (withAgents) {
    await fs.mkdir(path.join(cache, "agents"), { recursive: true });
    await fs.writeFile(path.join(cache, "agents", "new-agent.md"), "new", "utf8");
  }
  spawnSync("git", ["init"], { cwd: cache, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: cache, stdio: "ignore" });
  spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "fixture"], { cwd: cache, stdio: "ignore" });
  spawnSync("git", ["remote", "add", "origin", origin], { cwd: cache, stdio: "ignore" });
  return cache;
}
