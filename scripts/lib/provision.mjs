import path from "node:path";
import { auditProject, printAudit } from "./audit.mjs";
import { cleanupProject } from "./cleanup.mjs";
import { generateMcp } from "./mcp.mjs";
import { setupEcc } from "./ecc.mjs";
import { doctorProject } from "./doctor.mjs";
import { applyEccRules } from "./rules.mjs";
import { appendGitignoreLine, backupPaths, copyRecursive, ensureDir, readJson, writeJson, writeIfMissing } from "./fs-utils.mjs";

const TARGET_CLAUDE_MD = "";

function repoPatternConfig(profile) {
  return {
    version: "2.0.0",
    workflow: "ecc-native",
    mode: "target",
    runtime: {
      localSkills: false,
      localCommands: false,
      localHooks: false,
      localScripts: false,
      localRules: false,
      vendoredEccRules: false
    },
    ecc: {
      installMode: "plugin",
      rulesSync: "repo-pattern-auto-cache",
      rulesProfile: "auto",
      rulesScope: "project",
      hooks: "plugin-managed",
      copyRuntimeSurfaces: false
    },
    mcp: {
      profile,
      generated: true
    }
  };
}

function lockConfig(profile) {
  return {
    repoPattern: {
      version: "2.0.0",
      lastProvisionRun: new Date().toISOString(),
      lastDoctorRun: null
    },
    ecc: {
      installMode: "plugin",
      status: "not-run",
      rulesSyncedBy: null,
      rulesScope: "project",
      recommendedRules: [],
      appliedRules: [],
      detectedStack: null,
      rulesAppliedAt: null,
      hooks: "plugin-managed",
      syncedAt: null
    },
    mcp: {
      profile,
      generatedAt: null
    }
  };
}

async function writeLocalSettings({ sourceRoot, target, localSettingsEnv, dryRun }) {
  if (!localSettingsEnv) return;
  const template = await readJson(path.join(sourceRoot, ".claude", "settings.local.example.json"), {});
  await writeJson(path.join(target, ".claude", "settings.local.json"), {
    ...template,
    env: {
      ...(template.env || {}),
      ...localSettingsEnv
    }
  }, { dryRun });
  await appendGitignoreLine(target, ".claude/settings.local.json", { dryRun });
}

export async function provisionProject({ sourceRoot, target, profile = "web", mcpServers = null, dryRun = false, force = false, migrate = false, localSettingsEnv = null, ruleMode = "auto", rules = null, applyRules = false }) {
  console.log(`Provisioning target: ${target}`);
  const audit = await auditProject(target);
  printAudit(audit);

  if (audit.state === "LEGACY_VENDOR" && !migrate) {
    throw new Error("Target has legacy/local Claude runtime surfaces. Re-run setup with --migrate, not --force.");
  }

  if (audit.state === "LEGACY_VENDOR") {
    await cleanupProject({ sourceRoot, target, dryRun });
  } else {
    await backupPaths(target, ["CLAUDE.md", ".claude", ".mcp.json", ".repo-pattern.json", ".repo-pattern.lock.json"], { dryRun });
  }

  await ensureDir(path.join(target, ".claude"), { dryRun });

  // No templates directory is used. repo-pattern keeps canonical project files in:
  // - sourceRoot/.claude/*
  // - sourceRoot/mcp/*
  // Target CLAUDE.md is created empty when missing so project-specific instructions can be added later. Existing target CLAUDE.md is preserved.
  await writeIfMissing(path.join(target, "CLAUDE.md"), TARGET_CLAUDE_MD, { dryRun });

  await copyRecursive(
    path.join(sourceRoot, ".claude", "CLAUDE.md"),
    path.join(target, ".claude", "CLAUDE.md"),
    { dryRun }
  );

  await copyRecursive(
    path.join(sourceRoot, ".claude", "settings.example.json"),
    path.join(target, ".claude", "settings.json"),
    { dryRun }
  );
  await appendGitignoreLine(target, ".claude/settings.json", { dryRun });

  await writeLocalSettings({ sourceRoot, target, localSettingsEnv, dryRun });

  await writeJson(path.join(target, ".repo-pattern.json"), repoPatternConfig(profile), { dryRun });
  await writeJson(path.join(target, ".repo-pattern.lock.json"), lockConfig(profile), { dryRun });

  await generateMcp({ sourceRoot, target, profile, mcpServers, dryRun });
  await setupEcc({ sourceRoot, target, dryRun });
  if (applyRules) await applyEccRules({ target, dryRun, ruleMode, rules });

  if (dryRun) {
    console.log("[dry-run] doctor skipped because no files were written.");
  } else {
    await doctorProject(target, { updateLock: true, dryRun });
  }

  console.log("\nrepo-pattern setup completed.");
}
