# repo-pattern


<p align="center">
<img alt="Repo Pattern" src="https://img.shields.io/badge/repo--pattern-ECC--first-blue">
<img alt="Claude Code" src="https://img.shields.io/badge/Claude%20Code-ready-black">
<img alt="ECC" src="https://img.shields.io/badge/ECC-workflow-purple">
<img alt="MCP" src="https://img.shields.io/badge/MCP-profile--based-green">
<img alt="Node.js" src="https://img.shields.io/badge/Node.js-ESM-brightgreen">
<img alt="No Runtime Vendor" src="https://img.shields.io/badge/no--runtime--vendor-safe-orange">
<img alt="License" src="https://img.shields.io/badge/license-MIT-lightgrey">
</p>
A minimal **ECC-first Claude Code initializer and migrator**.

`repo-pattern` initializes or migrates another project into a clean Claude Code setup with:

* minimal `.claude` settings
* MCP profiles
* generated `.mcp.json`
* ECC setup on `init`
* cleanup, migration, audit, and doctor tools

`repo-pattern` does **not** vendor or install local Claude runtime surfaces into target projects:

* no local `.claude/skills`
* no local `.claude/commands`
* no local `.claude/hooks`
* no local `.claude/scripts`
* no local `.claude/rules`
* no deprecated spec runtime

ECC is treated as the primary workflow layer and should be plugin-managed.


## Template policy

This repo no longer uses a separate `templates/` folder.

`repo-pattern init` copies canonical files directly from:

```text
.claude/
docs/
mcp/
```

The target project's root `CLAUDE.md` is created empty when missing. Existing target `CLAUDE.md` files are preserved.


## Stability defaults

`repo-pattern` uses conservative Claude Code defaults to reduce interrupted sessions:

* `autoCompactEnabled: true`
* `autoUpdatesChannel: "stable"`
* `fileCheckpointingEnabled: true`
* MCP server timeouts in `mcp/servers/*.json`

## Setup guide

The main setup instructions are consolidated in:

```text
docs/repo-pattern/setup-guide.md
```

The guide focuses on one-step new project setup, MCP profile selection, setup flow, and repo-pattern commands.

## Normal usage

From this repo:

```bash
node scripts/repo-pattern.mjs init --target /path/to/project --profile web
```

`init` creates minimal Claude setup, generates MCP config, runs the ECC setup flow, and runs doctor.

If the ECC plugin cannot be verified or installed automatically, the CLI prints the manual Claude Code commands:

```text
/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc@ecc
```

## Existing project migration

```bash
node scripts/repo-pattern.mjs audit --target /path/to/project
node scripts/repo-pattern.mjs migrate --target /path/to/project --profile web
node scripts/repo-pattern.mjs doctor --target /path/to/project
```

Migration archives old local Claude runtime surfaces before writing the minimal setup.

## Cleanup only

```bash
node scripts/repo-pattern.mjs cleanup --target /path/to/project
```

Cleanup removes or archives:

* `.specify`
* `.claude/skills`
* `.claude/commands`
* `.claude/hooks`
* `.claude/scripts`
* `.claude/rules`
* non-empty hooks in `.claude/settings.json`
* machine-local `.claude/settings.local.json`


## Claude Code settings policy

`repo-pattern` keeps shared Claude Code settings safe and minimal:

```text
.claude/settings.json
```

Default policy:

* `permissions.allow` starts empty
* dangerous shell commands are placed in `permissions.ask`
* common secrets are blocked in `permissions.deny`
* `hooks` stays `{}`
* `enabledMcpjsonServers` is synced from the selected MCP profile
* personal preferences stay in `.claude/settings.local.json`

`repo-pattern mcp` regenerates `.mcp.json` and updates `.claude/settings.json` so `enabledMcpjsonServers` matches the active profile.

## MCP profiles

```bash
node scripts/repo-pattern.mjs mcp --target /path/to/project --profile web
```

Available profiles:

* `minimal`
* `web`
* `backend`
* `research`
* `full.local.example`

The default profile is `web`.

## ECC setup

`init` runs ECC setup automatically.

Advanced/manual command:

```bash
node scripts/repo-pattern.mjs ecc --target /path/to/project
```

If you already have your own ECC setup function, set:

```bash
export REPO_PATTERN_ECC_SETUP_CMD="your-ecc-setup-command"
```

The command receives the target project path via:

```bash
REPO_PATTERN_TARGET=/path/to/project
```

`repo-pattern` itself never copies ECC skills, commands, hooks, scripts, or rules into the target project.

## Target structure after init

```text
target-project/
├── CLAUDE.md
├── .claude/
│   ├── CLAUDE.md
│   ├── settings.json
│   └── settings.local.example.json
├── mcp/
│   ├── profiles/
│   └── servers/
├── docs/
│   └── repo-pattern/
│       ├── workflow.md
│       └── setup-guide.md
├── .mcp.json.example
├── .repo-pattern.json
└── .repo-pattern.lock.json
```

Generated local file:

```text
.mcp.json
```

`.mcp.json` is intentionally gitignored by default because it is generated from profiles.

## Commands

```bash
node scripts/repo-pattern.mjs audit --target .
node scripts/repo-pattern.mjs init --target . --profile web
node scripts/repo-pattern.mjs migrate --target . --profile web
node scripts/repo-pattern.mjs cleanup --target .
node scripts/repo-pattern.mjs mcp --target . --profile web
node scripts/repo-pattern.mjs ecc --target .
node scripts/repo-pattern.mjs doctor --target .
```

All mutating commands support:

```bash
--dry-run
```

## Design rule

`repo-pattern` is setup infrastructure only.

After setup, use ECC as the workflow layer inside Claude Code.