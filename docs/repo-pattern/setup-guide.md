# Repo Pattern Setup Guide

This guide focuses on the normal path:

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

`repo-pattern` is intentionally not a Claude runtime pack. It does not install local Claude skills, commands, hooks, scripts, or rules into the target project. ECC provides the workflow surface through plugin-managed runtime.

---

## 1. One-step setup for a new project

Run from the `repo-pattern` repository:

```bash
node scripts/repo-pattern.mjs init --target /path/to/project --profile web
```

Example:

```bash
node scripts/repo-pattern.mjs init --target ~/Code/my-app --profile web
```

For most projects, this is the only command you need.

---

## 2. What `init` does

`init` runs the full setup flow:

```text
1. Audit the target project.
2. Create minimal `.claude/` setup.
3. Create empty root `CLAUDE.md` if missing. If it already exists, keep it unchanged.
4. Write `.claude/CLAUDE.md` if missing.
5. Write `.claude/settings.json`.
6. Write `.claude/settings.local.example.json`.
7. Copy MCP profiles and server definitions.
8. Generate `.mcp.json` from the selected profile.
9. Write `.mcp.json.example`.
10. Write `.repo-pattern.json`.
11. Write `.repo-pattern.lock.json`.
12. Run or attempt ECC setup flow.
13. Run doctor.
```

After setup, the target project should contain:

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


`repo-pattern init` writes a shared project settings file:

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

Local preferences should go in:

```text
.claude/settings.local.json
```

Do not commit that file. Commit only:

```text
.claude/settings.local.example.json
```

## 10. Repo-pattern commands

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
local Claude runtime surfaces are absent
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

## 11. Recommended flows

### New web/full-stack project

```bash
node scripts/repo-pattern.mjs init --target ~/Code/my-app --profile web
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

## 12. Summary

For normal usage:

```bash
node scripts/repo-pattern.mjs init --target /path/to/project --profile web
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
