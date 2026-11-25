# Implementation Plan: Managed `commit-msg` Attribution Hook

## Status and provenance

- **Draft only.** This plan does not authorize implementation, commits, pushes, history rewriting, or review execution.
- **Issue:** #107, `https://github.com/NegiKirin/repo-pattern/issues/107`.
- **Canonical archive:** `/home/kirin/Code/my-hobby/repo-pattern/.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/specs/20261125-issue-107-commit-msg-hook.md`.
- GitHub issue and archive are substantively identical; only extraction whitespace differs. The issue is open, has no comments/labels/assignees, and the archive records `spec_executed: false` on `main`.
- This plan records the pre-implementation design. The implementation now exists in the working tree; the plan's proposed file names and readiness notes below are historical unless explicitly updated by the implementation checkpoint.

## Goal and behavior

### User problem

The existing Claude attribution cleanup runs on selected Claude Code Bash commands. It can miss a Claude co-author trailer supplied directly to Git, so attribution mode `off` does not reliably control the message finally recorded in the commit.

### Current behavior observed

- Attribution modes are selected in `src/ui/setup-wizard.mjs:100-101` (verified).
- `src/setup/settings.mjs:10-25` records the managed attribution mode in the generated `PreToolUse` hook entry (verified).
- `.claude.example/hooks/remove-generated-attribution.mjs:19-37` cleans command strings and selected referenced files; it depends on `CLAUDE_PROJECT_DIR` and is not a Git `commit-msg` hook (verified).
- `src/setup/provision.mjs:326-327` writes Claude settings and copies the current hook during setup (verified).
- `src/setup/settings.mjs:82-93` updates attribution settings and copies the current hook after an attribution change (verified).
- The existing setup pipeline accepts `ecc`, `gstack`, `both`, and `none` in `src/setup/provision.mjs:82-97` and `src/setup/setup.mjs:111-118` (verified).

### Proposed behavior

Add a repo-pattern-managed Git `commit-msg` wrapper. It resolves the target repository's effective hooks directory through Git, preserves and composes a pre-existing executable hook, then invokes the managed cleaner against Git's first message-file argument. Runtime mode is read from the explicit repo-pattern-managed attribution metadata in `.claude/settings.json`; only `off` cleans. `on` and `custom` are no-ops. Installation is attempted by all setup pipelines and attribution updates, but non-Git, dry-run, unsafe ownership, or composition conflicts leave existing files unchanged and report unavailable protection.

### Non-goals

- No `/ship` or vendored gstack changes.
- No existing history amendment/rebase/force-push.
- No `pre-push`, CI, server-side, organization-wide, or mandatory enforcement.
- No cleanup of `Generated with`, PR attribution, other AI attribution, or human co-authors.
- No global Git configuration changes.
- No third-party hook-manager rewriting when safe composition is not established.
- No new dependency or test framework.

## Requirement and acceptance matrix

| ID | Source | Expected behavior | Proposed change | Verification | Negative/boundary case | Status |
|---|---|---|---|---|---|---|
| R1 | Issue/SPEC cleaning 1; AC1 | `off` removes recognized Claude co-author lines and permits a valid commit | Implement line-based cleaner and mode gate | Real `git commit` and stored message assertion | Empty result is left for Git to reject; no invented subject | Ready |
| R2 | Cleaning 2; AC2 | `on`/`custom` preserve the message | Read managed mode, return without rewrite | Commit tests for both modes | Empty/malformed mode must error, not silently no-op | Ready |
| R3 | Cleaning 3–5; AC3 | Match only exact field/email and `Claude`/`Claude <horizontal whitespace> model`; case-insensitive; remove all standalone matches | Use an anchored line matcher with explicit horizontal-whitespace grammar and exact email | Cleaner table tests | `ClaudeBot`, alternate email, lookalike domain, embedded prose, duplicates | **Open grammar ambiguity:** define horizontal whitespace as space/tab and model as nonempty text before `<`; document this assumption in implementation review |
| R4 | Cleaning 6, 10; AC3 | Preserve all bytes outside removed lines, separators, Unicode, and final-newline state; do not rewrite unchanged files | Read/write bytes; write only when content differs; atomic temporary-file replacement | LF, CRLF, mixed newline, no-final-newline, Unicode, unchanged mtime/content | Symlink/non-regular message file and oversized/unreadable file fail safely | Ready |
| R5 | Cleaning 7; AC1 | Git rejects a message that becomes invalid/empty | Never synthesize content or bypass Git validation | `git commit` after sole matching line | Assert failure is Git's normal empty-message rejection | Ready |
| R6 | Installation; AC4/8/9 | Install automatically during setup and attribution changes for all pipelines | Add managed installer called from `provisionProject` and `updateClaudeAttribution` | Fresh/update tests for `ecc`, `gstack`, `both`, `none` | Non-Git target skips with explanation; dry-run writes nothing | Ready |
| R7 | Installation 3–6; AC8 | Use existing Node; use Git's first message argument; explicit mode config; actionable failures | Hook entrypoint uses `process.argv[2]`, runtime Git/config discovery, typed operational errors | Spawn hook with controlled cwd/env and malformed config | No `CLAUDE_PROJECT_DIR`; missing Node/config/message/write failure stops commit clearly | Ready |
| R8 | Paths/ownership 1–4; AC8/9 | Resolve effective hooks path including `core.hooksPath`, relative paths, linked worktrees; stay within administrative ownership | Installer queries Git from target and validates realpath/ownership/symlinks before writes | External/relative hooks paths, linked worktrees, spaces, symlinks | Refuse unsafe destination, unknown wrapper/backup, unsupported manager; preserve originals | **Open algorithm detail:** exact supported hook-manager markers and administrative-boundary predicate require implementation-level definition before coding |
| R9 | Existing hooks 5–9; AC5–7 | Existing executable hook remains byte-identical/permission-identical, runs once first with original contract; rejection blocks cleanup; successful hook changes are cleaned | Store a marked managed backup and wrapper; wrapper executes backup once, checks status, then cleaner | Instrumented hook records args/stdin/env/cwd/count; success/failure/trailer-addition tests | Nonexecutable hook is retained and causes conflict rather than becoming executable | Ready, subject to R8 format decision |
| R10 | Installation 7; AC8 | Reinstallation is idempotent; no nested wrappers/duplicate backups | Detect only repo-pattern markers and verify backup ownership/content before reuse | Install twice and compare wrapper/backup inventory and bytes | Changed managed files stop with recovery guidance; unknown backup never overwritten | Ready |
| R11 | Installation 8; AC8 | Failed installation preserves existing state and does not claim success | Stage writes and report protection unavailable; integrate with provision rollback | Inject write/read/symlink/permission failures | No partial message rewrite; no existing hook loss | Ready |
| R12 | Installation 9; AC9/12 | Shared linked-worktree hook resolves committing worktree's mode at runtime | Wrapper discovers runtime Git top-level/config rather than embedding source target | Two linked worktrees with different modes and a shared hooks directory | Hook must not read the other worktree's settings | Ready |
| R13 | AC4; Testing | Cover `-m`, `-F`, `--trailer`, `--amend` in temporary repositories | Add native Node test file with real Git subprocesses | Inspect `git log -1 --format=%B` and message bytes | No project history changes | Ready |
| R14 | AC10–11 | Preserve existing behavior and document local/bypassable scope | Do not touch `/ship`, PreToolUse cleaner semantics, pre-push, CI, or global config; add setup-guide section | Regression suite and documentation assertions/review | `--no-verify` remains a documented bypass; local tests do not claim server enforcement | Ready |
| R15 | AC12; Testing plan | Every test declares observable, failure condition, and no-claim | Add the required comment contract to new tests and any changed test | Review test comments before merge | No green test is presented as proof of server policy/live Claude dispatch | Ready |

