import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const GENERATED_ATTRIBUTION_HOOK_SOURCE = "generated-attribution-removal";
const CLAUDE_ATTRIBUTION_LINE = /^(?:🤖 Generated with Claude Code|Co-Authored-By: Claude(?: [^<]+)? <noreply@anthropic\.com>)$/;

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

const command = await attributionMode() === "off"
  ? removeGeneratedAttribution(input.tool_input.command)
  : input.tool_input.command;
if (command !== input.tool_input.command) {
  process.stdout.write(`${JSON.stringify({ permissionDecision: "allow", updatedInput: { command } })}\n`);
}
