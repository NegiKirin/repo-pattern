# repo-pattern


<p align="center">
  <img alt="Repo Pattern" src="https://img.shields.io/badge/repo--pattern-ECC--first-blue">
  <img alt="Claude Code" src="https://img.shields.io/badge/Claude%20Code-ready-black">
  <img alt="ECC" src="https://img.shields.io/badge/ECC-workflow-purple">
  <img alt="MCP Profiles" src="https://img.shields.io/badge/MCP-profiles-green">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-ESM-brightgreen">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-lightgrey">
</p>

A minimal **ECC-first Claude Code setup and migrator**.

`repo-pattern` sets up or migrates another project into a clean Claude Code setup with:

- minimal `.claude` settings
- MCP profiles
- generated `.mcp.json`
- ECC setup on `setup`
- cleanup, migration, audit, and doctor tools

`repo-pattern` does **not** vendor or install local Claude runtime surfaces into target projects by default:

- no local `.claude/skills` unless explicitly selected during `setup`
- no local `.claude/commands`
- no local `.claude/hooks`
- no local `.claude/scripts`
- no local `.claude/rules` except ECC project rules under `.claude/rules/ecc/`
- no deprecated spec runtime

ECC is treated as the primary workflow layer and should be plugin-managed.


## Template policy

This repo no longer uses a separate `templates/` folder.

`repo-pattern setup` uses canonical files directly from this repository:

```text
.claude/
mcp/
```

It copies only the minimal `.claude` setup into the target and generates `.mcp.json` from source MCP profiles. The target project's root `CLAUDE.md` is created empty when missing. Existing target `CLAUDE.md` files are preserved.


## ECC rules opt-in

`repo-pattern setup` does not install project-local ECC rules by default. To opt in for scriptable setup, pass:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project --profile web --with-rules --yes
```

Or run rules later explicitly:

```bash
node scripts/repo-pattern.mjs rules --target /path/to/project
```

Rules are copied as whole ECC rule-pack directories under `.claude/rules/ecc/`; the first rules run needs network access to clone ECC into `.repo-pattern/cache/ECC/`.


## Context and token guards

Claude Code currently exposes `autoCompactEnabled`, but not a documented project setting for a custom auto-compact token threshold. `repo-pattern` therefore uses official context/token guards instead of adding fake settings:

```json
{
  "autoCompactEnabled": true,
  "showClearContextOnPlanAccept": true,
  "env": {
    "ENABLE_TOOL_SEARCH": "auto:5"}
}
```

Meaning:

- skill listing and skill description limits are intentionally left at Claude Code defaults
- keep auto-compact enabled
- show the clear-context option after accepting a plan
- defer MCP tool loading unless tools fit within 5% of context


## GitHub Packages release workflow

This repo includes a GitHub Actions workflow at:

```text
.github/workflows/nodejs-package.yml
```

It runs on GitHub Release creation:

```text
release.created
```

The workflow:

```text
1. checks out the repo
2. installs dependencies with npm ci
3. runs npm test
4. verifies package contents with npm pack --dry-run
5. publishes to GitHub Packages
```

GitHub Packages for npm requires a scoped package name, so the workflow keeps the source package as `repo-pattern` but temporarily publishes it as:

```text
@<github-owner>/repo-pattern
```

The publish job uses `GITHUB_TOKEN` with `packages: write`.

## NPX usage

After publishing to GitHub Packages and configuring npm for `@negikirin`:

```bash
npx @negikirin/repo-pattern setup --target . --profile web --yes
```

Other commands:

```bash
npx @negikirin/repo-pattern doctor --target .
npx @negikirin/repo-pattern audit --target .
npx @negikirin/repo-pattern mcp --target . --profile research
npx @negikirin/repo-pattern rules --target .
```

Package-local development test:

```bash
npm pack
npm exec --yes --package ./repo-pattern-0.0.2.tgz -- repo-pattern --help
```

## Setup guide

The main setup instructions are consolidated in:

```text
docs/repo-pattern/setup-guide.md
```

The guide focuses on one-step new project setup, MCP profile selection, setup flow, and repo-pattern commands.

## Normal usage

Guided terminal setup:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project
```

