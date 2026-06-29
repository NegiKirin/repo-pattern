# Repo Pattern Setup Guide

This guide focuses on the guided terminal path:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project
```

Use `setup` when you want an arrow-key UI for profile choice, optional extra skills, migration safety, and confirmation.

Use scriptable `init` when you already know the exact options:

```bash
node scripts/repo-pattern.mjs init --target /path/to/project --profile web
```

Use this when you want to initialize a new project with:

```text
minimal Claude Code setup
+ ECC setup flow
+ MCP profile
+ generated .mcp.json
+ repo-pattern metadata
```

`repo-pattern` is intentionally not a Claude runtime pack. It does not install local Claude skills, commands, hooks, scripts, or rules by default. Explicitly selected extra skills are the only exception. ECC provides the workflow surface through plugin-managed runtime.

---


## GitHub Packages publishing

The repository includes:

```text
.github/workflows/nodejs-package.yml
```

Create a GitHub Release to trigger publishing.

The workflow publishes to GitHub Packages with:

```text
registry-url: https://npm.pkg.github.com/
NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Because GitHub Packages only supports scoped npm package names, the workflow temporarily changes the package name during CI to:

```text
@<github-owner>/repo-pattern
```

The source `package.json` remains:

```json
{
  "name": "repo-pattern"
}
```

## NPX package usage

When published to npm, `repo-pattern` can be used without cloning the repository:

```bash
npx repo-pattern init --target . --profile web
```

The package exposes one CLI binary:

```text
repo-pattern
```

Local package test before publishing:

```bash
npm pack
npm exec --yes --package ./repo-pattern-0.0.2.tgz -- repo-pattern --help
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
node scripts/repo-pattern.mjs init --target ~/Code/my-app --profile web --no-extra-skills
```

Setup first checks `claude --version`, then uses a library-backed terminal wizard. It asks for Anthropic provider/model values and writes them to the target's gitignored `.claude/settings.local.json`.

Keys:

```text
↑ / ↓       move
Space       toggle optional skills
Enter       confirm current step
Esc/Ctrl+C  cancel
```

For non-interactive scripts, use `init` instead of `setup`.

---

## 2. What `init` does

`init` runs the full setup flow:

```text
1. Audit the target project.
2. Create minimal `.claude/` setup.
3. Create empty root `CLAUDE.md` if missing. If it already exists, keep it unchanged.
4. Write `.claude/CLAUDE.md` if missing.
5. Write `.claude/settings.json` from `.claude/settings.example.json`.
6. Write `.claude/settings.local.example.json`.
7. During `setup`, write gitignored `.claude/settings.local.json` from prompted provider/model values.
8. Copy MCP profiles and server definitions.
9. Generate `.mcp.json` from the selected profile.
10. Write `.mcp.json.example`.
11. Write `.repo-pattern.json`.
12. Write `.repo-pattern.lock.json`.
13. Run or attempt ECC setup flow.
14. Apply ECC rules.
15. Offer optional extra skills.
16. Run doctor.
```

After setup, the target project should contain:

```text
target-project/
├── CLAUDE.md
├── .claude/
│   ├── CLAUDE.md
│   ├── settings.json
│   ├── settings.local.example.json
│   └── settings.local.json  # setup only, gitignored
├── mcp/
│   ├── profiles/
│   └── servers/
├── docs/
│   └── repo-pattern/
│       ├── workflow.md
│       └── setup-guide.md
├── .mcp.json
├── .mcp.json.example
├── .repo-pattern.json
└── .repo-pattern.lock.json
```

## Root `CLAUDE.md` policy

`repo-pattern init` creates the target project's root `CLAUDE.md` as an empty file when it is missing.

If the target project already has `CLAUDE.md`, `repo-pattern init` leaves it unchanged.

This keeps root `CLAUDE.md` reserved for project-specific instructions instead of copying repo-pattern's own instructions into every target project.

The target project should not contain these by default:

```text
.specify/
.claude/skills/
.claude/commands/
.claude/hooks/
.claude/scripts/
.claude/rules/
```

Exception: `init` may create `.claude/skills/<id>` only when the user explicitly selects a known extra skill.

---

## 3. MCP profiles

MCP config is generated from a profile.

Default profile:

```text
web
```

Select a profile with:

```bash
node scripts/repo-pattern.mjs init --target /path/to/project --profile <profile>
```

or regenerate later:

```bash
node scripts/repo-pattern.mjs mcp --target /path/to/project --profile <profile>
```

---

## 4. Profile: `minimal`

```bash
node scripts/repo-pattern.mjs init --target /path/to/project --profile minimal
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
node scripts/repo-pattern.mjs init --target /path/to/project --profile web
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
node scripts/repo-pattern.mjs init --target ~/Code/my-app --profile web
```

---

## 6. Profile: `backend`