### Requirement conflicts and unresolved material

1. “Automatically install” is qualified by non-Git, dry-run, and unsafe-installation rules. The safe precedence is: never initialize Git; dry-run never writes; unsafe installation preserves state and reports unavailable protection.
2. “Horizontal whitespace” and model-name grammar are underspecified. The smallest compatible assumption is ASCII space/tab around the field and before/after the name; model text must be nonempty and end before the exact email delimiter. This must be recorded in code comments/tests, not silently broadened.
3. “Valid commit message” depends on Git's configuration and comment cleanup. Tests should assert the normal Git failure, not implement a second validator.
4. Hook-manager composition and administrative ownership have no exact on-disk format in the issue. Implementation must choose a narrowly recognized marker/backup scheme and refuse unknown arrangements rather than guess.

## Architecture and data/control flow

1. Setup CLI/wizard produces `attributionConfig` and `setupPipeline`.
2. `setupProject` passes those values to `provisionProject` (verified caller flow in `src/setup/setup.mjs:136-165` and `:243-265`).
3. `provisionProject` writes `.claude/settings.json` through `writeClaudeSettings`, copies the existing PreToolUse cleaner, and performs all failure-prone provisioning work before the final managed Git-hook installation mutation. Its callers include setup tests and `runGstackDoctorChecks`; GitNexus impact reports LOW risk, one direct caller for `provisionProject`, and one direct caller/process family for `writeClaudeSettings`.
4. Full setup is the supported production mode-transition path. `updateClaudeAttribution` remains an internal/test-covered helper contract; no new public command/API is added. Where that helper is used, it must reconcile the hook after settings update.
5. The installed wrapper contains the cleaner logic, resolves the committing worktree/repository at runtime, locates `.claude/settings.json`, validates mode, invokes any preserved executable hook exactly once, and only after success cleans the message.
6. The wrapper reads `argv[2]`, validates it is a regular non-symlink message file, performs byte-preserving byte scanning without lossy text decoding, and atomically replaces only changed content.
7. Git continues its normal commit validation. A wrapper/cleaner operational error exits nonzero; an existing hook's status is returned unchanged.

### Components to reuse

- `copyRecursive`, `ensureDir`, `readPrivateJson`, `writePrivateJson`, `rejectClaudeSymlink`, `isTracked`, and existing rollback snapshots in `src/shared/fs-utils.mjs`, `src/setup/settings.mjs`, and `src/setup/provision.mjs` (verified; exact reuse to be checked during implementation).
- Existing generated attribution metadata from `generatedAttributionHook` in `src/setup/settings.mjs:10-25`; do not infer mode from `attribution.commit` because `on` and `off` both currently produce an empty commit attribution.
- Native `node:test`, `spawnSync`, temporary directories, and Git subprocess conventions already used in `test/setup/*.test.mjs`.

### Impacted files

**Verified existing files to change:**

- `src/setup/provision.mjs:238-327` — invoke installation within transactional setup.
- `src/setup/settings.mjs:82-93` — invoke installation on attribution updates; retain current PreToolUse behavior.
- `docs/repo-pattern/setup-guide.md` — document local safeguard, bypass, conflicts, and removal/recovery.
- Existing setup tests only where regression expectations need explicit coverage.

**Proposed additions named by the issue:**

