#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject, printAudit } from "./lib/audit.mjs";
import { initProject } from "./lib/init.mjs";
import { migrateProject } from "./lib/migrate.mjs";
import { cleanupProject } from "./lib/cleanup.mjs";
import { generateMcp } from "./lib/mcp.mjs";
import { setupEcc } from "./lib/ecc.mjs";
import { doctorProject } from "./lib/doctor.mjs";
import { applyEccRules } from "./lib/rules.mjs";
import { setupProject } from "./lib/setup.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourceRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  let [command, ...rest] = argv;
  if (command === "-h" || command === "--help") {
    command = "help";
    rest = [];
  }
  const options = {
    command: command || "help",
    target: ".",
    profile: "web",
    dryRun: false,
    force: false,
    migrate: false,
    extraSkills: [],
    noExtraSkills: false,
    yesExtraSkillLicenseRisk: false
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--target") options.target = rest[++i];
    else if (arg === "--profile") options.profile = rest[++i];
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--migrate") options.migrate = true;
    else if (arg === "--extra-skill") {
      const value = rest[++i];
      if (!value || value.startsWith("--")) {
        console.error("Missing value for --extra-skill");
        process.exit(2);
      }
      options.extraSkills.push(value);
    }
    else if (arg === "--no-extra-skills") options.noExtraSkills = true;
    else if (arg === "--yes-extra-skill-license-risk") options.yesExtraSkillLicenseRisk = true;
    else if (arg === "-h" || arg === "--help") options.command = "help";
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }

  options.target = path.resolve(process.cwd(), options.target);
  return options;
}

function help() {
  console.log(`repo-pattern — minimal ECC-first Claude Code initializer

Usage:
  node scripts/repo-pattern.mjs setup   --target .
  node scripts/repo-pattern.mjs audit   --target .
  node scripts/repo-pattern.mjs init    --target . --profile web
  node scripts/repo-pattern.mjs migrate --target . --profile web
  node scripts/repo-pattern.mjs cleanup --target .
  node scripts/repo-pattern.mjs mcp     --target . --profile web
  node scripts/repo-pattern.mjs ecc     --target .
  node scripts/repo-pattern.mjs doctor  --target .
  node scripts/repo-pattern.mjs rules   --target .

Options:
  --target <path>   Target project path. Default: .
  --profile <name>  MCP profile for scriptable commands. Default: web

Setup UI:
  setup uses ↑/↓ to move, Space to toggle skills, Enter to confirm, Esc/Ctrl+C to cancel
  --dry-run                         Print actions without writing
  --force                           Force init over legacy state
  --migrate                         Allow init/setup to migrate legacy state
  --extra-skill <id>                Install optional target-local skill; repeatable
  --no-extra-skills                 Skip optional extra skill prompt during init
  --yes-extra-skill-license-risk    Accept license-unclear extra skills non-interactively
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    switch (options.command) {
      case "help":
        help();
        break;
      case "audit": {
        const audit = await auditProject(options.target);
        printAudit(audit);
        break;
      }
      case "setup":
        await setupProject({ sourceRoot, ...options });
        break;
      case "init":
        await initProject({ sourceRoot, ...options });
        break;
      case "migrate":
        await migrateProject({ sourceRoot, ...options });
        break;
      case "cleanup":
        await cleanupProject({ sourceRoot, ...options });
        break;
      case "mcp":
        await generateMcp({ sourceRoot, target: options.target, profile: options.profile, dryRun: options.dryRun });
        break;
      case "ecc":
        await setupEcc({ sourceRoot, target: options.target, dryRun: options.dryRun });
        break;
      case "rules":
        await applyEccRules({ target: options.target, dryRun: options.dryRun });
        break;
      case "doctor":
        await doctorProject(options.target);
        break;
      default:
        console.error(`Unknown command: ${options.command}`);
        help();
        process.exit(2);
    }
  } catch (error) {
    console.error(`\nERROR: ${error.message}`);
    if (process.env.DEBUG) console.error(error.stack);
    process.exit(1);
  }
}

main();
