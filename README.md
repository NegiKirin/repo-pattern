# repo-pattern

A reusable starter pattern for repositories that want to work well with Claude Code, MCP servers, OpenSpec, and custom skill packs.

## Goal

This repository is a template you can copy when starting a new project.
It already includes the basic structure and customizations needed to:

- use Claude Code consistently across repos
- register MCP servers through `.mcp.json`
- work with OpenSpec without re-initializing it
- keep pinned skill sources with `skills-lock.json`
- carry project instructions through `.claude/CLAUDE.md`

## What is already included

### Claude configuration

- [`.claude/`](.claude/) contains Claude-related project files
- [`.claude/CLAUDE.md`](.claude/CLAUDE.md) is used for project instructions and, in this pattern, is tied to `andrej-karpathy-skills`
- [`.claude/commands/`](.claude/commands/) contains custom command files
- [`.claude/skills/`](.claude/skills/) contains locally available skill definitions

### MCP setup

- [`.mcp.json`](.mcp.json) is the MCP server config entrypoint for the repo
- the pattern is intended to work with MCP servers such as `context7`, `gitnexus`, and `web-tools`

### OpenSpec setup

- [`openspec/config.yaml`](openspec/config.yaml) is already present
- OpenSpec in this pattern has already been customized for the skill setup used here
- when using this pattern, you usually do **not** need to run `openspec init` again

### Skills setup

- [`skills-lock.json`](skills-lock.json) pins skill sources and hashes
- this pattern includes skills sourced from `mattpocock/skills`
- the repo also carries local Claude skills under [`.claude/skills/`](.claude/skills/)

### Documentation

- [`docs/claude-code-mcp-setup-vi.md`](docs/claude-code-mcp-setup-vi.md) explains how this overall setup works

## Important customizations in this pattern

### 1. OpenSpec is pre-customized

This pattern is not a raw OpenSpec setup.
It already includes an `openspec/config.yaml` template and is meant to work with the existing skill layout.

If you create a new repo from this pattern:

- update `openspec/config.yaml`
- keep the existing OpenSpec structure unless you intentionally want a different setup
- avoid running `openspec init` unless you want to reset the structure to OpenSpec defaults

### 2. `mattpocock/skills` is already part of the pattern

`skills-lock.json` already pins skills from `mattpocock/skills`.
That means the pattern is designed around those skills being part of the workflow.

### 3. `.claude/CLAUDE.md` is part of the pattern contract

This file is not just a note file.
In this pattern it is part of the intended Claude setup and should be reviewed whenever you adapt the template for a new repo.

## Suggested setup flow for a new repo

1. Copy this pattern into a new repository.
2. Update [`.claude/CLAUDE.md`](.claude/CLAUDE.md) for the new project.
3. Update [`openspec/config.yaml`](openspec/config.yaml) with real project context.
4. Review [`.mcp.json`](.mcp.json) and keep only the MCP servers you actually use.
5. Review [`skills-lock.json`](skills-lock.json) only if you want to change skill sources.
6. Read [`docs/claude-code-mcp-setup-vi.md`](docs/claude-code-mcp-setup-vi.md) for the full setup guide.

## Notes about `web-tools`

If you want to use `web-tools`, the referenced repository is:

```text
https://github.com/huynhkhan123/mcp-web-tools
```

That repository already includes setup instructions.
Use its documented setup first, then update [`.mcp.json`](.mcp.json) with the correct command for your environment.

## What to customize first

When turning this pattern into a real project, the first files you should review are:

- [`.claude/CLAUDE.md`](.claude/CLAUDE.md)
- [`.mcp.json`](.mcp.json)
- [`openspec/config.yaml`](openspec/config.yaml)
- [`skills-lock.json`](skills-lock.json)
- [`docs/claude-code-mcp-setup-vi.md`](docs/claude-code-mcp-setup-vi.md)

## Keep vs change

Usually keep:

- the overall `.claude/` structure
- the OpenSpec layout
- the locked skills setup

Usually change:

- project instructions
- MCP server commands and API keys
- project context in OpenSpec
- any repo-specific docs
