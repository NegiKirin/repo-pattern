# Repo Pattern Setup Guide

This guide focuses on the guided terminal path:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project
```

Use `setup` when you want an arrow-key UI for profile choice, optional ECC rules, migration safety, and confirmation.

Use scriptable `setup --yes` when you already know the exact options:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project --profile web --yes
```

Use this when you want to initialize a new project with:

```text
minimal Claude Code setup
+ ECC setup flow
+ MCP profile
+ generated .mcp.json
+ repo-pattern metadata
```

`repo-pattern` is intentionally not a Claude runtime pack. It does not install local Claude skills, commands, hooks, scripts, or rules by default. Project-local ECC rules are explicit opt-in via `setup --with-rules`, `rules`, or interactive `setup`. Optional external skills are explicit opt-in via `setup --with-skill <name>` or interactive `setup`.

---


## npmjs publishing

The repository includes:

```text
.github/workflows/nodejs-package.yml
```

Create a GitHub Release to trigger publishing to npmjs. The workflow expects an `NPM_TOKEN` repository secret and publishes with:

```text
registry-url: https://registry.npmjs.org/
NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## NPX package usage

When published to npmjs, `repo-pattern` can be used without cloning the repository:

```bash
npx @negikirin/repo-pattern setup --target . --profile web --yes
```

The package exposes one CLI binary:

```text
repo-pattern
```

Local package test before publishing:

```bash
npm pack
npm exec --yes --package ./repo-pattern-0.1.0.tgz -- repo-pattern --help
```

## 1. One-step setup for a new project

Run from the `repo-pattern` repository:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project
```

Example:

```bash
node scripts/repo-pattern.mjs setup --target ~/Code/my-app
```

For scripts or CI, use the non-interactive path:

```bash
node scripts/repo-pattern.mjs setup --target ~/Code/my-app --profile web --yes
```

Setup first checks `claude --version`, then uses a library-backed terminal wizard. It can auto-detect ECC rules or let you choose rule packs by type, asks for selected MCP API keys/relative paths when needed, then asks for Anthropic provider/model values. It stores `CONTEXT7_API_KEY` and `TAVILY_API_KEY` only in the target's gitignored `.mcp.json`, and stores `ANTHROPIC_AUTH_TOKEN` with the provider/model values in gitignored `.claude/settings.local.json`. Later setup and MCP runs reuse those files.

Keys:

```text
↑ / ↓       move
Space       toggle MCP/rules choices
Enter       confirm current step
Esc/Ctrl+C  cancel
```

For non-interactive scripts, use `setup --yes`.

---

## 2. What `setup` does

`setup` runs the full setup flow:

```text
1. Audit the target project.
2. Create minimal `.claude/` setup.
3. Create empty root `CLAUDE.md` if missing. If it already exists, keep it unchanged.
4. Write `.claude/CLAUDE.md` if missing.
5. Write `.claude/settings.json` from `.claude.example/settings.example.json`.
6. In interactive setup, ask whether commit attribution is off, on, or custom.
7. During interactive `setup`, write `ANTHROPIC_AUTH_TOKEN` and the prompted provider/model values to gitignored `.claude/settings.local.json`; remove `CONTEXT7_API_KEY` and `TAVILY_API_KEY` from that file.
8. Read MCP profiles and server definitions from `repo-pattern`.
9. In interactive mode, reuse `CONTEXT7_API_KEY`/`TAVILY_API_KEY` from gitignored `.mcp.json` or ask for missing MCP API keys and relative paths when placeholders require them.
10. Generate `.mcp.json` from the selected profile, storing entered Context7/Tavily keys as literal server environment values.
11. Write `.repo-pattern/.repo-pattern.json` from `.repo-pattern.example.json`.
12. Create `.repo-pattern/.gitignore` with `*`.
13. Add generated setup files and basic OS/IDE noise to `.gitignore`.
14. Write `.repo-pattern/.repo-pattern.lock.json` without credential values.
15. Run or attempt ECC setup flow.
16. During `setup` with rules enabled, apply ECC rules.
17. Run doctor.
```

After setup, the target project should contain:

