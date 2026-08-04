# Third-party notices

## ECC

repo-pattern integrates with ECC (Everything Claude Code) by referencing the official ECC plugin and, when explicitly requested by the user, syncing ECC rule packs and agent definitions from the upstream repository.

Source: https://github.com/affaan-m/ECC  
License: MIT  
Copyright (c) 2026 Affaan Mustafa

repo-pattern synchronizes only ECC rule packs and `agents/**` when rules are enabled. It does not vendor ECC skills, `.agents`, commands, hooks, or scripts.

## gstack

repo-pattern can provision a project-local gstack checkout when explicitly selected with `--setup-pipeline gstack`.

Source: https://github.com/garrytan/gstack
License: MIT

repo-pattern does not vendor gstack. It reuses or copies a valid checkout, or shallow-clones one into the target's `.claude/skills/gstack/`; runtime state is stored in `.repo-pattern/gstack/`. It never runs upstream `gstack/setup` or modifies global gstack state.

## Graphify

repo-pattern installs Graphify's MCP tool through `uv` and generates a code-only local graph in the target project. It does not vendor Graphify or send the graph to a remote service.

Source: https://github.com/Graphify-Labs/graphify
License: Apache-2.0

## Karpathy-inspired guidelines

repo-pattern includes Claude Code behavioral guidelines from `multica-ai/andrej-karpathy-skills` in `.claude/CLAUDE.md`.

- Source: https://github.com/multica-ai/andrej-karpathy-skills
- License: MIT

## Optional external skills

Optional skills are not bundled with repo-pattern. When explicitly selected by the user, repo-pattern downloads them from their upstream repositories into the target project's `.claude/skills/` directory.

### taste-skill

- Source: https://github.com/Leonxlnx/taste-skill/
- License: MIT
- Copyright (c) 2026 Leonxlnx

### document-specialist-skill

- Source: https://github.com/SpillwaveSolutions/document-specialist-skill/
- License: NOASSERTION — no license was declared in the visible repository metadata during review on 2026-07-06. Use only when you accept that upstream source.

### ui-ux-pro-max

- Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/
- License: MIT
- Copyright (c) 2024 Next Level Builder

### impeccable

- Source: https://github.com/pbakaus/impeccable/
- License: Apache-2.0
- Copyright 2025 Paul Bakaus

### huashu-design

- Source: https://github.com/alchaincyf/huashu-design/
- License: MIT
- Copyright (c) 2026 alchaincyf (花叔 · 花生)

### nextjs-pattern

- Source: https://github.com/NegiKirin/nextjs-pattern/
- License: MIT

### fastapi-pattern

- Source: https://github.com/NegiKirin/fastapi-pattern/
- License: MIT

### Herdr

- Source: https://github.com/ogulcancelik/herdr/
- License: AGPL-3.0-or-later or commercial
- Copyright (c) 2025 Ogulcan Celik and contributors
