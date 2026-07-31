import fs from "node:fs/promises";
import path from "node:path";
import { backupPaths, ensureDir, readJson, removePath, writePrivateJson } from "./fs-utils.mjs";
import { gstackCheckoutPath, isValidGstackCheckout } from "./gstack.mjs";

export async function cleanupProject({ sourceRoot, target, dryRun = false, preserveGstack = false, progress = null }) {
  console.log(`Cleaning target: ${target}`);

  const claudeDir = path.join(target, ".claude");
  if (!dryRun) {
    try {
      if ((await fs.lstat(claudeDir)).isSymbolicLink()) {
        throw new Error(".claude must not be a symlink.");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const gstackCheckout = gstackCheckoutPath(target);
  const skillsRoot = path.dirname(gstackCheckout);
  const preserveLocalGstack = preserveGstack &&
    await fs.lstat(skillsRoot).then((stat) => stat.isDirectory() && !stat.isSymbolicLink()).catch(() => false) &&
    await isValidGstackCheckout(gstackCheckout);
  const backupList = [
    ".claude/commands",
    ".claude/hooks",
    ".claude/scripts",
    ".claude/rules",
    ".claude/settings.json",
    ...(preserveLocalGstack ? [] : [".claude/skills"])
  ];
  await backupPaths(target, backupList, { dryRun, progress });

  const removeList = [
    ".claude/commands",
    ".claude/hooks",
    ".claude/scripts",
    ".claude/rules",
    ...(preserveLocalGstack ? [] : [".claude/skills"])
  ];

  for (const rel of removeList) {
    await removePath(path.join(target, rel), { dryRun });
  }
  const settings = await readJson(path.join(sourceRoot, ".claude.example", "settings.example.json"), {});
  await ensureDir(path.join(target, ".claude"), { dryRun });
  await writePrivateJson(path.join(target, ".claude", "settings.json"), settings, {
    dryRun,
    label: ".claude/settings.json",
    parentLabel: ".claude"
  });

  console.log("Cleanup complete.");
}