```text
target-project/
├── CLAUDE.md
├── .claude/
│   ├── CLAUDE.md
│   ├── settings.json
│   └── settings.local.json  # setup only, gitignored
├── .mcp.json
├── .repo-pattern/
│   ├── .gitignore
│   ├── .repo-pattern.json
│   └── .repo-pattern.lock.json
```

## Root `CLAUDE.md` policy

`repo-pattern setup` creates the target project's root `CLAUDE.md` as an empty file when it is missing.

If the target project already has `CLAUDE.md`, `repo-pattern setup` leaves it unchanged.

This keeps root `CLAUDE.md` reserved for project-specific instructions instead of copying repo-pattern's own instructions into every target project.

The target project should not contain these unmanaged runtime surfaces by default:

```text
.claude/skills/
.claude/commands/
.claude/hooks/
.claude/scripts/
```

Project-local rules are opt-in and limited to repo-pattern-managed `.claude/rules/ecc/`.

Optional external skills are also opt-in. Plugin-ready skills are enabled in `.claude/settings.local.json`; non-plugin skills are copied to repo-pattern-managed `.claude/skills/`:

```bash
repo-pattern setup --with-skill taste --yes
repo-pattern setup --with-skill document-specialist --yes
repo-pattern setup --with-skill ui-ux-pro-max --yes
repo-pattern setup --with-skill impeccable --yes
repo-pattern setup --with-skill huashu-design --yes
repo-pattern setup --with-skill nextjs-pattern --yes
repo-pattern setup --with-skill fastapi-pattern --yes
repo-pattern setup --with-skill herdr --yes
repo-pattern setup --with-skills taste,document-specialist,ui-ux-pro-max,impeccable,huashu-design,nextjs-pattern,fastapi-pattern,herdr --yes
```

Available optional skills:

- `taste` — Claude Code plugin from https://github.com/Leonxlnx/taste-skill/ (MIT).
- `document-specialist` — `.claude/skills/` copy from https://github.com/SpillwaveSolutions/document-specialist-skill/ (license not declared upstream; choose only when you accept that source).
- `ui-ux-pro-max` — Claude Code plugin from https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/ (MIT).
- `impeccable` — Claude Code plugin from https://github.com/pbakaus/impeccable/ (Apache-2.0).
- `huashu-design` — `.claude/skills/` copy from https://github.com/alchaincyf/huashu-design/ (MIT; scripts may need Playwright, Python, and ffmpeg).
- `nextjs-pattern` — `.claude/skills/` copy from https://github.com/NegiKirin/nextjs-pattern/ (MIT).
- `fastapi-pattern` — `.claude/skills/` copy from https://github.com/NegiKirin/fastapi-pattern/ (MIT).
- `herdr` — `.claude/skills/` copy from https://github.com/ogulcancelik/herdr/ (AGPL-3.0-or-later or commercial; control commands require `HERDR_ENV=1` inside a running Herdr session).

---

## 3. MCP profiles

MCP config is generated from a profile. In interactive `setup`, choose `custom` when you want to select exact MCP servers instead of using a preset.

Default profile:

```text
web
```

Select a profile with:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project --profile <profile> --yes
```

or regenerate later:

```bash
node scripts/repo-pattern.mjs mcp --target /path/to/project --profile <profile>
```

Interactive `setup` asks for selected MCP placeholders such as `CONTEXT7_API_KEY` and `TAVILY_API_KEY`, writes entered keys only as literal server environment values in gitignored `.mcp.json`, and reuses them on later `setup` and `mcp` runs. It writes `ANTHROPIC_AUTH_TOKEN` only to gitignored `.claude/settings.local.json`; the token is never substituted into MCP config or written to repo-pattern setup state. Failed setup retries recover credentials from these two files, while the lock stores only non-secret choices and MCP credential names. Setup backups exclude both credential-bearing files. The filesystem MCP server uses the target project root (`.`) as its allowed directory. Other MCP paths, when prompted, must be relative (`src`, `packages/api`); absolute machine paths and `..` are rejected. With `--yes` or non-TTY runs, unresolved secret placeholders stay in `.mcp.json` and the CLI prints the values to fill later.

---

## 4. Profile: `minimal`

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project --profile minimal --yes
```

Enabled servers:

```text
context7
filesystem
```

Use this when:

```text
- you want the smallest setup;
- the project does not need browser automation;
- the project does not need web research tools;
- you want minimal MCP/tooling noise.
```

