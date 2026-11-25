# Issue 107 Implementation Checkpoint

## Source identity

- Issue: #107 — https://github.com/NegiKirin/repo-pattern/issues/107
- SPEC: `/home/kirin/Code/my-hobby/repo-pattern/.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/specs/20261125-issue-107-commit-msg-hook.md`
- SPEC SHA-256: `f1adedcf7cab08903fe3f7475c7094b6af6d3d4c13d28631194b4264e3595e16`
- Approved plan: `/home/kirin/Code/my-hobby/repo-pattern/docs/plans/issue-107-commit-msg-hook.md`
- Approved plan SHA-256: `1b36af88fddc4590109fcdbc62ecfdfe3607ea8d2bfae2b545a4bc42c61c2684`
- Checkpoint: `/home/kirin/Code/my-hobby/repo-pattern/docs/plans/issue-107-commit-msg-hook.md.implementation.md`
- Source identity observed: SPEC records `spec_issue_number: 107`, exact Issue URL, `spec_branch: main`, `spec_executed: false`; plan records Issue #107 and the exact SPEC path. No source edits were made.

## Current release audit

- The implementation is now present in the working tree across the managed wrapper, installer, setup integration, package manifest, setup guide, and focused tests. The earlier T1–T3 entries below are historical checkpoints and retain their original pending-verification language.
- Current focused verification recorded for the implementation: `node --test test/setup/commit-msg-hook.test.mjs test/setup/commit-msg-hook-installer.test.mjs test/setup/commit-msg-hook-composition.test.mjs` passed with 14 tests; the broader setup/package verification remains owned by the parent ship workflow.

## Branch and pre-existing tree

- Feature branch: `feat/issue-107-commit-msg-hook`
- Branch preparation: created from `main` after validating with `git check-ref-format --branch`; verified with `git branch --show-current`.
- Initial status before branch preparation: `main`; deleted `docs/plans/issue-105-streamline-interactive-setup.md` and `docs/plans/issue-105-streamline-interactive-setup.md.implementation.md`; untracked saved Issue #107 plan. These are preserved and unrelated Issue #105 deletions were not touched.
- Current status after checkpoint creation: same pre-existing Issue #105 deletions, the saved Issue #107 plan, plus this sibling checkpoint.
- No other active writer, conflicting Issue 107 branch, worktree, or dirty product source was observed. No reset, stash, discard, force checkout, commit, push, remote mutation, `.claude` edit, or plan modification was performed.

## Current bounded task

- State: `implemented_pending_full_verification`
- Task ID: `I107-T4`
- Goal: integrate and test the managed raw-byte commit-message cleaner/runtime entrypoint.
- Requirement IDs: R3, R4, R5, R7, R15.
- Boundary honored: new shipped wrapper artifact and focused native test file only; no installer integration, setup/settings/package/docs edits, commits, pushes, `.claude` edits, or history changes.
- Hermes acceptance: T0 was accepted in the handoff; T1 evidence is pending inspection and acceptance. This checkpoint does not self-certify any requirement.

## T1 implementation

- Added `.claude.example/hooks/clean-commit-attribution.cjs`, following the shipped hook template convention.
- Added `test/setup/commit-msg-hook.test.mjs` using native `node:test` and no new dependency.
- Cleaner uses raw `Buffer` line slicing, Latin-1 only for ASCII matcher inspection, exact case-insensitive field/email/name grammar, and preserves all copied bytes and line separators.
- Runtime reads the managed attribution mode from `.claude/settings.json`, validates `process.argv[2]` as a regular non-symlink file, and performs changed-only same-directory temporary-file rename.
- Existing symbols were not edited; GitNexus upstream impact was therefore not required for new symbols. No HIGH/CRITICAL impact result exists.
- Atomic write failure injection was not added because installer/failure-injection scope is reserved for later tasks; the runtime rename path reports errors and cleans its temporary file.

## T1 verification state

- Focused test command passed locally: `node --test test/setup/commit-msg-hook.test.mjs` — exit 0; 5 tests passed, 0 failed, 0 skipped.
- Tests cover matching/nonmatching grammar, duplicates, CRLF/LF/mixed separators, Unicode, invalid bytes, no final newline, unchanged-file mtime/content, `on`/`custom` preservation, missing mode/config, and non-regular message path.
- Not run: full project suite, package check, real Git integration, atomic failure injection, installer/setup integration, GitNexus `detect_changes`, commit, push.
- Actual task diff is limited to the two new T1 files plus this checkpoint; approved plan and unrelated Issue #105 deletions remain untouched.
- Hermes must inspect actual files and test output; status remains `awaiting_verification`, not `verified`.

