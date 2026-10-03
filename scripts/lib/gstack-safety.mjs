import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const SAFETY_TOOLS = { careful: ["Bash"], guard: ["Bash", "Edit", "Write"], freeze: ["Edit", "Write"] };

export async function assertGstackSafety({ checkout, wrappers, statePath }) {
  const safety = wrappers.filter(({ wrapper }) => Object.hasOwn(SAFETY_TOOLS, path.basename(wrapper)));
  if (safety.length !== 3) throw new Error("gstack safety skills are missing: careful, guard and freeze must be installed together");
  execFileSync("bash", ["--version"], { stdio: "ignore" });
  try {
    execFileSync("python3", ["-c", "import json"], { stdio: "ignore" });
  } catch {
    execFileSync("node", ["-e", "JSON.parse('{}')"], { stdio: "ignore" });
  }
  const quote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;
  const scripts = new Set();
  const executableScripts = new Set();
  for (const { wrapper, content } of safety) {
    const skill = path.basename(wrapper);
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (!frontmatter) throw new Error(`gstack safety frontmatter is invalid: ${skill}`);
    const hookBlock = frontmatter.match(/^hooks:\r?\n  PreToolUse:\r?\n((?:[\t ]+[^\r\n]*\r?\n?)*)$/m)?.[1];
    if (!hookBlock) throw new Error(`gstack safety hook event is invalid: ${skill}`);
    const declarations = [...hookBlock.matchAll(/^    - matcher: "(Bash|Edit|Write)"\r?\n      hooks:\r?\n        - type: command\r?\n          command: (.+)\r?$/gm)];
    if (declarations.length !== SAFETY_TOOLS[skill].length) throw new Error(`gstack safety hook structure is invalid: ${skill}`);
    const tools = [...frontmatter.matchAll(/^[\t ]*- matcher: "(Bash|Edit|Write)"[\t ]*$/gm)].map((match) => match[1]);
    if (JSON.stringify(tools) !== JSON.stringify(SAFETY_TOOLS[skill])) throw new Error(`gstack safety hook matchers are invalid: ${skill}`);
    const commands = [...frontmatter.matchAll(/^[\t ]*command: (.+)$/gm)];
    if (commands.length !== tools.length) throw new Error(`gstack safety hook commands are missing: ${skill}`);
    for (let i = 0; i < commands.length; i++) {
      const command = JSON.parse(commands[i][1]);
      const hook = tools[i] === "Bash" ? "careful" : "freeze";
      const candidates = [`${hook}/bin/check-${hook}.sh`, `scripts/check-${hook}.sh`];
      const script = candidates.find((relative) => ["", "bash "].some((interpreter) =>
        command === `GSTACK_HOME=${quote(statePath)} ${interpreter}${quote(path.join(checkout, relative))}`));
      if (!script) throw new Error(`gstack safety hook command is not project-local: ${skill}/${tools[i]}`);
      if (command === `GSTACK_HOME=${quote(statePath)} ${quote(path.join(checkout, script))}`) executableScripts.add(script);
      execFileSync("bash", ["-n", "-c", command], { stdio: "ignore" });
      scripts.add(script);
    }
  }
  if ([...scripts].some((script) => script.includes("/bin/"))) scripts.add("careful/bin/hook-extract.sh");
  if (safety.some(({ content }) => content.includes(path.join(checkout, "bin", "gstack-paths")))) {
    scripts.add("bin/gstack-paths");
    executableScripts.add("bin/gstack-paths");
  }
  for (const relative of scripts) {
    let component = checkout;
    for (const segment of relative.split("/")) {
      component = path.join(component, segment);
      if ((await fs.lstat(component)).isSymbolicLink()) throw new Error(`gstack safety dependency must not traverse a symlink: ${relative}`);
    }
    const file = path.join(checkout, relative);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`gstack safety dependency is missing or invalid: ${relative}`);
    await fs.access(file, constants.R_OK | (executableScripts.has(relative) ? constants.X_OK : 0));
    execFileSync("bash", ["-n", file], { stdio: "ignore" });
    if (relative === "careful/bin/hook-extract.sh") {
      const helper = await fs.readFile(file, "utf8");
      for (const name of ["gstack_hook_extract_field", "gstack_hook_decision", "gstack_hook_json_string", "gstack_hook_state_root", "gstack_hook_log_fire"]) {
        if (!new RegExp(`^${name}\\s*\\(\\)\\s*\\{`, "m").test(helper)) throw new Error(`gstack safety helper is missing required function: ${name}`);
      }
    }
  }
}
