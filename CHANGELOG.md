# Changelog

## [0.3.0] - 2026-08-04

### Changed

- Replace the legacy filesystem, GitNexus, and sequential-thinking MCP servers with Graphify in every profile.
- Generate and validate the local code-only Graphify graph at `graphify-out/graph.json`; Graphify requires `uv` and Python 3.10+ but no API key.
- Reject unsafe Graphify output symlinks and tracked graph files, restore MCP state after failed generation, and make Doctor verify profile order, graph integrity, executable availability, and exact Graphify configuration.

## [0.2.11] - 2026-08-03

### Fixed

- Keep CI output fully durable and ANSI-free, including setup summaries.
- Isolate interactive output tests from the ambient `CI` environment.

## [0.2.10] - 2026-08-03

### Fixed
+
- Use durable setup progress, rather than interactive terminal spinners, when `CI` is set.

## [0.2.9] - 2026-08-03

**Interactive setup now shows three concise group spinners, then one clear result.**
**Dry runs preview the same plan without touching the target project.**

After confirming an interactive setup, users now see three group spinners—ECC & gstack, Extended skills, and Setup—followed by a compact completion panel. Setup still creates the same workspace, validates it with Doctor, preserves backups and rollback, and keeps verbose output for `--yes`, noninteractive, and redirected runs. Interactive failures stop the affected group before showing the cause, rollback result, backup path when available, and recovery steps.

### The setup numbers that matter

These checks come from the reproducible `npm test` self-check suite, including `scripts/self-check/interactive-provision.mjs` and `scripts/self-check/progress.mjs`.

| Metric | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Interactive progress groups after confirmation | multiple durable outputs | 3 | grouped |
| Completion-panel fields | expanded setup details | 3 required, 1 optional warning | compact |
| Interactive dry-run filesystem writes | 0 | 0 | 0 |
| Terminal streams required for ANSI output | 1 | 2 | +1 |

The setup screen now stays focused while preserving the diagnostics needed to recover from a failed run. A dry run follows the full setup plan and labels each operation as a preview.

### What this means for repo-pattern users

Interactive setup is easier to follow, especially for ECC, optional skills, and gstack pipelines that used to produce several status panels. Use `repo-pattern setup` normally. Use `--dry-run` to inspect the complete plan without creating files.

### Itemized changes

### Changed

- Show confirmed interactive setup as three Clack group spinners—`ECC & gstack`, `Extended skills`, and `Setup`—followed by a compact `Setup complete` panel.
- Keep verbose setup, MCP, ECC, gstack, backup, and Doctor output for `--yes`, CI, noninteractive, and redirected execution.
- Require both standard input and standard output to be TTYs before emitting ANSI control sequences.

### Fixed

- Preserve full interactive dry-run progress while preventing filesystem writes and false backup-created messages.
- Stop group spinners before failure diagnostics, rollback results, backup locations, and recovery guidance.
- Persist successful setup status before rendering the visible success panel.
- Reject destination symlinks during recursive copies so setup cannot write outside the target workspace.
- Avoid duplicate durable `100%` progress lines when file copies finish.

## [0.2.8] - 2026-08-01

**New workspaces start without an arbitrary subagent session ceiling.**

Fresh `repo-pattern setup` runs no longer write a default `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` value. Claude Code can use its own session behavior unless the user chooses an explicit limit. Existing generated settings are not migrated, and setup still preserves user-provided values.

### The setup numbers that matter

These figures come from `.claude.example/settings.local.example.json` and the reproducible `npm test` self-check suite.

| Metric | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Default subagent session limit | 4 | unset | removed |
| Explicit override scenarios preserved | 3 | 3 | 0 |
| Test line coverage | 100% | 100% | 0 |

The template drops one default without removing the supported setting. Users who need a fixed cap can still configure one explicitly.

### What this means for repo-pattern users

New projects no longer inherit a four-subagent session ceiling from repo-pattern. Run `repo-pattern setup` normally, or set `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` yourself when your workflow needs a specific limit.

### Itemized changes

### Changed

- Removed the default `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` value from new local settings templates.
- Preserved explicit user-provided session limits during setup and retries.

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