## T1 next task

- After Hermes accepts T1, proceed to `I107-T2` (Git path/ownership installer), retaining the unresolved approved-plan boundary decisions and adding the required ownership/marker tests there.

## T2 implementation

- Added `src/setup/commit-msg-hook.mjs` with the bounded installer API `resolveEffectiveHooks` and `installCommitMsgHook`.
- Concrete ownership syntax: wrapper source contains `// # repo-pattern: managed commit-msg v1`; backup path is `commit-msg.repo-pattern-original` and ends with `# repo-pattern: original commit-msg v1`; no sidecar metadata is used.
- Effective hooks path comes from Git (`rev-parse --show-toplevel`, `--git-path hooks`, `--git-common-dir`), is resolved against the target, and is accepted only when its real path is within the Git-reported repository/common administrative roots.
- Installer refuses non-Git targets by structured skip, unproven external paths, symlinks, directories/non-regular destinations, nonexecutable existing hooks, unknown backups, and malformed managed pairs. Existing executable hook bytes and mode are copied into the marked backup; fresh and composed writes stage same-directory temporary files before rename; rerun returns `managed` without nesting.
- Added `test/setup/commit-msg-hook-installer.test.mjs` covering effective paths with spaces/relative config, non-Git skip, administrative-boundary conflict, fresh install/idempotence, nonexecutable hooks, and unknown backups.
- No existing source symbols were edited. GitNexus impact was attempted for the prior cleaner symbol but the index did not resolve the new unindexed symbol (`Target '' not found`, risk `UNKNOWN`); no existing `src/setup` symbol was changed, so no HIGH/CRITICAL impact gate was triggered.

## T2 verification state

- `node --test test/setup/commit-msg-hook.test.mjs test/setup/commit-msg-hook-installer.test.mjs` — exit 0; 9 tests passed, 0 failed, 0 skipped.
- Earlier test runs exposed and were corrected: invalid JavaScript marker comment, fixture Git initialization, mocked path argument, fresh-backup marker encoding, and test expectation for the single marked backup. The final command is the current observed result.
- Not run: full project suite, package check, real linked-worktree integration, atomic failure injection, setup/settings/package/docs integration, GitNexus `detect_changes`, commit, push.
- Actual T2 files: `src/setup/commit-msg-hook.mjs`, `test/setup/commit-msg-hook-installer.test.mjs`, plus this checkpoint; prior T1 files remain. Approved plan and unrelated Issue #105 deletions remain untouched.
- Hermes must inspect actual files, ownership predicate, marker syntax, and test output. State remains `awaiting_verification`, not `verified`.

## T2 correction: dry-run side effect

- Correction task: `I107-T2-CORRECTION`; requirements R6 and R11.
- Observation addressed: `installCommitMsgHook` previously created `hooksDir` before returning for `dryRun`, which could mutate an absent effective hooks directory.
- Repair: removed the pre-dry-run `mkdir`; directory creation now occurs only after the dry-run return and immediately before actual staged writes.
- Added a focused regression test asserting `dry-run` status and `ENOENT` for an absent configured hooks directory.
- No other product scope changed; approved plan, T1 behavior, marker syntax, ownership predicate, and unrelated Issue #105 deletions remain preserved.

## T2 correction verification

- `node --test test/setup/commit-msg-hook.test.mjs test/setup/commit-msg-hook-installer.test.mjs` — exit 0; 10 tests passed, 0 failed, 0 skipped.
- The regression directly observes no hooks-directory creation during dry-run.
- Not run: full suite, package check, setup integration, linked-worktree integration, `detect_changes`, commit, push.
- State remains `awaiting_verification`; Hermes must inspect the correction and accept it. No requirement is marked verified.

## T2 next task

- After Hermes accepts T2, proceed to `I107-T3` existing-hook wrapper composition and linked-worktree runtime behavior. Runtime wrapper execution must be integrated there; this task only establishes installer ownership/path primitives.

## T3 implementation

