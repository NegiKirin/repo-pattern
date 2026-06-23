# CLAUDE.md

This repository is a minimal ECC-first Claude Code initializer and migrator.

## Role

`repo-pattern` should initialize or migrate another project into a clean Claude Code setup.

It should not act as a Claude runtime pack.

## Do not add these by default

- `.claude/skills`
- `.claude/commands`
- `.claude/hooks`
- `.claude/scripts`
- `.claude/rules`
- `.specify`

## Main command

```bash
node scripts/repo-pattern.mjs init --target /path/to/project --profile web
```

`init` must run or attempt ECC setup automatically.

## Safety

- Never commit `.claude/settings.local.json`.
- Never hardcode machine paths in `.mcp.json`.
- Keep `.claude/settings.json` with `hooks: {}`.
- Do not vendor ECC skills, commands, hooks, scripts, or rules.


## Setup guide

See `docs/repo-pattern/setup-guide.md` for one-step setup, MCP profile selection, setup flow, and repo-pattern commands.


## Template policy

Do not reintroduce a duplicated `templates/` folder.

Canonical files used by `init` live directly in:

```text
.claude/
docs/
mcp/
```

The target root `CLAUDE.md` is created empty when missing and preserved when it already exists.