- `src/setup/commit-msg-hook.mjs` — installer, ownership checks, wrapper composition, and runtime helpers.
- `.claude.example/hooks/clean-commit-attribution.cjs` — shipped source/template for the single managed wrapper; setup embeds the managed mode and original-hook fingerprint into the installed wrapper, with no separate `.claude` lifecycle artifact.
- `test/setup/commit-msg-hook.test.mjs` — cleaner, installer, composition, and real-Git tests.

The package `files` list in `package.json:54-66` will need to include any new shipped template hook; this is a verified packaging boundary and must be part of implementation planning, not an accidental omission.

### Compatibility contracts

- Public CLI commands and setup pipeline names stay unchanged.
- Existing `.claude/settings.json` managed metadata remains the mode source.
- Existing PreToolUse command cleanup remains unchanged.
- Existing executable hook arguments, environment, stdin, cwd, bytes, permissions, and exit status remain observable contracts.
- No global Git config or project history is changed.

### Migration and rollback

Installation is additive and local. Run it as the final provisioning mutation, after failure-prone project writes and checkout work complete; if installation itself fails, preserve the previous hook and report unavailable protection. Do not claim the existing project snapshot rolls back an external effective hooks directory. Uninstallation/recovery may remove only wrappers/backups bearing verified repo-pattern ownership markers; if a managed file changed after installation, stop and provide recovery instructions rather than overwrite it. Removing the wrapper reduces protection to the existing command-level cleanup and must be documented.

## Design decisions and alternatives

| Decision | Selected option | Evidence/tradeoff |
|---|---|---|
| Mode source | Managed attribution metadata entry in `.claude/settings.json` | Explicit issue requirement; avoids conflating `off` and `on` through `attribution.commit`. |
| Hook entrypoint | One shipped managed Node wrapper containing the cleaner plus installer | Existing Node runtime and package template pattern; avoids `CLAUDE_PROJECT_DIR`, avoids a separate `.claude` lifecycle surface, and makes cleanup/recovery ownership explicit. |
| Message matching | Anchored, line-based raw-byte scan with ASCII grammar checks and exact email/name rules | Required preservation and exclusion behavior; avoids lossy decoding and Git trailer parser semantics because the issue intentionally applies outside the final trailer block. |
| Existing-hook composition | Managed wrapper + verified managed backup, existing hook first | Satisfies one-time execution and post-hook cleanup; refuses unknown/unsafe arrangements rather than overwriting. |
| File replacement | Temp file in same directory then rename, only on change | Prevents partial rewrite and preserves unchanged-file behavior; destination symlink/non-regular checks happen before writing. |
| Hook path | Git-discovered effective path, runtime repository/worktree discovery | Required for `core.hooksPath`, linked worktrees, and spaces; never assume `.git` directory. |
| Installation failure | Preserve and report unavailable protection | Explicit safety requirement; safer than best-effort writes that can destroy hooks or falsely claim coverage. |

### Rejected alternatives

- **Only extend the existing PreToolUse cleaner:** misses direct Git invocations and violates the stated root cause.
- **Parse `git commit` command strings:** cannot reliably cover `-F`, `--trailer`, hooks that mutate the message, or direct terminal use.
- **Infer mode from `attribution.commit`:** explicitly disallowed and ambiguous for `off`/`on`.
- **Always replace `commit-msg`:** destroys third-party behavior and violates hook composition requirements.
- **Use a shell-only hook:** complicates byte handling, cross-platform Node availability messaging, and safe atomic writes; Node is already a project runtime.
- **Initialize Git for non-Git targets:** explicitly forbidden.

### Premise/feasibility challenge

The cleaner is straightforward; the high-risk premise is safe composition across arbitrary Git hook managers and linked-worktree administrative layouts. The issue does not define all manager formats or a universal ownership boundary. The implementation should keep the supported marker/backup grammar intentionally narrow and return an actionable conflict for everything else. If that cannot be established without unsafe heuristics, installation must be skipped rather than weakening the safety guarantees.

## Ordered implementation tasks

1. **Define and test the exact matcher contract (R3–R5, R15).**
   - Owner/files: `.claude.example/hooks/clean-commit-attribution.cjs`, `test/setup/commit-msg-hook.test.mjs`.
   - Implement a raw-byte line scanner/rebuilder, explicit mode loading, `argv[2]` validation, atomic changed-only replacement, and clear stderr errors. Match only ASCII grammar bytes while copying every unrelated byte unchanged.
   - Exit condition: isolated hook tests cover all matching/nonmatching/newline cases and no final-newline drift.

2. **Map Git path and ownership operations (R6–R12).**
   - Owner/file: `src/setup/commit-msg-hook.mjs`.
   - Use native Git subprocesses from the target, resolve effective hooks path and linked-worktree context, validate symlink/non-regular/ownership boundaries, and define wrapper/backup markers.
   - Exit condition: installer has explicit success, skip, conflict, and failure results; no write occurs before all safety checks pass.

3. **Implement existing-hook wrapper composition (R9–R12).**
   - Owner/files: `src/setup/commit-msg-hook.mjs`, `.claude.example/hooks/clean-commit-attribution.cjs`.
   - Preserve executable hook bytes/permissions, execute it exactly once first with inherited contract, return its nonzero status without cleaning, then clean after success.
   - Exit condition: instrumented subprocess tests prove argument/stdin/env/cwd forwarding, status identity, trailer addition, and idempotent rerun.

