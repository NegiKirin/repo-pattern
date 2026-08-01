# Changelog

## [0.2.7] - 2026-08-01

**Interactive setup progress now stays ordered and readable from start to finish.**

### Changed

- Predeclare setup operations in plan order so every progress row remains stable while work runs concurrently.
- Keep completed, failed, and skipped operations visible in one multiline live region, with Setup as the final row.
- Preserve durable milestone output, weighted aggregate progress, rollback behavior, and existing setup APIs.

### Tests

- Added regression coverage for ordered rows, terminal states, live-region redraw and flush behavior, throttling, weighted progress, and late updates.

## [0.2.6] - 2026-07-31

**Interactive provider defaults are easier to replace without accidental edits.**

### Changed

- Show Anthropic URL and model defaults as placeholders in fresh interactive setup, so users can type replacements directly or press Enter to accept the defaults.
- Preserve valid provider values as editable inputs on reruns while falling back to placeholders for empty or invalid values.
- Keep `ANTHROPIC_AUTH_TOKEN` masked and preserve non-interactive `setup --yes` behavior.

### Tests

- Added self-check coverage for fresh placeholders, valid rerun values, invalid persisted values, and empty-input fallback resolution.
- Corrected the package version to npm-compatible SemVer for release publication.

## [0.2.5] - 2026-07-31

**Setup output now stays readable when progress meets diagnostics.**
**Interactive progress bars close cleanly before ordinary terminal output.**

The setup command now terminates an active ANSI progress line before backups, warnings, summaries, cleanup messages, and other regular output. This keeps diagnostics and progress visually separate in interactive terminals without changing non-interactive output, dry-run behavior, rollback, or credential handling.

### The setup numbers that matter

These figures come from the reproducible `npm test` self-check suite on this branch.

| Metric | Before | After | Δ |
| --- | ---: | ---: | ---: |
| ANSI output boundary regressions covered | 0 | 2 | +2 |
| Runtime dependencies | 1 | 1 | 0 |

The progress bar no longer runs directly into the next log message. Run `npm test` to verify the boundary checks.

### What this means for repo-pattern users

Interactive setup logs remain readable when progress updates are followed by warnings or summaries. No configuration change is required. Run `repo-pattern setup` as usual.

### Itemized changes

### Fixed

- Closed active ANSI progress output before unrelated terminal messages and summaries.
- Added regression coverage for interleaved output and aggregate completion rendering.

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
