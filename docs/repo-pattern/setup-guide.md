# Repo Pattern Setup Guide

## Setup

Run interactive setup when you want to choose workflow, rules, MCP servers, optional skills, provider settings, effort, permissions, and attribution in one terminal wizard:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project
```

The MCP page starts with the Core servers selected. It groups choices as:

- **Core / Must have:** `context7`, `tavily`, `gitnexus`
- **Development tools:** `chrome-devtools`, `playwright`
- **UI / shadcn:** `shadcn`, `shadcn-studio`

Group headings are labels, not selectable choices. Use `↑`/`↓` to move, `Space` to toggle servers or rules, `Enter` to continue, `←` to go back, and `Esc` or `Ctrl+C` to cancel. An empty MCP selection is valid.

## Scripted setup

`setup --yes` is non-interactive. Without any `--mcp` flags, it uses the Core servers:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project --yes
```

Use repeatable `--mcp` to select exact servers. Repeated names are deduplicated in first-occurrence order.

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project \
  --mcp context7 \
  --mcp playwright \
  --mcp shadcn-studio \
  --setup-pipeline ecc \
  --yes
```

Available setup pipelines:

- `ecc` (default): project-scoped ECC.
- `gstack`: project-local gstack at `.claude/skills/gstack`.
- `both`: ECC plus project-local gstack.
- `none`: base project metadata only.

`gstack` requires Git and Bun v1.0+ on `PATH`. repo-pattern never downloads Bun or runs upstream `gstack/setup`. Setup installs checkout dependencies, builds runtime binaries, installs project-local Playwright Chromium, and probes a local HTML page before promoting the staged checkout. Dependency installation, runtime builds, and Chromium downloads have ten-minute deadlines; runtime probes have thirty-second deadlines.

Use `GSTACK_SKIP_PLAYWRIGHT=1` for an explicit browser-install opt-out. The skipped status is persisted and reported by `doctor`; it does not mean browser workflows are ready. Rerun the same setup command without this environment variable to install and verify Chromium or repair missing dependencies and binaries. Chromium is stored under `.claude/skills/gstack/.repo-pattern-runtime/chromium`, not in a global browser cache.

On Linux, Chromium may require system libraries. Setup reports administrator remediation when they are missing; it never runs `sudo` or installs OS packages. A failed preparation preserves the previously installed checkout and managed wrappers.

## Regenerate MCP configuration

`mcp` regenerates `.mcp.json` and `.claude/settings.json` MCP approvals from only the listed servers:

```bash
node scripts/repo-pattern.mjs mcp --target /path/to/project \
  --mcp context7 --mcp tavily --mcp gitnexus --yes
```

`mcp --yes` without `--mcp` uses the same Core defaults. An invalid name reports all supported server names.

## Credentials

Interactive setup prompts only for placeholders in the selected MCP definitions. `CONTEXT7_API_KEY` and `TAVILY_API_KEY` are stored only as server environment values in gitignored `.mcp.json`; later setup and MCP runs reuse them.

`ANTHROPIC_AUTH_TOKEN` stays in gitignored `.claude/settings.local.json`. It is never substituted into `.mcp.json`, setup retry state, or repo-pattern locks.

## Generated workspace

`setup`:

1. Audits the target.
2. Preserves an existing root `CLAUDE.md` or creates an empty one.
3. Creates `.claude/` from `.claude.example/`.
4. Generates `.mcp.json` and synchronizes `enabledMcpjsonServers`.
5. Writes `.repo-pattern/.repo-pattern.json` and `.repo-pattern/.repo-pattern.lock.json` without credential values.
6. Applies the selected ECC/gstack pipeline, rules, and optional skills.
7. Runs `doctor` after successful setup.

Generated local files are gitignored:

```text
.claude/settings.json
.claude/settings.local.json
.mcp.json
.repo-pattern/.repo-pattern.lock.json
```

## Migration and validation

Inspect an existing project before taking over old Claude runtime surfaces:

```bash
node scripts/repo-pattern.mjs audit --target /path/to/project
node scripts/repo-pattern.mjs setup --target /path/to/project \
  --mcp context7 --mcp tavily --mcp gitnexus --migrate --yes
node scripts/repo-pattern.mjs doctor --target /path/to/project
```

Legacy retry or lock state from earlier releases is rejected before setup writes anything. Rerun setup and choose MCP servers explicitly.

## Optional skills

Interactive setup groups optional skills by design/frontend, project patterns, documentation, and terminal workflow. Select them with the wizard or use scriptable flags:

```bash
node scripts/repo-pattern.mjs setup --target /path/to/project \
  --with-skills taste,nextjs-pattern,herdr --yes
```

Use `repo-pattern help` for the complete option list.
