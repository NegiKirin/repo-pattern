#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditProject, printAudit } from "./lib/audit.mjs";
import { cleanupProject } from "./lib/cleanup.mjs";
import { generateMcp, readGeneratedMcpValues } from "./lib/mcp.mjs";
import { setupEcc } from "./lib/ecc.mjs";
import { doctorProject } from "./lib/doctor.mjs";
import { applyEccRules } from "./lib/rules.mjs";
import { setupProject } from "./lib/setup.mjs";
import { invalidOptionalSkills, OPTIONAL_SKILLS } from "./lib/skills.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourceRoot = path.resolve(__dirname, "..");
const optionalSkillNames = OPTIONAL_SKILLS.map((skill) => skill.value).join(", ");
const setupPipelineNames = ["ecc", "gstack", "both", "none"];

function requiredOptionValue(rest, index, arg) {
  const value = rest[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`Missing value for ${arg}`);
    process.exit(2);
  }
  return value;
}

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
    setupPipeline: "ecc",
    planTuneHooks: false,
    dryRun: false,
    force: false,
    migrate: false,
    applyRules: false,
    optionalSkills: [],
    yes: false
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--target") options.target = requiredOptionValue(rest, i++, arg);
    else if (arg === "--profile") options.profile = requiredOptionValue(rest, i++, arg);
    else if (arg === "--setup-pipeline") options.setupPipeline = requiredOptionValue(rest, i++, arg);
    else if (arg === "--with-plan-tune-hooks") options.planTuneHooks = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--migrate") options.migrate = true;
    else if (arg === "--with-rules") options.applyRules = true;
    else if (arg === "--with-skill") options.optionalSkills.push(requiredOptionValue(rest, i++, arg));
    else if (arg === "--with-skills") options.optionalSkills.push(...requiredOptionValue(rest, i++, arg).split(",").map((value) => value.trim()).filter(Boolean));
    else if (arg === "--yes") options.yes = true;
    else if (arg === "-h" || arg === "--help") options.command = "help";
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }

  if (options.force && options.migrate) {
    console.error("Use either --force or --migrate, not both.");
    process.exit(2);
  }

  if (!setupPipelineNames.includes(options.setupPipeline)) {
    console.error(`Unknown setup pipeline: ${options.setupPipeline}. Available: ${setupPipelineNames.join(", ")}`);
    process.exit(2);
  }

  const invalidSkills = invalidOptionalSkills(options.optionalSkills);
  if (invalidSkills.length > 0) {
    console.error(`Unknown optional skill(s): ${invalidSkills.join(", ")}. Available: ${optionalSkillNames}`);
    process.exit(2);
  }

  if (options.planTuneHooks && !["gstack", "both"].includes(options.setupPipeline)) {
    console.error("--with-plan-tune-hooks requires --setup-pipeline gstack or both.");
    process.exit(2);
  }

  options.target = path.resolve(process.cwd(), options.target);
  return options;
}

function help() {
  console.log(`repo-pattern — minimal Claude Code setup

Usage:
  repo-pattern help
  repo-pattern setup
  repo-pattern setup --profile web --setup-pipeline ecc --yes
  repo-pattern setup --profile web --setup-pipeline gstack --yes
  repo-pattern setup --profile web --setup-pipeline gstack --with-plan-tune-hooks --yes
  repo-pattern setup --profile web --setup-pipeline both --yes
  repo-pattern setup --profile web --setup-pipeline none --yes
  repo-pattern setup --profile web --migrate --yes
  repo-pattern setup --with-skill taste --yes
  repo-pattern setup --with-skill ui-ux-pro-max --yes  # requires Python 3.x
  repo-pattern setup --with-skill nextjs-pattern --yes
  repo-pattern setup --with-skills nextjs-pattern,fastapi-pattern --yes

Advanced:
  repo-pattern mcp --profile web
  repo-pattern ecc
  repo-pattern rules
  repo-pattern audit
  repo-pattern doctor
  repo-pattern cleanup

Options:
  --target <path>                  Target project path. Default: .
  --profile <name>                 MCP profile for scriptable commands. Default: web
  --setup-pipeline <ecc|gstack|both|none>
                                  Setup pipeline. Default: ecc
                                  ecc: project-scoped ECC
                                  gstack: project-local at .claude/skills/gstack
                                  both: project-scoped ECC + project-local gstack
                                  none: base project metadata only
  --with-plan-tune-hooks          Add gstack PreToolUse/PostToolUse hooks to .claude/settings.json
                                  Requires --setup-pipeline gstack or both. Default: not installed

Setup UI:
  setup uses ↑/↓ to move, Space to toggle MCP/rules choices, Enter to confirm, Esc/Ctrl+C to cancel
  --dry-run      Print actions without writing
  --migrate      Take over legacy/local Claude runtime surfaces
  --force        Reapply setup over repo-pattern-managed state
  --with-rules               Install auto-detected project-local ECC rules on any pipeline
                             ECC/both install rules by default; gstack/none opt in with this flag
  --with-skill <name>        Opt in to external skills/plugins (${optionalSkillNames})
  --with-skills <a,b>        Comma-separated optional skills
  --yes                      Run setup non-interactively
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
      case "cleanup":
        await cleanupProject({ sourceRoot, ...options });
        break;
      case "mcp":
        await generateMcp({ sourceRoot, target: options.target, profile: options.profile, mcpValues: await readGeneratedMcpValues(options.target), yes: options.yes, dryRun: options.dryRun });
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
