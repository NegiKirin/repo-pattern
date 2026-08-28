import process from "node:process";

function removeGeneratedAttribution(command) {
  const parts = command.split(/(\n|\\n)/);
  return parts.reduce((result, line, index) => {
    if (index % 2 !== 0 || line.startsWith("🤖 Generated with")) return result;
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

const command = removeGeneratedAttribution(input.tool_input.command);
if (command !== input.tool_input.command) {
  process.stdout.write(`${JSON.stringify({ permissionDecision: "allow", updatedInput: { command } })}\n`);
}