- Updated `.claude.example/hooks/clean-commit-attribution.cjs` to execute the marked preserved hook before cleanup, using runtime `git rev-parse --git-path hooks`; no source-root or worktree path is embedded.
- Preserved hook arguments, environment, working directory, and inherited stdio; nonzero status is returned unchanged and cleanup is skipped.
- Added `test/setup/commit-msg-hook-composition.test.mjs` covering successful trailer addition/removal, one invocation, argument/environment/cwd forwarding, original bytes and permission mode, rejection status `37`, and cleanup suppression on rejection.
- GitNexus impact was run for `installCommitMsgHook`; the new symbol is not present in the current index (`Target '' not found`, risk `UNKNOWN`). No existing symbol was edited and no HIGH/CRITICAL impact was returned.

## T3 verification state

- `node --test test/setup/commit-msg-hook.test.mjs test/setup/commit-msg-hook-installer.test.mjs test/setup/commit-msg-hook-composition.test.mjs` — exit 0; 12 tests passed, 0 failed, 0 skipped.
- Not run: full suite, package check, real linked-worktree with distinct settings, setup integration, `detect_changes`, commit, push.
- Actual T3 files: `.claude.example/hooks/clean-commit-attribution.cjs`, `test/setup/commit-msg-hook-composition.test.mjs`, plus this checkpoint. T1/T2 files remain; approved plan and unrelated Issue #105 deletions remain untouched.
- State remains `awaiting_verification`; Hermes must inspect composition and runtime path behavior. No requirement is marked verified.

## T3 correction

- Correction task: `I107-T3-CORRECTION`; requirements R9, R10, R12.
- Removed the broken test-only `runOriginalHookForTest` export; production wrapper execution contract is unchanged.
- Managed reruns now derive the expected wrapper from the exact installed template and the preserved original-hook bytes, and compare both wrapper and marked backup bytes before returning `managed`. Marker-preserving mutations return `conflict` without overwriting either file.
- Added focused installer tests for mutated wrapper and mutated backup refusal with byte preservation.
- Added a real linked-worktree composition test using a shared hooks directory: the main worktree's `off` mode cleans the trailer, while the linked worktree's `on` mode preserves it.
- No setup/settings/package/docs integration, commit, push, or unrelated scope was performed.

## T3 correction verification state

- `node --test test/setup/commit-msg-hook.test.mjs test/setup/commit-msg-hook-installer.test.mjs test/setup/commit-msg-hook-composition.test.mjs` — exit 0; 14 tests passed, 0 failed, 0 skipped.
- `node --check src/setup/commit-msg-hook.mjs && node --check .claude.example/hooks/clean-commit-attribution.cjs` — exit 0.
- Not run: full project suite, package check, real Git commit integration matrix, setup integration, `detect_changes`, commit, push.
- Actual correction scope: `.claude.example/hooks/clean-commit-attribution.cjs`, `src/setup/commit-msg-hook.mjs`, `test/setup/commit-msg-hook-installer.test.mjs`, `test/setup/commit-msg-hook-composition.test.mjs`, plus this checkpoint. Approved plan and unrelated Issue #105 deletions remain untouched.
- State remains `awaiting_verification`; Hermes must inspect actual files and evidence. No requirement is marked verified.

## T3 next task

- After Hermes accepts this correction, proceed to `I107-T4` setup/settings integration and packaging.


## Requirement → task → verification mapping

