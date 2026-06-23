import path from "node:path";
import fs from "node:fs/promises";
import { backupPaths, exists, removePath, replaceFile, writeJson, ensureDir } from "./fs-utils.mjs";

const MINIMAL_SETTINGS = {
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [],
    "ask": [
      "Bash(git push *)",
      "Bash(git reset *)",
      "Bash(git clean *)",
      "Bash(rm *)",
      "Bash(sudo *)",
      "Bash(chmod *)",
      "Bash(chown *)"
    ],
    "deny": [
      "Read(.env)",
      "Read(.env.*)",
      "Read(**/.env)",
      "Read(**/.env.*)",
      "Read(secrets/**)",
      "Read(private/**)",
      "Read(**/*.pem)",
      "Read(**/*.key)",
      "Read(**/id_rsa)",
      "Read(**/id_ed25519)",
      "Read(~/.ssh/**)",
      "Read(~/.aws/**)",
      "Read(~/.config/gcloud/**)",
      "Bash(rm -rf /)",
      "Bash(rm -rf ~)"
    ],
    "additionalDirectories": [],
    "defaultMode": "default",
    "disableBypassPermissionsMode": "disable"
  },
  "enabledMcpjsonServers": [],
  "hooks": {},
  "autoCompactEnabled": true,
    "showClearContextOnPlanAccept": true,
    "env": {
      "ENABLE_TOOL_SEARCH": "auto:5"},
  "fileCheckpointingEnabled": true,
  "respectGitignore": true
};

const LOCAL_EXAMPLE = {
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "preferredNotifChannel": "terminal_bell",
  "showTurnDuration": true,
  "spinnerTipsEnabled": true,
  "permissions": {
    "allow": []
  }
};

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
  await writeJson(path.join(target, ".claude", "settings.json"), MINIMAL_SETTINGS, { dryRun });

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

  await writeJson(example, LOCAL_EXAMPLE, { dryRun });

  console.log("Cleanup complete.");
}