Best for:

```text
small libraries
backend utilities
CLI tools
simple experiments
```

---

## 5. Profile: `web`

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project --profile web --yes
```

Enabled servers:

```text
context7
filesystem
playwright
chrome-devtools
```

Use this when:

```text
- the project has frontend or browser behavior;
- Claude needs to inspect runtime UI behavior;
- you want browser automation and debugging support;
- you want a strong default for most app projects.
```

Best for:

```text
web apps
full-stack apps
frontend-heavy projects
UI debugging
E2E testing workflows
```

Recommended default:

```bash
node scripts/repo-pattern.mjs setup --target ~/Code/my-app --profile web --yes
```

---

## 6. Profile: `backend`

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project --profile backend --yes
```

Enabled servers:

```text
context7
filesystem
gitnexus
```

Use this when:

```text
- the project is mainly backend;
- codebase structure and impact analysis matter;
- frontend/browser tooling is not needed by default.
```

Best for:

```text
APIs
services
monorepo backend packages
codebase analysis
impact analysis
```

---

## 7. Profile: `research`

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project --profile research --yes
```

Enabled servers:

```text
context7
filesystem
tavily
sequential-thinking
```

Use this when:

```text
- the project needs frequent documentation lookup;
- tasks involve external research;
- implementation decisions need structured reasoning;
- current information is important.
```

Best for:

```text
research-heavy projects
technical investigations
library comparison
architecture exploration
documentation-driven work
```

Required or recommended environment variables:

```bash
export TAVILY_API_KEY="..."
export CONTEXT7_API_KEY="..."
```

---

## 8. Profile: `full`

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project --profile full --yes
```

Enabled servers:

```text
context7
filesystem
playwright
chrome-devtools
gitnexus
tavily
sequential-thinking
```

Use this only when:

```text
- you intentionally want all included example MCP servers;
- you understand the extra tool/context surface;
- you are testing repo-pattern itself.
```

Not recommended as the default for normal projects.

---

## 9. Custom MCP selection

In interactive setup, choose `custom` to select exact MCP servers from the available `mcp/servers/*.json` definitions.

Use this when no preset profile matches the project.

---


## 10. Claude Code settings


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


`repo-pattern setup` writes local ignored project settings from the tracked `.claude.example/settings.example.json` template:

```text
.claude/settings.json
```

The template is intentionally safe by default:

```text
permissions.allow   = []
permissions.ask     = dangerous shell operations
permissions.deny    = common secrets and credential files
hooks               = {}
attribution.commit  = "" (disables Claude Code Co-Authored-By trailers)
```

Interactive setup asks whether commit attribution should be `off`, `on`, or `custom`. `on` leaves Claude Code's default attribution behavior in place; `custom` writes your exact trailer string to `attribution.commit`.

The selected MCP profile is also approved in:

```json
"enabledMcpjsonServers": [...]
```

For example, profile `web` sets:

```json
"enabledMcpjsonServers": [
  "context7",
  "filesystem",
  "playwright",
  "chrome-devtools"
]
```

Local preferences and Anthropic provider/model values should go in:

```text
.claude/settings.local.json
```

`setup` asks for these values and writes the file for you:

```text
ANTHROPIC_AUTH_TOKEN
ANTHROPIC_BASE_URL
ANTHROPIC_DEFAULT_OPUS_MODEL
ANTHROPIC_DEFAULT_SONNET_MODEL
ANTHROPIC_DEFAULT_HAIKU_MODEL
```

`CONTEXT7_API_KEY` and `TAVILY_API_KEY` are stored only in gitignored `.mcp.json`, never in `.claude/settings.local.json`. Do not commit either credential file; `setup` adds `.claude/` and `.mcp.json` to `.gitignore`. Credential values are not written to repo-pattern locks, backups, tracked files, or package files.

## 12. Repo-pattern commands

### `setup`

Guided terminal setup.

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project
```

Behavior:

```text
EMPTY/PARTIAL       → recommends setup
LEGACY_VENDOR       → recommends migrate and requires confirmation
ECC_NATIVE_MINIMAL  → offers doctor, MCP regeneration, or exit
```

Interactive mode uses ↑/↓ to move, Space to toggle MCP/rules choices, Enter to confirm. It writes `.claude/settings.local.json` and adds that path to the target `.gitignore`. Use `setup --yes` for CI/scripts.

---

### `setup --yes`

Initialize a new project non-interactively.

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project --profile web --yes
```