4. **Integrate provisioning and supported mode transitions (R6, R10–R14).**
   - Owner/files: `src/setup/provision.mjs:238-327`, `src/setup/settings.mjs:82-93`, `package.json:54-66`.
   - Call the installer for all pipelines as the final provisioning mutation after failure-prone setup work; treat full setup as the supported production mode-transition path, while retaining internal helper coverage without adding a public update API. Make dry-run side-effect-free; include the single shipped wrapper in package files; preserve current PreToolUse behavior.
   - Exit condition: existing setup/settings contracts pass, hook installation warnings/errors cannot be mistaken for successful protection, and no rollback claim covers external hooks beyond the installer’s preserve-on-failure guarantee.

5. **Add real Git integration and failure-injection coverage (R1–R15).**
   - Owner/file: `test/setup/commit-msg-hook.test.mjs`; extend existing setup tests only where needed.
   - Use temporary repositories, real commit objects, `-m`, `-F`, `--trailer`, `--amend`, mode transitions, spaces, linked worktrees, external/relative hooks paths, conflicts, and write/read failures.
   - Exit condition: each test has `protects=...; fails_when=...; no_claim=...`; no test changes project history.

6. **Document operation and recovery (R14).**
   - Owner/file: `docs/repo-pattern/setup-guide.md`.
   - Explain local-only scope, `--no-verify` bypass, existing-hook precedence, conflict/unavailable-protection messages, and removal/recovery boundaries.
   - Exit condition: documentation matches actual result/status messages and explicitly disclaims server-side enforcement.

7. **Verify and review scope before any implementation commit (all IDs).**
   - Run the exact existing native tests plus focused/new tests and package checks; inspect diffs.
   - Run GitNexus `detect_changes({scope: "all"})` before any commit, as required by repository policy. No commit is authorized by this plan.

## Test matrix

| Layer | Cases | Observable / failure condition / no-claim |
|---|---|---|
| Cleaner unit/integration | Plain `Claude`; model name; case variants; spaces/tabs; duplicates; wrong email/domain; `ClaudeBot`; embedded prose; human/other trailers | `protects=only exact standalone Claude lines are removed`; `fails_when=near matches or prose change`; `no_claim=Git hook installation or server policy`. |
| Byte preservation | LF, CRLF, mixed newline, no final newline, Unicode, invalid/non-UTF-8 bytes, unrelated bytes, unchanged content | `protects=raw bytes outside removed records and unchanged no-write`; `fails_when=separator/final-newline/invalid-byte/mtime changes unexpectedly`; `no_claim=Git's own commit-message formatting`. |
| Real Git | `git commit -m`, `-F`, `--trailer`, `--amend`, empty-after-cleanup, `--no-verify` documentation | `protects=stored commit object behavior`; `fails_when=recognized trailer remains or invalid empty commit succeeds`; `no_claim=server-side enforcement`. |
| Existing hook | Success, exact nonzero rejection, adds trailer, args/stdin/env/cwd forwarding, once-only count, executable bytes/mode | `protects=existing hook contract and precedence`; `fails_when=double-run, altered status, altered bytes, or cleanup before rejection`; `no_claim=unsupported third-party manager composition`. |
| Installation | Fresh, rerun, attribution update, all four pipelines, dry-run, non-Git, path spaces, linked worktrees with distinct modes | `protects=installation/idempotence/runtime mode selection`; `fails_when=unintended writes/nesting/wrong worktree mode`; `no_claim=global Git settings`. |
| Ownership/failure | External and relative `core.hooksPath`, symlink destinations, unknown backup/wrapper, nonexecutable existing hook, malformed/missing settings, unreadable message, write failure, missing Node | `protects=preservation and actionable unavailable protection`; `fails_when=partial/destructive write or false success`; `no_claim=all possible hook-manager formats`. |
| Regression/packaging | Existing `npm test`, setup contracts, package dry run, shipped template presence | `protects=existing PreToolUse and setup behavior`; `fails_when=existing tests/package omit or regress files`; `no_claim=live Claude Code dispatch`. |

Baseline must be established by recording the actual commands and observed exit statuses before implementation changes; this draft does not claim any test command was run.

## Failure-mode and risk register

| Risk | Severity | Detection | Mitigation | Recovery |
|---|---|---|---|---|
| Wrong worktree mode read from shared hook | High | Two linked worktrees with different settings | Runtime Git discovery; never hardcode target root | Remove only verified managed wrapper; restore original hook |
| Existing hook lost or runs twice | Critical | Byte/hash, invocation counter, rejection/status tests | Marker/backup verification; refuse unknown arrangements | Stop, preserve files, give recovery path |
| Unsafe/symlink path writes outside repo | Critical | `lstat`/realpath conflict fixtures | Validate before writes; administrative boundary check | No write; report unavailable protection |
| Partial message rewrite | High | Inject rename/write failure; byte compare | Same-directory temp + atomic rename + cleanup | Leave original message; Git rejects operational failure |
| Mode/config ambiguity silently disables safeguard | High | Missing/malformed settings tests | Explicit schema validation and actionable error | Fix settings and rerun setup |
| Git path resolution differs across platform/worktree | High | Relative/external hooks and linked-worktree tests | Use Git-native path queries; avoid `.git` assumptions | Skip installation with conflict details |
| Setup rollback misses hook changes | High | Provision failure after installer | Install only as the final provisioning mutation; installer itself preserves prior state on failure | If installation fails, project provisioning remains complete but protection is reported unavailable; restore only verified managed hook state |
| Package omits new hook | Medium | `npm pack --dry-run` inspection | Update `package.json.files` and packaging test | Correct package manifest before release |
| Cleaner overmatches attribution | High | Near-match/prose/email fixtures | Anchored exact matcher | Existing message remains recoverable; rerun after fix |
| Documentation implies mandatory enforcement | Medium | Documentation review | State local, bypassable, non-server policy | Correct docs without changing hook behavior |

