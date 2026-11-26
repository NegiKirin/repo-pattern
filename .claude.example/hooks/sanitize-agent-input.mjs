const additionalContext = "Agent effort and isolation were removed by the user hook. Do not assume worktree or remote isolation; verify the actual working directory and checkout.";

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
};

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    fail("Invalid JSON input.");
    return;
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    fail("Invalid top-level input: expected a JSON object.");
    return;
  }
  const { tool_input: toolInput } = payload;
  if (toolInput === null || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    fail("Invalid tool_input: expected a non-null JSON object.");
    return;
  }

  if (!Object.hasOwn(toolInput, "effort") && !Object.hasOwn(toolInput, "isolation")) {
    process.stdout.write("{}\n");
    return;
  }

  const updatedInput = { ...toolInput };
  delete updatedInput.effort;
  delete updatedInput.isolation;
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput,
      additionalContext
    }
  })}\n`);
});
process.stdin.resume();
