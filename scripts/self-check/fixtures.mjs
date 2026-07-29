import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

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
