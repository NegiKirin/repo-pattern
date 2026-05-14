# repo-pattern

![Claude Code](https://img.shields.io/badge/Claude%20Code-ready-6C47FF)
![MCP](https://img.shields.io/badge/MCP-configured-0EA5E9)
![Spec Kit](https://img.shields.io/badge/Spec%20Kit-included-10B981)
![Template](https://img.shields.io/badge/repository-template-F59E0B)
![Project Rules](https://img.shields.io/badge/project-rules%20%26%20skills-64748B)

A polished starter repository for teams that want **Claude Code**, **MCP servers**, **Spec Kit workflows**, and **project-local rules/skills** ready from day one.

This is a **repository pattern**, not an application scaffold. Copy it into a new project, then tailor the instructions, tools, and workflow to your real stack.

## What you get

- **Project-local Claude setup** in [`.claude/`](.claude/)
- **MCP server configuration** in [`.mcp.json`](.mcp.json)
- **Spec Kit workflow assets** in [`.specify/`](.specify/)
- **Reusable rules and skill packs** versioned inside the repo
- **Onboarding documentation** in [docs/](docs/)

## Core building blocks

### Claude workspace

The [`.claude/`](.claude/) directory contains the collaboration layer for the repo:

- [`.claude/CLAUDE.md`](.claude/CLAUDE.md) — project instructions
- [`.claude/rules/`](.claude/rules/) — coding, testing, security, workflow, and web rules
- [`.claude/skills/`](.claude/skills/) — local skill definitions
- [`.claude/commands/`](.claude/commands/) — command content for the workspace
- [`.claude/scripts/`](.claude/scripts/) — helper scripts

### MCP configuration

The root [`.mcp.json`](.mcp.json) is pre-wired for a practical MCP toolchain:

- `context7` — live library and framework documentation
- `gitnexus` — repository graph and impact analysis
- `tavily` — web research and extraction
- `sequential-thinking` — structured reasoning support
- `playwright` — browser automation and E2E validation

Keep only the servers your target repository actually needs.

### Spec Kit workflow

This repo includes [`.specify/`](.specify/) out of the box, including:

- [`.specify/workflows/speckit/workflow.yml`](.specify/workflows/speckit/workflow.yml) — full specify → plan → tasks → implement flow
- [`.specify/extensions/git/`](.specify/extensions/git/) — optional Git-aware Spec Kit extension

This means the template is meant to be **adapted**, not initialized again from scratch.

### Rules and conventions

The rules system under [`.claude/rules/`](.claude/rules/) is layered:

- `common/` for cross-project defaults
- language/domain-specific rule sets such as `typescript/` and `web/`

See [`.claude/rules/README.md`](.claude/rules/README.md) for the full model.

## Repository map

```text
repo-pattern/
├── .claude/
│   ├── CLAUDE.md
│   ├── commands/
│   ├── rules/
│   ├── scripts/
│   └── skills/
├── .specify/
│   ├── extensions/
│   └── workflows/
├── docs/
├── .mcp.json
├── CLAUDE.md
└── README.md
```

## When to use this template

Use this repository when you want to:

- bootstrap a new repo with Claude Code conventions already in place
- standardize AI-assisted workflow across multiple repositories
- keep repo-specific rules and skills under version control
- adopt MCP tooling without rebuilding the same setup every time
- start with a Spec Kit-friendly planning and execution flow

## Recommended adoption flow

1. Copy this repository into your new project.
2. Rewrite [`.claude/CLAUDE.md`](.claude/CLAUDE.md) for the actual project.
3. Review [`.mcp.json`](.mcp.json) and remove unused servers.
4. Trim or extend [`.claude/rules/`](.claude/rules/) to match the stack.
5. Review [`.specify/`](.specify/) and keep it only if Spec Kit fits your process.
6. Replace or extend the docs in [docs/](docs/).

## Customize first

Start with these files:

- [`.claude/CLAUDE.md`](.claude/CLAUDE.md)
- [`.mcp.json`](.mcp.json)
- [`.claude/rules/README.md`](.claude/rules/README.md)
- [`.specify/workflows/speckit/workflow.yml`](.specify/workflows/speckit/workflow.yml)
- [`.specify/extensions/git/README.md`](.specify/extensions/git/README.md)
- [docs/claude-code-mcp-setup-vi.md](docs/claude-code-mcp-setup-vi.md)

## Keep vs customize

### Usually keep

- the overall [`.claude/`](.claude/) structure
- the layered rules model in [`.claude/rules/`](.claude/rules/)
- the general shape of [`.mcp.json`](.mcp.json)
- [`.specify/`](.specify/) if your team uses Spec Kit

### Usually customize

- project instructions in [`.claude/CLAUDE.md`](.claude/CLAUDE.md)
- enabled MCP servers and environment variables in [`.mcp.json`](.mcp.json)
- local rule sets and skill packs
- onboarding docs in [docs/](docs/)

## Notes

- This repository uses [`.specify/`](.specify/), not `openspec/`.
- Some MCP servers require environment variables such as `CONTEXT7_API_KEY` and `TAVILY_API_KEY`.
- Audit every enabled tool before using this template in production work.

## Related docs

- [docs/claude-code-mcp-setup-vi.md](docs/claude-code-mcp-setup-vi.md)
- [`.claude/rules/README.md`](.claude/rules/README.md)
- [`.specify/extensions/git/README.md`](.specify/extensions/git/README.md)

## Summary

`repo-pattern` gives you a clean, opinionated baseline for repositories that want Claude Code, MCP tooling, and Spec Kit workflow support from the start.

Copy it, trim it, and make it specific to the project that will actually use it.
