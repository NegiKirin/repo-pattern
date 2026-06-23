export const DEFAULT_SETTINGS = {
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
  "fileCheckpointingEnabled": true,
  "respectGitignore": true,
  "autoUpdatesChannel": "stable"
};

export const LOCAL_SETTINGS_EXAMPLE = {
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "preferredNotifChannel": "terminal_bell",
  "showTurnDuration": true,
  "spinnerTipsEnabled": true,
  "permissions": {
    "allow": []
  }
};

export function cloneDefaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

export function cloneLocalSettingsExample() {
  return JSON.parse(JSON.stringify(LOCAL_SETTINGS_EXAMPLE));
}
