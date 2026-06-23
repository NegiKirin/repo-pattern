import path from "node:path";
import fs from "node:fs/promises";
import { backupPaths, exists, removePath, writeJson, ensureDir } from "./fs-utils.mjs";
import { cloneDefaultSettings, cloneLocalSettingsExample } from "./settings-defaults.mjs";


export async function cleanupProject({ target, dryRun = false }) {
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

  await ensureDir(path.join(target, ".claude"), { dryRun });
  await writeJson(path.join(target, ".claude", "settings.json"), cloneDefaultSettings(), { dryRun });

  const local = path.join(target, ".claude", "settings.local.json");
  const example = path.join(target, ".claude", "settings.local.example.json");

  if (exists(local)) {
    if (dryRun) {
      console.log(`[dry-run] move ${local} -> ${example}`);
    } else {
      await fs.rename(local, example).catch(async () => {
        await fs.copyFile(local, example);
        await fs.rm(local, { force: true });
      });
    }
  }

  await writeJson(example, cloneLocalSettingsExample(), { dryRun });

  console.log("Cleanup complete.");
}