## Open questions and safe interim assumptions

- **Exact whitespace/model grammar:** assume horizontal whitespace means space/tab; require nonempty model text after `Claude`; reject line-internal prose. Record tests for this assumption.
- **Hook-manager formats:** no exact supported list is supplied. Support only a plain executable existing hook and repo-pattern-owned wrapper/backup pairs identified by explicit markers plus byte/permission fingerprints; refuse other wrapper/manager arrangements until verified.
- **Cleaner lifecycle:** the managed wrapper contains the cleaner; do not create a separate `.claude` hook file or require audit/doctor/cleanup changes for one.
- **Provision rollback boundary:** install the managed hook last. Existing project snapshots do not cover external effective Git hooks directories; preserve-on-failure is the hook installer’s boundary.
- **Attribution transition boundary:** full setup is the supported production path for changing mode; no new public attribution-update command/API is in scope.
- **Ownership boundary:** use Git-reported repository/common administrative paths and realpath checks; do not write to arbitrary absolute `core.hooksPath` targets unless Git identifies them as belonging to the target repository. If this cannot be proved, skip.
- **Non-Git target reporting:** return a structured skip/warning from installer; setup remains successful for the requested non-Git workspace but must state protection is unavailable.
- **Missing Node.js:** the installed hook cannot run; installer/runtime must emit actionable stderr and fail the commit rather than silently pass.
- **Existing nonexecutable hook:** preserve it exactly and report conflict if safe composition would require changing its executable bit.
- **Empty message semantics:** delegate validity to Git and assert observed Git failure, without adding a custom validator.

## Review applicability

The Issue/SPEC contains no UI feature or visual behavior. It changes local setup, filesystem, Git hooks, tests, and documentation only. **`no_ui_scope`: Design review is skipped.** No Engineering, DX, autoplan, or gstack review phase is being invoked by this draft.

## Implementation-ready checklist

- [x] Issue and canonical archive read exactly; provenance and no-authorization constraint recorded.
- [x] Current setup, settings, cleaner, package, tests, and docs inspected with concrete paths/lines.
- [x] Existing symbols' GitNexus upstream impact checked before proposing modifications; reported risk is LOW for the inspected setup/settings paths, with direct callers/processes identified.
- [x] Every explicit acceptance criterion maps to R1–R15 and a test/verification.
- [x] Proposed files are distinguished from verified existing files.
- [x] Security-sensitive symlink, non-regular, ownership, external hooks, linked-worktree, atomic-write, and rollback concerns are explicit.
- [x] No implementation code/tests, branches, commits, pushes, reviews, or history changes were made.
- [ ] Exact administrative-boundary algorithm and concrete marker syntax still require implementation-time definition and focused tests; the approved narrow policy requires explicit ownership proof and refusal behavior, not a generic manager protocol.

**IMPLEMENTATION_PLAN_PATH:** `/home/kirin/Code/my-hobby/repo-pattern/docs/plans/issue-107-commit-msg-hook.md`

**Requirements coverage:** Issue/SPEC cleaning, installation, ownership/composition, linked-worktree, rollback, acceptance criteria 1–12, testing plan, out-of-scope rules, and per-test observability contract are covered in R1–R15 and the test matrix.

**Known uncertainties:** exact Git administrative ownership predicate; empty-message behavior across Git configuration; whether non-Git setup should warn without failing. The approved matcher contract is raw-byte scanning with ASCII field/name/email grammar; the approved ownership policy is narrow markers/fingerprints with refusal for unknown arrangements. Safe interim behavior is to refuse unsafe installation and preserve existing files.

**Draft readiness:** Ready for a review attempt after Hermes validates the saved file; implementation is not authorized by this draft.

## CEO REVIEW WORKING NOTES

### Binding decisions

| ID | Owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|---|
| B1 | Issue/SPEC | Local-only, bypassable safeguard; no implementation authorization (`20261125-issue-107-commit-msg-hook.md:14-16`, `:145-152`) | Preserve Issue/SPEC scope | Review failure paths and implementation readiness without adding product scope | approved | User selected HOLD SCOPE in the current review; no code, history, or deployment changes |
| B2 | Issue/SPEC | No UI feature or visual behavior (`20261125-issue-107-commit-msg-hook.md:132-143`) | No UI scope | Skip Design review; run CEO Sections 1–10 only | approved | Full Issue/SPEC evidence establishes no UI scope |
| B3 | Issue/SPEC + user D2 | Existing executable hook must run once; unsafe unknown arrangements must be refused (`20261125-issue-107-commit-msg-hook.md:68-75`) | Marker/backup format was open | Use narrow repo-pattern wrapper/backup markers, same-directory backup, byte/permission fingerprint; refuse unknown wrappers/managers | approved | User selected “Narrow markers” in D2; applies only to ownership proof and composition, not a broader manager protocol |
| B4 | Issue/SPEC + user D3 | Setup rollback must not leave a partially installed hook (`20261125-issue-107-commit-msg-hook.md:61-63`, `:74`) | Existing project snapshot does not cover external effective hooks paths | Install the hook as the final provisioning mutation, after failure-prone setup work; if installation itself fails, preserve existing hooks and report unavailable protection | approved | User selected “Install last” in D3; do not expand project snapshot to arbitrary Git administrative paths |
| B5 | Issue/SPEC + user D4 | Hook cleanup must not create an untracked `.claude` lifecycle surface (`20261125-issue-107-commit-msg-hook.md:132-152`) | Cleaner target path was open | Embed cleaner logic in the managed wrapper; ship/copy one managed Git hook artifact and use its marker for ownership/recovery | approved | User selected “Embed in wrapper” in D4; no audit/doctor/cleanup expansion for a separate cleaner file |
| B6 | Issue/SPEC + user D5 | Attribution changes must affect the next commit (`20261125-issue-107-commit-msg-hook.md:53-63`) | Helper is currently test-only; setup path writes settings through `provisionProject` | Treat full setup as the supported production mode-transition path; update helper coverage but add no public command/API | approved | User selected “Setup is supported path” in D5; no CLI/API expansion |
| B7 | SPEC + user D6 | Unrelated bytes, invalid byte sequences, newline forms, and final-newline state must survive cleanup (`20261125-issue-107-commit-msg-hook.md:49-51`) | Text decoding strategy was open | Use a raw-byte scanner/rebuilder with exact line-separator preservation and changed-only atomic replacement | approved | User selected “Byte scanner” in D6; no lossy UTF-8 decode or Git trailer parser |

