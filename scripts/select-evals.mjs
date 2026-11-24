import { execFileSync } from "node:child_process";

function gitFiles(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" });
  } catch (error) {
    throw new Error(`Cannot inspect changed files with git ${args.join(" ")}: ${error.message}`);
  }
}

function baseRef() {
  for (const ref of ["origin/main", "main", "HEAD"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", ref], { stdio: "ignore" });
      return ref;
    } catch {}
  }
  throw new Error("Cannot select evals: no usable base ref (origin/main, main, or HEAD).");
}

const tracked = gitFiles(["diff", "--name-only", "--diff-filter=ACMRTUXB", baseRef()]);
const untracked = gitFiles(["ls-files", "--others", "--exclude-standard"]);
const changed = [...tracked.split(/\r?\n/), ...untracked.split(/\r?\n/)].filter(Boolean);
const promptSources = changed.filter((file) => file === "src/ui/mcp-interaction.mjs" || file === "src/ui/prompt.mjs" || file.includes("SKILL.md") || file.includes("prompt"));
const suites = promptSources.length ? ["test/setup/setup-contract.test.mjs", "test/setup/mcp-and-settings.test.mjs"] : [];
console.log(JSON.stringify({ promptSources, suites }));