Scriptable one-shot setup:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project --profile web --yes
```

`setup` first checks `claude --version`, then opens a library-backed interactive terminal UI: use ↑/↓ to move, Space to toggle rules/MCP servers, Enter to confirm, Esc/Ctrl+C to cancel. It can use a preset MCP profile or custom-select MCP servers, optionally install ECC rules, then asks for Anthropic provider/model values and writes the target's gitignored `.claude/settings.local.json`. It requires a TTY; use `setup --yes` for CI/scripts.

`setup --yes` creates minimal Claude setup, generates MCP config, runs the ECC setup flow, and runs doctor. It copies `.claude/settings.example.json` to the target as `.claude/settings.json`. Use `--with-rules` only when you explicitly want project-local ECC rules.

If the ECC plugin cannot be verified or installed automatically, the CLI prints the manual Claude Code commands:

```text
/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc@ecc
```

## Existing project migration

```bash
node scripts/repo-pattern.mjs audit --target /path/to/project
node scripts/repo-pattern.mjs setup --target /path/to/project --profile web --migrate --yes
node scripts/repo-pattern.mjs doctor --target /path/to/project
```

Migration archives old local Claude runtime surfaces before writing the minimal setup.

## Advanced: cleanup only

```bash
node scripts/repo-pattern.mjs cleanup --target /path/to/project
```

Cleanup is a low-level recovery command. It removes or archives:

- `.specify`
- unmanaged `.claude/skills`
- `.claude/commands`
- `.claude/hooks`
- `.claude/scripts`
- `.claude/rules`
- non-empty hooks in `.claude/settings.json`
- machine-local `.claude/settings.local.json`


## Claude Code settings policy

`repo-pattern` keeps shared Claude Code settings safe and minimal. The tracked source template is:

```text
.claude/settings.example.json
```

It is copied to targets as local ignored project settings:

```text
.claude/settings.json
```

Default policy:

- `permissions.allow` starts empty
- dangerous shell commands are placed in `permissions.ask`
- common secrets are blocked in `permissions.deny`
- `hooks` stays `{}`
- `enabledMcpjsonServers` is synced from the selected MCP profile
- personal preferences stay in `.claude/settings.local.json`

`repo-pattern mcp` regenerates `.mcp.json` and updates `.claude/settings.json` so `enabledMcpjsonServers` matches the active profile.

## MCP profiles

```bash
node scripts/repo-pattern.mjs mcp --target /path/to/project --profile web
```

Available profiles:

- `minimal`
- `web`
- `backend`
- `research`
- `full`
- `custom` (setup only; choose exact MCP servers)

The default profile is `web`.

## ECC setup

`setup` runs ECC setup automatically.

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

`repo-pattern` itself never copies ECC skills, commands, hooks, or scripts into the target project. Project rules are opt-in and limited to `.claude/rules/ecc/`.

## Target structure after setup

```text
target-project/
├── CLAUDE.md
├── .claude/
│   ├── CLAUDE.md
│   └── settings.json
├── .repo-pattern.json
└── .repo-pattern.lock.json
```

Generated local files:

```text
.mcp.json
.claude/settings.local.json  # setup only
```

`.mcp.json` is intentionally gitignored by default because it is generated from profiles. `setup` writes `.claude/settings.local.json` from your prompted provider/model values and adds it to the target `.gitignore`.

## Commands

```bash
node scripts/repo-pattern.mjs setup --target .
node scripts/repo-pattern.mjs setup --target . --profile web --yes

# advanced/manual
node scripts/repo-pattern.mjs mcp --target . --profile web
node scripts/repo-pattern.mjs ecc --target .
node scripts/repo-pattern.mjs rules --target .
node scripts/repo-pattern.mjs audit --target .
node scripts/repo-pattern.mjs doctor --target .
node scripts/repo-pattern.mjs cleanup --target .
```

Optional rules flag for scriptable `setup`:

```bash
--with-rules
```

All mutating commands support:

```bash
--dry-run
```

## Design rule

`repo-pattern` is setup infrastructure only.

After setup, use ECC as the workflow layer inside Claude Code.
