import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const GENERATED_ATTRIBUTION_HOOK_SOURCE = "generated-attribution-removal";
const CLAUDE_ATTRIBUTION_LINE = /^(?:🤖 Generated with (?:Claude Code|\[Claude Code\]\(https:\/\/claude\.com\/claude-code\))|Co-Authored-By: Claude(?: [^<]+)? <noreply@anthropic\.com>)$/;
const MAX_ATTRIBUTION_FILE_BYTES = 1024 * 1024;

async function attributionMode() {
  try {
    const settings = JSON.parse(await fs.readFile(path.join(process.env.CLAUDE_PROJECT_DIR, ".claude", "settings.json"), "utf8"));
    return settings.hooks?.PreToolUse?.find((entry) => entry?._repo_pattern_source === GENERATED_ATTRIBUTION_HOOK_SOURCE)?._repo_pattern_attribution_mode;
  } catch {
    return null;
  }
}

function removeGeneratedAttribution(command) {
  const parts = command.split(/(\r\n|\n|\\n)/);
  return parts.reduce((result, line, index) => {
    if (index % 2 !== 0 || CLAUDE_ATTRIBUTION_LINE.test(line)) return result;
    return result + line + (parts[index + 1] || "");
  }, "");
}

function shellPath(file) {
  return file.replace(/^~(?=\/|$)/, process.env.HOME || "~").replace(/^\$\{HOME\}|^\$HOME/, process.env.HOME || "$HOME");
}

function attributedFiles(command) {
  const file = '(?:"([^"]+)"|\'([^\']+)\'|([^\\s;&|]+))';
  return [
    ["\\bgh\\s+pr\\s+(?:create|edit)\\b", "--body-file"],
    ["\\bglab\\s+mr\\s+(?:create|update)\\b", "--description-file"],
    ["\\bgit\\s+commit\\b", "(?:-F|--file)"]
  ].flatMap(([commandPattern, option]) => [...command.matchAll(new RegExp(`${commandPattern}(?:(?![;&|]).)*?${option}(?:=|\\s+)${file}`, "g"))].map((match) => shellPath(match[1] || match[2] || match[3])));
}

async function removeFileAttribution(file) {
  let temporary;
  let created = false;
  try {
    const details = await fs.stat(file);
    if (details.size > MAX_ATTRIBUTION_FILE_BYTES) return false;
    const text = await fs.readFile(file, "utf8");
    const cleaned = removeGeneratedAttribution(text);
    if (cleaned === text) return true;
    temporary = path.join(path.dirname(file), `.${path.basename(file)}.repo-pattern-${randomUUID()}`);
    const handle = await fs.open(temporary, "wx", 0o600);
    created = true;
    try {
      await handle.chmod(details.mode);
      await handle.writeFile(cleaned, "utf8");
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
    return true;
  } catch {
    if (created) await fs.rm(temporary, { force: true }).catch(() => {});
    return false;
  }
}

let input;
try {
  input = JSON.parse(await new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  }));
} catch {
  console.error("Invalid PreToolUse JSON input.");
  process.exit(2);
}

if (typeof input.tool_input?.command !== "string") {
  console.error("PreToolUse input requires a string tool_input.command.");
  process.exit(2);
}
if (input.tool_name !== "Bash") {
  process.stdout.write("{}\n");
  process.exit(0);
}

const mode = await attributionMode();
const command = mode === "off" ? removeGeneratedAttribution(input.tool_input.command) : input.tool_input.command;
if (mode === "off") {
  for (const file of attributedFiles(command)) {
    if (!await removeFileAttribution(file)) {
      process.stdout.write(`${JSON.stringify({ permissionDecision: "deny", reason: `Cannot remove generated attribution from referenced file: ${file}` })}\n`);
      process.exit(0);
    }
  }
}
if (command !== input.tool_input.command) {
  process.stdout.write(`${JSON.stringify({ permissionDecision: "allow", updatedInput: { command } })}\n`);
}
