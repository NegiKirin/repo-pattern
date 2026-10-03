import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyRecursiveWithProgress, isTracked, writePrivateJson } from "./fs-utils.mjs";

export const HERDR_COMMAND = 'sh "$CLAUDE_PROJECT_DIR/.claude/hooks/herdr-agent-state.sh" session';

export function applyHerdrHook(settings = {}) {
  const entries = (settings.hooks?.SessionStart || []).flatMap((entry) => {
    const hooks = (entry.hooks || []).filter((hook) => hook.command !== HERDR_COMMAND);
    return hooks.length ? [{ ...entry, hooks }] : [];
  });
  return {
    ...settings,
    hooks: {
      ...(settings.hooks || {}),
      SessionStart: [...entries, { hooks: [{ type: "command", command: HERDR_COMMAND, timeout: 5 }] }]
    }
  };
}

export async function installHerdrIntegration({ target, dryRun = false, silent = false }) {
  if (isTracked(target, ".claude/settings.json")) throw new Error(".claude/settings.json is tracked. Untrack it before writing Claude Code settings.");
  const hooksDir = path.join(target, ".claude", "hooks");
  if (!dryRun) {
    try {
      if ((await fs.lstat(hooksDir)).isSymbolicLink()) throw new Error(".claude/hooks must not be a symlink.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await copyRecursiveWithProgress(
    fileURLToPath(new URL("../vendor/herdr/herdr-agent-state.sh", import.meta.url)),
    path.join(hooksDir, "herdr-agent-state.sh"),
    { dryRun, silent }
  );
  if (dryRun && !silent) console.log("[dry-run] merge Herdr SessionStart hook into .claude/settings.json");
  await writePrivateJson(path.join(target, ".claude", "settings.json"), applyHerdrHook, {
    dryRun,
    label: ".claude/settings.json",
    parentLabel: ".claude",
    silent
  });
}
