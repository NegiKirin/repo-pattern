# repo-pattern

<p align="center">
  <img alt="Repo Pattern" src="https://img.shields.io/badge/repo--pattern-ECC--first-blue">
  <img alt="Claude Code" src="https://img.shields.io/badge/Claude%20Code-ready-black">
  <img alt="MCP Profiles" src="https://img.shields.io/badge/MCP-profiles-green">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-lightgrey">
</p>

**A clean Claude Code setup and migrator in one command.**

`repo-pattern` initializes or migrates a project into an ECC-first (Everything Claude Code) workspace with safe defaults, MCP profiles, and zero vendored runtime clutter.

## Why use it?

- **Start fast** — generate `.claude/`, `.mcp.json`, and repo-pattern metadata.
- **Stay clean** — no local skills, commands, hooks, scripts, or duplicated templates by default.
- **Use MCP profiles** — choose `minimal`, `web`, `backend`, `research`, `full`, or `custom`.
- **ECC-first** — `setup` runs or attempts Everything Claude Code setup automatically.
- **Migrate safely** — audit, cleanup, doctor, and `setup --migrate` are built in.

## Install

Configure GitHub Packages once for the `@negikirin` scope:

```bash
npm config set @negikirin:registry https://npm.pkg.github.com
```

If GitHub Packages requires auth, login with a GitHub token that has `read:packages`:

```bash
npm login --scope=@negikirin --auth-type=legacy --registry=https://npm.pkg.github.com
```

Use directly with `npx`:

```bash
npx @negikirin/repo-pattern setup --profile web --yes
```

Or install the CLI:

```bash
npm install -g @negikirin/repo-pattern
repo-pattern setup --profile web --yes
```

By default, commands target the current directory. To work on another project, add `--target /path/to/project`.

## Quick start

Interactive setup:

```bash
repo-pattern setup
```

Scriptable setup:

```bash
repo-pattern setup --profile web --yes
```

Migrate an existing project:

```bash
repo-pattern audit
repo-pattern setup --profile web --migrate --yes
repo-pattern doctor
```

## Commands

| Command | Purpose |
| --- | --- |
| `repo-pattern help` | Show CLI help. |
| `repo-pattern setup` | Initialize or migrate a Claude Code setup. |
| `repo-pattern audit` | Inspect current Claude Code/ECC state. |
| `repo-pattern doctor` | Validate the generated setup. |
| `repo-pattern mcp --profile web` | Regenerate `.mcp.json` from an MCP profile. |
| `repo-pattern rules` | Apply or refresh project-local ECC rules. |
| `repo-pattern cleanup` | Archive old local Claude runtime surfaces. |
| `repo-pattern ecc` | Run or attempt ECC setup manually. |

Common options:

```bash
--target /path/to/project  # default: current directory
--profile web              # default MCP profile
--with-rules               # opt in to .claude/rules/ecc
--migrate                  # take over legacy/local Claude runtime surfaces
--dry-run                  # preview mutating commands
--yes                      # non-interactive setup
```

## MCP profiles

| Profile | Use when |
| --- | --- |
| `minimal` | You want only essential docs/filesystem tooling. |
| `web` | You build web apps and want browser/docs helpers. |
| `backend` | You focus on server-side projects. |
| `research` | You need search and extraction tooling. |
| `full` | You want every bundled MCP server enabled. |
| `custom` | You want to choose exact MCP servers interactively; not available with `--yes`. |

When selected, Context7 and Tavily prompts include dashboard links for getting API keys.

## What it creates

```text
target-project/
├── CLAUDE.md                     # created empty if missing
├── .claude/
│   ├── CLAUDE.md
│   ├── settings.json             # copied from example, gitignored
│   └── settings.local.json       # when local settings are provided, gitignored
├── .mcp.json                     # generated, gitignored
├── .repo-pattern.json
└── .repo-pattern.lock.json
```

`repo-pattern` preserves an existing root `CLAUDE.md` and keeps machine-local values out of git.

## Safety defaults

- `.mcp.json` is gitignored because it may contain local values.
- `.claude/settings.local.json` is gitignored.
- `.claude/settings.json` keeps `hooks: {}` by default.
- No vendored ECC skills, commands, hooks, scripts, or rules are installed unless explicitly requested.
- Karpathy-inspired Claude Code guidelines are included in `.claude/CLAUDE.md` from `multica-ai/andrej-karpathy-skills` (MIT).
- Optional external skills are user opt-in only: `--with-skill taste`, `--with-skill document-specialist`, or interactive setup.

## External guidance and skills

| Name | Integrated as | Source | License |
| --- | --- | --- | --- |
| `karpathy-guidelines` | Built-in `.claude/CLAUDE.md` guidance | https://github.com/multica-ai/andrej-karpathy-skills | MIT |
| `taste` | Optional `.claude/skills/` install via `--with-skill taste` | https://github.com/Leonxlnx/taste-skill/ | MIT |
| `document-specialist` | Optional `.claude/skills/` install via `--with-skill document-specialist` | https://github.com/SpillwaveSolutions/document-specialist-skill/ | NOASSERTION — no upstream license declared during review on 2026-07-06 |

## Learn more

Full setup details live in [docs/repo-pattern/setup-guide.md](docs/repo-pattern/setup-guide.md).
Third-party license notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

From a source checkout, replace `repo-pattern` with:

```bash
node scripts/repo-pattern.mjs
```