| Requirement | Planned task/dependency | Verification evidence required | Status |
|---|---|---|---|
| R1 | T1 matcher/mode gate; T5 real Git | `off` removes recognized lines; valid commit stores clean message; empty result remains Git's rejection | pending |
| R2 | T1 mode loading; T5 mode tests | `on`/`custom` preserve; malformed/missing mode errors | pending |
| R3 | T1 exact raw-byte matcher | Plain/model/case/whitespace/duplicates match; near names, wrong email/domain, embedded prose do not | pending |
| R4 | T1 byte scanner/atomic replacement | LF/CRLF/mixed/no-final-newline/Unicode/invalid bytes preserved; unchanged file not rewritten | pending |
| R5 | T1/T5 | Sole matching line is not synthesized; Git normally rejects resulting empty message | pending |
| R6 | T2 installer; T4 setup integration | Fresh/update setup across `ecc`, `gstack`, `both`, `none`; non-Git skip; dry-run no writes | pending |
| R7 | T1/T2 runtime entrypoint | Uses first Git message argument, explicit managed mode, runtime Git/config discovery, actionable failures without `CLAUDE_PROJECT_DIR` | pending |
| R8 | T2 path/ownership | Effective hooks path, relative paths, linked worktrees, spaces; narrow ownership proof; unsafe/unknown arrangements refused | pending |
| R9 | T3 wrapper composition | Existing executable hook bytes/permissions preserved, runs once first with args/stdin/env/cwd, rejection status exact, successful additions cleaned | pending |
| R10 | T2/T3 idempotence | Reinstall has no nesting or duplicate backups; managed mutation requires recovery, unknown backup not overwritten | pending |
| R11 | T2/T4 failure handling | Failed install preserves existing files and reports unavailable protection; no partial writes | pending |
| R12 | T3/T5 linked worktree runtime | Shared hook reads committing worktree mode, not another worktree's settings | pending |
| R13 | T5 real Git integration | Temporary repositories cover `-m`, `-F`, `--trailer`, `--amend`; no project history change | pending |
| R14 | T4/T6 regression/docs | No `/ship`, history, pre-push, CI, global config changes; docs state local, bypassable `--no-verify`, non-server enforcement | pending |
| R15 | T5 test contract | Every new test states `protects=...; fails_when=...; no_claim=...` | pending |

## Ordered next work

1. `I107-T1`: define/test matcher and byte-preserving runtime cleaner (R3–R5, R15); prerequisite is Hermes acceptance of this inventory checkpoint.
2. `I107-T2`: implement Git path/ownership installer (R6–R12).
3. `I107-T3`: implement existing-hook composition and linked-worktree runtime behavior (R9–R12).
4. `I107-T4`: integrate setup/settings and packaging (R6, R10–R14).
5. `I107-T5`: add native tests and real Git/failure coverage (R1–R15), including ownership/marker and raw-byte/atomic-write checks.
6. `I107-T6`: document operation/recovery (R14).
7. `I107-T7`: run full verification, inspect diff, and run GitNexus `detect_changes` before any separately authorized commit (all IDs).

Dependencies and implementation conditions retained: install last; embed cleaner in one managed wrapper; use narrow explicit markers/fingerprints and refuse unknown managers; raw-byte scanner; managed attribution metadata is the mode source; no new dependency/framework; no public attribution API; no UI/design scope; preserve PreToolUse behavior and external hook state on failure.

## Inventory observations and blockers

- Approved plan contains complete R1–R15 matrix, ordered tasks, acceptance criteria, test matrix, non-goals, rollback, risk register, and review decisions B1–B7.
- Plan's unresolved implementation-time details remain bounded rather than silently resolved: exact marker syntax and administrative-boundary predicate; implementation must choose narrowly and test refusal behavior.
- Required handoff evidence is not yet available: no ownership/marker tests, raw-byte tests, atomic-write tests, runtime implementation, or verification run is authorized in I107-T0.
- No blocker to branch/checkpoint bootstrap. Dependency-ready next task is `I107-T1`, only after Hermes accepts this checkpoint.

## Commands and observed results

- `git status --short --branch && git branch --show-current && git check-ref-format --branch feat/issue-107-commit-msg-hook` — exit 0; initial branch `main`; status showed only the preserved Issue #105 deletions and untracked Issue #107 plan; branch name valid.
- `git branch --list 'feat/issue-107-commit-msg-hook' && git branch -vv && git status --short --untracked-files=all && sha256sum ...` — exit 1 overall because the checkpoint did not yet exist; output confirmed no Issue 107 feature branch existed, preserved tree state, and recorded the plan/SPEC hashes above.
- `git switch -c feat/issue-107-commit-msg-hook && git branch --show-current && git status --short --untracked-files=all` — exit 0; branch created and verified; preserved unrelated changes.
- File reads of the approved plan and canonical SPEC — successful; contents reconciled into this checkpoint.
- Tests, package checks, GitNexus impact, detect_changes, ownership/marker tests, raw-byte/atomic-write tests — `not_run` (inventory-only task; no runtime edits).

## Hermes decision record

- Acceptance decision: pending; Hermes must inspect this checkpoint and the actual tree.
- No requirement is marked `verified`.
- Resume condition: after explicit Hermes acceptance, issue a concrete implementation packet for `I107-T1`; if Hermes identifies missing scope, requirement IDs, prerequisite, or permission, stop and update this checkpoint only within authorized scope.
