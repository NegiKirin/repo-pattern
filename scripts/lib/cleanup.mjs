import path from "node:path";
import { backupPaths, ensureDir, readJson, removePath, writeJson } from "./fs-utils.mjs";

export async function cleanupProject({ sourceRoot, target, dryRun = false }) {
  console.log(`Cleaning target: ${target}`);

  await backupPaths(target, [
    ".specify",
    ".claude/skills",
    ".claude/commands",
    ".claude/hooks",
    ".claude/scripts",
    ".claude/rules",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".mcp.json"
  ], { dryRun });

  const removeList = [
    ".specify",
    ".claude/skills",
    ".claude/commands",
    ".claude/hooks",
    ".claude/scripts",
    ".claude/rules"
  ];

  for (const rel of removeList) {
    await removePath(path.join(target, rel), { dryRun });
  }

  const settings = await readJson(path.join(sourceRoot, ".claude", "settings.example.json"), {});
  await ensureDir(path.join(target, ".claude"), { dryRun });
  await writeJson(path.join(target, ".claude", "settings.json"), settings, { dryRun });

  console.log("Cleanup complete.");
}
