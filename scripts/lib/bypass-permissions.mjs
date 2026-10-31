import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BYPASS_USER_SCOPE_VERSION = [2, 1, 257];

export function claudeVersionSupportsUserScope(version) {
  const match = String(version || "").match(/(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:\b|$)/);
  if (!match) return false;
  const actual = match.slice(1).map(Number);
  for (let index = 0; index < BYPASS_USER_SCOPE_VERSION.length; index++) {
    if (actual[index] !== BYPASS_USER_SCOPE_VERSION[index]) return actual[index] > BYPASS_USER_SCOPE_VERSION[index];
  }
  return true;
}

export async function setUserBypassPermission({ accepted, settingsPath = path.join(os.homedir(), ".claude", "settings.json") }) {
  if (!accepted) return { changed: false, message: "Bypass permissions were declined; no user settings were changed." };
  let current;
  let originalContent = null;
  try {
    try {
      originalContent = await fs.readFile(settingsPath);
      current = JSON.parse(originalContent.toString("utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      current = {};
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error("settings root must be an object");
    if (Object.hasOwn(current, "permissions") && (!current.permissions || typeof current.permissions !== "object" || Array.isArray(current.permissions))) {
      throw new Error("permissions must be an object");
    }
  } catch (error) {
    return { changed: false, message: `Cannot enable bypass permissions: unable to read or parse ${settingsPath} (${error.message}).` };
  }
  const permissions = current.permissions || {};
  if (permissions.disableBypassPermissionsMode === "disable") return { changed: false, message: "Cannot enable bypass permissions: user settings disable bypass with permissions.disableBypassPermissionsMode=disable." };
  if (permissions.defaultMode === "bypassPermissions") {
    return { changed: false, alreadyEnabled: true, message: "Bypass permissions are already enabled in user settings." };
  }
  if (originalContent !== null) {
    return { changed: false, message: `Cannot safely update existing user settings at ${settingsPath}; no settings were changed. Add permissions.defaultMode=bypassPermissions manually if you want to enable it for every project.` };
  }
  const updated = { ...current, permissions: { ...permissions, defaultMode: "bypassPermissions" } };
  try {
    const directory = path.dirname(settingsPath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const tempDir = await fs.mkdtemp(path.join(directory, ".settings.json-"));
    try {
      const tempPath = path.join(tempDir, "settings.json");
      await fs.writeFile(tempPath, `${JSON.stringify(updated, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      try {
        await fs.link(tempPath, settingsPath);
      } catch (error) {
        if (error.code === "EEXIST") {
          return { changed: false, message: `Cannot enable bypass permissions: ${settingsPath} appeared during setup; no settings were changed. Review the latest settings and try again.` };
        }
        throw error;
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    return { changed: false, message: `Cannot enable bypass permissions: failed to write ${settingsPath} (${error.message}).` };
  }
  return { changed: true, message: "Bypass permissions enabled in new user settings; this affects every project." };
}