This is the scriptable setup path.

It performs:

```text
minimal Claude setup
MCP generation
ECC setup flow
optional ECC rules sync
doctor check
```

---

### `audit`

Inspect the target project state.

```bash
node scripts/repo-pattern.mjs audit --target /path/to/project
```

Use this before setup when you are unsure whether the project already has Claude Code files.

Possible states:

```text
EMPTY
PARTIAL
ECC_NATIVE_MINIMAL
LEGACY_VENDOR
```

---

### `mcp`

Regenerate `.mcp.json` from a profile.

```bash
node scripts/repo-pattern.mjs mcp --target /path/to/project --profile web
```

Use this when switching profiles.

Example:

```bash
node scripts/repo-pattern.mjs mcp --target ~/Code/my-app --profile research
```

---

### `doctor`

Validate the target project.

```bash
node scripts/repo-pattern.mjs doctor --target /path/to/project
```

Doctor checks that:

```text
unmanaged local Claude runtime surfaces are absent
settings hooks are empty
.mcp.json has no hardcoded machine path
.repo-pattern/.repo-pattern.json is valid
ECC setup status is recorded
```

Run this after setup or after changing MCP profiles.

---

### `cleanup`

Advanced recovery command for removing old local Claude runtime surfaces.

```bash
node scripts/repo-pattern.mjs cleanup --target /path/to/project
```

Use this when you only want to clear old setup before running `setup`.

---

### `ecc`

Advanced/manual command to rerun or print ECC setup instructions.

```bash
node scripts/repo-pattern.mjs ecc --target /path/to/project
```

Usually not needed because `setup` already runs ECC setup flow.

---

### `rules`

Advanced/manual command to apply repo-pattern-managed ECC rules under `.claude/rules/ecc/`.

```bash
node scripts/repo-pattern.mjs rules --target /path/to/project
```

Usually not needed when `setup --with-rules` was used.

---

## 13. Recommended flows

### New web/full-stack project

```bash
node scripts/repo-pattern.mjs setup --target ~/Code/my-app
```

### New backend project

```bash
node scripts/repo-pattern.mjs setup --target ~/Code/my-api --profile backend --yes
```

### Minimal project

```bash
node scripts/repo-pattern.mjs setup --target ~/Code/my-tool --profile minimal --yes
```

### Research-heavy project

```bash
node scripts/repo-pattern.mjs setup --target ~/Code/my-research --profile research --yes
```

### Existing project with old setup

```bash
node scripts/repo-pattern.mjs audit --target ~/Code/old-project
node scripts/repo-pattern.mjs setup --target ~/Code/old-project --profile web --migrate --yes
node scripts/repo-pattern.mjs doctor --target ~/Code/old-project
```

### Change MCP profile later

```bash
node scripts/repo-pattern.mjs mcp --target ~/Code/my-app --profile research
node scripts/repo-pattern.mjs doctor --target ~/Code/my-app
```

---

## 14. Summary

For normal usage:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project
```

For scripted usage:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project --profile web --yes
```

Use another profile only when the project clearly needs it:

```text
minimal  → smallest setup
web      → default app setup
backend  → backend/codebase analysis
research → docs/search/reasoning-heavy work
full     → local testing only
```


## ECC rules auto-cache

ECC rules are opt-in. `repo-pattern` can select ECC rule packs from the target project's stack and apply them to project scope.

Run rules explicitly with:

```bash
node scripts/repo-pattern.mjs rules --target /path/to/project
```

Rules are always installed under:

```text
.claude/rules/ecc/
```

`repo-pattern` does not flatten rules and does not touch custom rules outside the `ecc/` namespace.

The ECC repository is cloned and cached automatically inside the target project:

```text
.repo-pattern/cache/ECC/
```

The first run needs network access. Later runs reuse the cache.

Recommended rules are selected from the official ECC rule packs:

```text
common
typescript
angular
vue
nuxt
python
golang
web
swift
php
ruby
arkts
```

For scriptable setup, use `--with-rules --yes` to run this rules step after ECC setup and before doctor.
