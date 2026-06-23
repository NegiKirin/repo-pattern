import path from "node:path";
import { auditProject, printAudit } from "./audit.mjs";
import { cleanupProject } from "./cleanup.mjs";
import { copyMcpSystem, generateMcp } from "./mcp.mjs";
import { setupEcc } from "./ecc.mjs";
import { doctorProject } from "./doctor.mjs";
import { backupPaths, copyFileIfMissing, copyRecursive, ensureDir, writeJson, writeIfMissing } from "./fs-utils.mjs";

const TARGET_CLAUDE_MD = "";

function repoPatternJson(profile) {
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
      setupOnInit: true,
      installMode: "plugin",
      rulesSync: "setup-function",
      hooks: "plugin-managed",
      copyRuntimeSurfaces: false
    },
    mcp: {
      profile,
      generated: true
    }
  };
}

function lockJson(profile) {
  return {
    repoPattern: {
      version: "2.0.0",
      lastInitRun: new Date().toISOString(),
      lastDoctorRun: null
    },
    ecc: {
      setupOnInit: true,
      installMode: "plugin",
      status: "not-run",
      rulesSyncedBy: "setup-function",
      hooks: "plugin-managed",
      syncedAt: null
    },
    mcp: {
      profile,
      generatedAt: null
    }
  };
}

export async function initProject({ sourceRoot, target, profile = "web", dryRun = false, force = false, migrate = false }) {
  console.log(`Initializing target: ${target}`);
  const audit = await auditProject(target);
  printAudit(audit);

  if (audit.state === "LEGACY_VENDOR" && !force && !migrate) {
    throw new Error("Target has legacy/local Claude runtime surfaces. Re-run with --migrate or use the migrate command.");
  }

  if (audit.state === "LEGACY_VENDOR" && (force || migrate)) {
    await cleanupProject({ sourceRoot, target, dryRun });
  } else {
    await backupPaths(target, ["CLAUDE.md", ".claude", ".mcp.json", ".repo-pattern.json", ".repo-pattern.lock.json"], { dryRun });
  }

  await ensureDir(path.join(target, ".claude"), { dryRun });

  // No templates directory is used. repo-pattern keeps canonical project files in:
  // - sourceRoot/.claude/*
  // - sourceRoot/docs/*
  // - sourceRoot/mcp/*
  // Target CLAUDE.md is created empty when missing. Existing target CLAUDE.md is preserved. Existing .claude project files are also preserved to avoid conflicts.
  await writeIfMissing(path.join(target, "CLAUDE.md"), TARGET_CLAUDE_MD, { dryRun });

  await copyFileIfMissing(
    path.join(sourceRoot, ".claude", "CLAUDE.md"),
    path.join(target, ".claude", "CLAUDE.md"),
    { dryRun }
  );

  await copyFileIfMissing(
    path.join(sourceRoot, ".claude", "settings.json"),
    path.join(target, ".claude", "settings.json"),
    { dryRun }
  );

  await copyFileIfMissing(
    path.join(sourceRoot, ".claude", "settings.local.example.json"),
    path.join(target, ".claude", "settings.local.example.json"),
    { dryRun }
  );

  await copyRecursive(path.join(sourceRoot, "docs"), path.join(target, "docs"), { dryRun });
  await copyMcpSystem({ sourceRoot, target, dryRun });

  await writeJson(path.join(target, ".repo-pattern.json"), repoPatternJson(profile), { dryRun });
  await writeJson(path.join(target, ".repo-pattern.lock.json"), lockJson(profile), { dryRun });

  await generateMcp({ sourceRoot, target, profile, dryRun });
  await setupEcc({ sourceRoot, target, dryRun });

  if (dryRun) {
    console.log("[dry-run] doctor skipped because no files were written.");
  } else {
    await doctorProject(target, { updateLock: true, dryRun });
  }

  console.log("\nrepo-pattern init completed.");
}
