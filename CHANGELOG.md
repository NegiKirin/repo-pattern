# Changelog

## [0.2.4] - 2026-07-31

**Setup progress is now visible from start to finish.**  
**Resource-heavy setup work reports real progress instead of waiting silently.**

Setup now shows weighted progress for workspace generation, MCP configuration, ECC, gstack, local skills, and migration backups. Interactive terminals get updating progress bars, while logs and CI receive durable milestone lines. Git downloads expose their current phase without claiming completion before the process exits. Rollback, dry-run output, diagnostics, and credential isolation remain unchanged.

### The setup numbers that matter

These figures come from the reproducible `npm test` self-check suite on this branch.

| Metric | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Setup progress stages | 0 | 5 | +5 |
| Durable progress milestones | 0 | 5 | +5 |
| Runtime dependencies | 1 | 1 | 0 |

The setup command now tells you whether it is preparing, copying, downloading, or finalizing. It also keeps dry runs free of dynamic progress output.

### What this means for repo-pattern users

Long setup operations are observable in terminals, CI logs, and redirected output. Failures still report diagnostics and preserve transactional rollback. Run `repo-pattern setup` to see the progress reporting.

### Itemized changes

### Added

- Added shared percentage progress reporting with interactive ANSI bars and durable non-TTY milestones.
- Added streaming Git progress parsing for clone, fetch, and pull operations.
- Added progress-aware file scans, copies, and migration backups.

### Changed

- Added weighted setup progress across workspace and MCP generation, ECC, gstack, local skills, and backups.
- Kept plugin-only skills and resource-free operations free of fake progress bars.

### Fixed

- Preserved rollback, dry-run behavior, redacted diagnostics, security boundaries, and credential isolation while resource operations report progress.