### Reality checks

REALITY: premise-table pass all central factual claims have file:line receipts; unverified=0 docs/plans/issue-107-commit-msg-hook.md:18-23
REALITY: already-done pass base history has no post-2026-11-25 hit for planned files; prior attribution commits are historical context, not duplicate implementation docs/plans/issue-107-commit-msg-hook.md:7
REALITY: surface-check finding Git commit flags are verified; installer/runtime helper names remain proposed and require implementation-time verification package.json:9-18
REALITY: binding-decisions pass branch decision search found prior HOLD_SCOPE records and no conflicting active decision; current review mode is recorded above docs/plans/issue-107-commit-msg-hook.md:235
REALITY: numbers pass effort figures are explicitly labeled planning estimates and test/file counts are bounded by the plan matrix docs/plans/issue-107-commit-msg-hook.md:122-130
REALITY: deferred-asks pass no linked Issue/SPEC request is omitted; non-goals and all acceptance criteria are mapped docs/plans/issue-107-commit-msg-hook.md:39-57
REALITY: pr-count finding .gstack/ship-policy.json is absent, so the default one-PR-per-wave policy applies; no split is proposed docs/plans/issue-107-commit-msg-hook.md:168-170

## CEO REVIEW ANALYSIS

### Current scope and mode

- **Mode:** HOLD SCOPE, selected by the user in D1. No scope additions or cuts are approved.
- **Accepted decisions:** B1 local-only/bypassable behavior; B2 no UI and no Design review; B3 narrow ownership markers/fingerprints; B4 install last rather than snapshot external hooks; B5 embed cleaner logic in the single managed wrapper; B6 full setup is the supported production mode-transition path; B7 raw-byte scanning.
- **Pending implementation details:** exact marker syntax and administrative-boundary predicate. These remain implementation-time choices inside the approved narrow/refusal policy and must be tested before claiming readiness.
- **Outside voice:** Codex completed an independent review, score 6/10, NOT PASS. Its five concrete findings were analyzed below; B3–B7 resolve the findings that required a plan decision.

### 0A. Premise challenge

The pain is real and direct: command-level Claude cleanup cannot guarantee the final Git message file is clean. A managed `commit-msg` hook is the correct enforcement point for the local, bypassable behavior requested by the Issue/SPEC. Doing nothing leaves `off` unreliable for direct Git invocations. The plan does not promise server-side enforcement, so it does not confuse a local safeguard with team policy.

### 0B. Existing-code leverage

The plan reuses existing setup orchestration, managed attribution metadata, filesystem safety helpers, rollback conventions, native Node tests, and Git subprocess fixtures. It deliberately does not reuse the existing `PreToolUse` cleaner as the final-message implementation because that cleaner receives Claude tool input rather than Git's message-file contract. The wrapper/cleaner is one new shipped artifact because B5 rejects a separate `.claude` lifecycle surface.

### 0C. Dream-state map

```text
CURRENT STATE                  THIS PLAN                         12-MONTH IDEAL
PreToolUse-only cleanup  --->  Local commit-msg safeguard  --->  Clear, composable local attribution policy
Direct Git trailers can       off cleans final message;         Users can inspect/recover managed hooks,
reach stored commits           on/custom preserve; bypass       understand conflicts, and choose server policy
                               remains explicit                  separately when needed
```

### Section 1: Architecture Review

**OK.** The approved architecture has one new runtime artifact and one installer boundary:

```text
setup/wizard
    |
    v
provisionProject -- writes settings and project files --+--> final hook install
                                                        |
                                                        v
                         Git effective hooks dir <--> managed commit-msg wrapper
                                                        |
                         existing executable hook ------+--> run once, first
                                                        |
                                                        +--> raw-byte cleaner --> message file
                                                        |
                                                        +--> Git normal validation
```

Happy path: setup writes managed mode, finishes other mutations, installs the wrapper last; Git invokes wrapper; preserved hook succeeds; wrapper cleans only in `off`; Git validates. Nil path: no Git repository skips installation; missing `argv[2]`, settings, or mode is an actionable nonzero hook error. Empty path: empty message after cleanup is left to Git; empty existing hook output is not synthesized. Error path: unknown ownership, unsafe symlink, write failure, or hook rejection preserves prior state and blocks/clearly reports the operation. The wrapper’s runtime repository/worktree discovery avoids hardcoding one linked worktree.

State machine:

```text
absent -> installable -> managed
   |          |           |
   |          +-> conflict/skip (no write)
   +----------------------+
managed --unchanged managed --> managed
managed --external mutation --> recovery-required (no overwrite)
```