```bash
node scripts/repo-pattern.mjs init --target /path/to/project --profile backend
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
node scripts/repo-pattern.mjs init --target /path/to/project --profile research
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

## 8. Profile: `full.local.example`

```bash
node scripts/repo-pattern.mjs init --target /path/to/project --profile full.local.example
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


## 9. Claude Code settings


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


`repo-pattern init` writes a shared project settings file from `.claude/settings.example.json`:

```text
.claude/settings.json
```

This file is intentionally safe by default:

```text
permissions.allow = []
permissions.ask   = dangerous shell operations
permissions.deny  = common secrets and credential files
hooks             = {}
```

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
ANTHROPIC_BASE_URL
ANTHROPIC_AUTH_TOKEN
ANTHROPIC_DEFAULT_OPUS_MODEL
ANTHROPIC_DEFAULT_SONNET_MODEL
ANTHROPIC_DEFAULT_HAIKU_MODEL
ANTHROPIC_DEFAULT_FABLE_MODEL
```

Do not commit that file. Commit only:

```text
.claude/settings.local.example.json
```

## 10. Optional extra skills

During `setup`, repo-pattern shows a checkbox selector for optional target-local skills. Use Space to toggle and Enter to continue. Scriptable `init` can still use `--extra-skill` or `--no-extra-skills`.

Available extras:

```text
taste-skill                MIT      frontend/UI taste rules
documentation-specialist   unknown  documentation generation; requires license-risk confirmation
```

Non-interactive examples:

```bash
node scripts/repo-pattern.mjs init --target . --profile web --no-extra-skills
node scripts/repo-pattern.mjs init --target . --profile web --extra-skill taste-skill
node scripts/repo-pattern.mjs init --target . --profile web --extra-skill documentation-specialist --yes-extra-skill-license-risk
```

Selected extras are cloned into:

```text
.claude/skills/<id>/
```

They are recorded in `.repo-pattern.lock.json`. Unknown or unrecorded local skills still fail `doctor`.

---

## 11. Repo-pattern commands

### `setup`

Guided terminal setup.

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project
```

Behavior:

```text
EMPTY/PARTIAL       → recommends init
LEGACY_VENDOR       → recommends migrate and requires confirmation
ECC_NATIVE_MINIMAL  → offers doctor, MCP regeneration, or exit
```

Requires an interactive terminal. Use ↑/↓ to move, Space to toggle skills, Enter to confirm. It writes `.claude/settings.local.json` and adds that path to the target `.gitignore`. Use `init` for CI/scripts.

---

### `init`

Initialize a new project.

```bash
node scripts/repo-pattern.mjs init --target /path/to/project --profile web
```

This is the main command.

It performs:

```text
minimal Claude setup
MCP generation
ECC setup flow
ECC rules sync
optional extra skill selection
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
.repo-pattern.json is valid
ECC setup status is recorded
```

Run this after setup or after changing MCP profiles.

---

### `migrate`

Migrate an existing project with older Claude Code setup.

```bash
node scripts/repo-pattern.mjs migrate --target /path/to/project --profile web
```

Use this only when the project already has legacy local Claude setup such as:

```text
.claude/skills/
.claude/commands/
.claude/hooks/
.claude/scripts/
.claude/rules/
.specify/
```

Migration backs up old files before replacing them with the minimal ECC-first setup.

---

### `cleanup`

Remove old local Claude runtime surfaces.

```bash
node scripts/repo-pattern.mjs cleanup --target /path/to/project
```

Use this when you only want to clear old setup before running `init`.

---

### `ecc`

Run or print ECC setup instructions.

```bash
node scripts/repo-pattern.mjs ecc --target /path/to/project
```

Usually not needed because `init` already runs ECC setup flow.

---

## 12. Recommended flows

### New web/full-stack project

```bash
node scripts/repo-pattern.mjs setup --target ~/Code/my-app
```

### New backend project

```bash
node scripts/repo-pattern.mjs init --target ~/Code/my-api --profile backend
```

### Minimal project

```bash
node scripts/repo-pattern.mjs init --target ~/Code/my-tool --profile minimal
```

### Research-heavy project

```bash
node scripts/repo-pattern.mjs init --target ~/Code/my-research --profile research
```

### Existing project with old setup

```bash
node scripts/repo-pattern.mjs audit --target ~/Code/old-project
node scripts/repo-pattern.mjs migrate --target ~/Code/old-project --profile web
node scripts/repo-pattern.mjs doctor --target ~/Code/old-project
```

### Change MCP profile later

```bash
node scripts/repo-pattern.mjs mcp --target ~/Code/my-app --profile research
node scripts/repo-pattern.mjs doctor --target ~/Code/my-app
```

---

## 13. Summary

For normal usage:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project
```

For scripted usage:

```bash
node scripts/repo-pattern.mjs init --target /path/to/project --profile web --no-extra-skills
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

`repo-pattern` automatically selects ECC rule packs from the target project's stack and applies them to project scope.

No extra mode or scope arguments are needed:

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

`init` runs this rules step automatically after ECC setup and before doctor.
