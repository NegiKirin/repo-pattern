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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **repo-pattern** (302 symbols, 510 relationships, 19 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/repo-pattern/context` | Codebase overview, check index freshness |
| `gitnexus://repo/repo-pattern/clusters` | All functional areas |
| `gitnexus://repo/repo-pattern/processes` | All execution flows |
| `gitnexus://repo/repo-pattern/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