The main single point of failure is the local wrapper; Git's `--no-verify` remains an intentional bypass. Rollback is reversible by removing only verified managed files. No database, service, endpoint, credential, or scale concern is introduced.

### Section 2: Error and rescue map

| Codepath | Failure | Handling | User-visible result | Test |
|---|---|---|---|---|
| Installer | non-Git target | structured skip, no `git init` | protection unavailable, setup target otherwise unchanged | non-Git fixture |
| Installer | unsafe path/symlink/non-regular/unknown manager | refuse before write | conflict/unavailable protection; existing hook preserved | ownership matrix |
| Installer | managed pair changed | refuse overwrite | recovery instructions | mutate wrapper/backup fixture |
| Wrapper | missing/malformed settings or mode | specific stderr + nonzero | commit stops; fix settings/rerun setup | malformed config |
| Wrapper | missing message argument/file/read failure | specific stderr + nonzero | commit stops; original file remains | argv/read fixtures |
| Existing hook | nonzero status | return exact status; skip cleanup | existing validation remains authoritative | status identity test |
| Cleaner | temp/write/rename failure | remove temp best effort, return nonzero | commit stops; original message remains | injected write failure |
| Git | cleaned message empty | no custom rescue | Git's normal empty-message rejection | real commit test |

No catch-all is permitted to convert an operational failure into a successful commit. Cleanup failures are not swallowed.

### Section 3: Security and threat model

**OK with implementation gates.** Inputs are an untrusted Git path, settings JSON, hook path, existing hook bytes, and message bytes. Validate `argv[2]`, `lstat` symlink/non-regular status, bounded file reads where appropriate, exact managed mode schema, and effective Git paths before writes. Never shell-concatenate the message path or existing-hook arguments; use `spawn`/`execFile` argument arrays and inherited stdio/environment/cwd. Preserve existing executable hook bytes and permissions; never elevate a nonexecutable hook. Refuse arbitrary external `core.hooksPath` targets unless Git ownership and realpath checks prove the approved boundary. No new dependency or secret is introduced. Threats are path traversal/symlink escape, hook replacement, double execution, message corruption, and mode confusion; the plan’s refusal and fingerprint rules mitigate them, with remaining ownership predicate verified by implementation tests.

### Section 4: Data flow and interaction edge cases

```text
Git argv[2] + cwd
   -> Git runtime discovery
   -> effective hooks/settings validation
   -> existing hook (args/stdin/env/cwd preserved)
   -> status check
   -> raw-byte line scan
   -> same-directory atomic replace only if changed
   -> Git commit validation
```

Shadow paths: missing argv/settings/message stop nonzero; wrong mode preserves bytes; non-UTF-8 bytes copy unchanged; mixed LF/CRLF and no-final-newline retain separators; existing-hook rejection skips cleaner; concurrent setup/commit is outside the supported atomic boundary and must be documented as rerun setup before the next commit. Real Git tests cover `-m`, `-F`, `--trailer`, `--amend`, mode transition, linked worktrees, and `--no-verify`; failure injection covers read/write/rename. No user navigation or UI interaction exists.

### Section 5: Code quality review

**OK with two constraints.** Keep installer concerns in `src/setup/commit-msg-hook.mjs` and runtime wrapper concerns in the one shipped artifact; do not duplicate the existing PreToolUse contract. Use small helpers for path resolution, ownership proof, mode loading, hook execution, byte scanning, and atomic replacement rather than one high-branch function. Reuse existing filesystem primitives where their symlink semantics match; do not force helpers that assume project-local paths onto external Git hook paths. Exact marker syntax and administrative-boundary logic must be named in code and tests before implementation is considered complete.

### Section 6: Test review

The plan’s matrix covers every accepted behavior. The critical Friday-at-2am test is a real temporary repository with an executable existing hook that records arguments/stdin/env/cwd, appends a Claude trailer, and returns success; the stored commit must contain no Claude trailer and the existing hook count must be one. Hostile QA should mutate a managed backup, replace the destination with a symlink, use an external hooks path, pass invalid bytes, and make the existing hook reject with a nonzero status. Chaos coverage is injected rename/write failure plus setup failure immediately before final installation. Tests stay native `node:test`, deterministic temporary repositories, no live service, and every test carries the required `protects=...; fails_when=...; no_claim=...` contract.

```text
matcher/bytes       -> unit/integration
wrapper composition -> subprocess integration
Git commit modes    -> real Git system tests
setup/pipelines     -> setup integration
ownership failures  -> filesystem conflict tests
packaging/docs      -> package dry-run + contract review
```

### Section 7: Performance review

**No issues found.** The hook reads one commit-message file and one settings file per commit; the installer runs only during setup. Memory is bounded by message size and existing project conventions; no network, database, cache, retry loop, or background job is added. The plan should retain any existing file-size guard appropriate to local message files, but must not normalize or truncate bytes.

### Section 8: Observability and debuggability review

**OK for a local CLI feature.** Installer results must distinguish installed, already-managed, skipped non-Git, conflict, and operational failure. Runtime failures must identify the attempted operation and safe path context on stderr without leaking unrelated file content. Documentation is the runbook for `--no-verify`, conflict recovery, managed-file mutation, and removal. Metrics/dashboard/alerting are not appropriate for a local hook with no service telemetry; adding them would violate HOLD SCOPE.

### Section 9: Deployment and rollout review

**OK.** Packaging is the deployment boundary: add the single wrapper to `package.json:54-66`, verify `npm pack --dry-run`, and run native setup/regression tests. Installation is additive and local, no migration or global configuration change is needed. Rollback is: stop on conflict; remove only verified managed wrapper/backup; restore the verified original; rerun setup after correcting configuration. Because the hook installs last, earlier project provisioning rollback does not falsely claim to roll back external hook state. The first-user smoke checks are fresh setup, rerun, mode transition, and a real commit in a path containing spaces.

### Section 10: Long-term trajectory review

**OK with bounded debt.** Reversibility is 4/5: managed wrapper/backup removal is straightforward, but unknown third-party arrangements are intentionally left untouched. The main debt is narrow hook-manager support and the explicit administrative-boundary predicate; this is documented rather than hidden. The one-year engineer should find one managed wrapper, explicit markers, one supported setup path, refusal behavior, and native integration tests. No platform expansion is approved. If future demand requires broader manager interoperability, it should be a separate Issue/SPEC with a compatibility contract rather than silently widening this installer.

### Section 11: Design and UX

**SKIPPED (no UI scope).** The Issue/SPEC changes local setup, filesystem state, Git hooks, tests, and documentation only.

### Approval readiness

**PASS.** Current row IDs B1–B7 have exact user/source evidence and approved scope. No unresolved scope decision remains. Implementation details explicitly marked pending are within approved scope and have required verification/refusal behavior. No implementation, commit, push, branch/worktree change, deployment, or history rewrite was performed.

## GSTACK REVIEW REPORT

| Run | Status | Findings |
|---|---|---|
| CEO review | PASS with approved plan amendments | 7 reality rows complete; HOLD SCOPE selected; B1–B7 recorded; Sections 1–10 reviewed; Section 11 skipped because no UI scope |
| Outside coverage / cross-model | COMPLETE | Codex read-only review completed; score 6/10 before amendments; five findings processed, with B3–B7 and plan amendments addressing the concrete gaps |
| Design review | SKIPPED | Full Issue/SPEC establishes no UI scope |
| Engineering review | NOT RUN | Explicitly excluded by user |
| DX review | NOT RUN | Explicitly excluded by user |
| Autoplan | NOT RUN | Explicitly excluded by user |

### Findings and dispositions

| # | Finding | Disposition |
|---|---|---|
| 1 | Ownership/composition algorithm was open | Resolved by B3: narrow markers/fingerprints, explicit refusal for unknown managers; exact syntax remains an implementation verification item |
| 2 | Provision rollback did not cover external hooks | Resolved by B4: install as final provisioning mutation; preserve-on-failure is the hook boundary |
| 3 | Cleaner lifecycle/target was unspecified | Resolved by B5: cleaner is embedded in the single managed wrapper; no separate `.claude` lifecycle artifact |
| 4 | Attribution update helper lacked a production caller | Resolved by B6: full setup is the supported production transition path; no public API expansion |
| 5 | Text decoding could violate byte preservation | Resolved by B7: raw-byte scanner/rebuilder is required |

**VERDICT:** PASS WITH IMPLEMENTATION-TIME VERIFICATION ITEMS. The plan is scope-approved and implementation-ready for the requested review, with exact administrative-boundary predicate and marker syntax required to be finalized and tested before implementation claims success. No UI review applies. Outside coverage is recorded as complete; no cross-model PASS is claimed for the pre-amendment score.

NO UNRESOLVED DECISIONS

<!-- KFLOW_REVIEW_COMPLETION_BEGIN -->

```json
{
  "issueUrl": "https://github.com/NegiKirin/repo-pattern/issues/107",
  "specArchivePath": "/home/kirin/Code/my-hobby/repo-pattern/.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/specs/20261125-issue-107-commit-msg-hook.md",
  "reviews": {
    "ceo": {
      "status": "completed",
      "outcome": "PASS WITH IMPLEMENTATION-TIME VERIFICATION ITEMS",
      "evidence": "Saved plan ## GSTACK REVIEW REPORT, lines 399-420: HOLD SCOPE; Sections 1-10 reviewed; five outside-review findings processed; final verdict recorded."
    },
    "design": {
      "status": "skipped",
      "reason": "no_ui_scope",
      "evidence": "Saved plan lines 391-393 and the full Issue/SPEC: local setup, filesystem, Git hooks, tests, and documentation only; no UI feature or visual behavior."
    }
  },
  "findings": [
    {
      "id": "ceo-ownership-boundary",
      "severity": "informational",
      "disposition": "implementation_verification",
      "task": "Define and test the exact Git administrative-boundary predicate and concrete managed wrapper/backup marker syntax; refuse unknown hook-manager arrangements without writing.",
      "evidence": "Saved plan lines 414 and 420: ownership/composition finding resolved to narrow markers and fingerprints, with exact syntax and boundary predicate remaining implementation verification items."
    },
    {
      "id": "ceo-byte-preservation",
      "severity": "informational",
      "disposition": "implementation_verification",
      "task": "Implement and test a raw-byte scanner/rebuilder that preserves invalid and unrelated bytes, newline forms, and final-newline state, and performs changed-only atomic replacement.",
      "evidence": "Saved plan lines 418 and 420: text-decoding finding resolved by the approved raw-byte scanner/rebuilder contract."
    }
  ],
  "unresolvedMaterialDecisions": [],
  "implementationConditions": [
    "Before claiming implementation success, prove the administrative-boundary predicate and marker syntax with ownership, symlink, unknown-manager, idempotence, and linked-worktree tests.",
    "Before claiming implementation success, prove raw-byte preservation and changed-only atomic replacement with invalid-byte, LF/CRLF/mixed-newline, no-final-newline, unchanged-file, and write-failure tests."
  ],
  "scopeChangedAfterReview": false
}
```

<!-- KFLOW_REVIEW_COMPLETION_END -->
