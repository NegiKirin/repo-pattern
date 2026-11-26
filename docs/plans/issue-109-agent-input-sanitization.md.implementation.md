---
checkpoint_version: 1
state: verified
issue_number: 109
issue_url: https://github.com/NegiKirin/repo-pattern/issues/109
spec_path: /home/kirin/Code/my-hobby/repo-pattern/.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/specs/20261125-190059-issue-109-agent-input-sanitization.md
spec_sha256: 83445da012712ae04033b9a5fca79228d2c9d021f753d43d5875636333935851
plan_path: /home/kirin/Code/my-hobby/repo-pattern/docs/plans/issue-109-agent-input-sanitization.md
plan_sha256: e4b14887b78b801d57d689b367c1a6f82b9010aa0f86d31f8919bcbd71f08733
branch: feat/issue-109-agent-input-sanitization
base_revision: 10d4c73c6536913a0acce1af80d7f9d907e1b644
owner: issue-109-agent-input-sanitization implementation handoff
---

# Implementation checkpoint

## Scope and ownership

Task T6/T8 only: add rollback and update-helper regression coverage for the sanitizer integration, linked to AC7, AC8, AC11, and AC12. T1-T5-CORRECTION were accepted by Hermes before this task. No production, package, docs, audit/doctor, plan, SPEC, or remote changes are authorized in this task. No commit, push, merge, deploy, worktree, reset, stash, discard, or remote mutation performed.

The sibling checkpoint was absent before this handoff and is created by this task. It is owned by this Issue 109 implementation handoff. No other checkpoint content was overwritten.

## Sources read

- Issue URL: https://github.com/NegiKirin/repo-pattern/issues/109
- Canonical SPEC archive: exact path above; `spec_executed: false`, `spec_issue_number: 109`.
- Approved plan: exact path above; draft-only implementation authorization and ordered tasks 1-10.
- Repository instructions: `CLAUDE.md` and `.claude/CLAUDE.md`.

## Branch and tree evidence

- Initial branch: `feat/issue-107-commit-msg-hook`.
- Initial status: only the approved plan was untracked: `?? docs/plans/issue-109-agent-input-sanitization.md`.
- `git check-ref-format --branch feat/issue-109-agent-input-sanitization`: exit 0.
- Created branch with `git switch -c feat/issue-109-agent-input-sanitization`: exit 0.
- Verified branch after switch: `feat/issue-109-agent-input-sanitization`.
- Status after switch and baseline checks: approved plan remains the only untracked file; checkpoint is now the second intentional Issue 109 file created by T1. No unrelated dirty changes observed.
- Base revision: `10d4c73c6536913a0acce1af80d7f9d907e1b644` (`10d4c73 fix: update package smoke version check`).

## Requirement-to-task-to-verification mapping

All AC1-AC12 are verified by the Hermes-accepted evidence recorded below. `copyAgentInputHook` has no GitNexus symbol record (`UNKNOWN`/not found), which is a graph-index limitation only; runtime behavior is covered by the focused and full tests.

| Requirement | Approved task(s) | Planned verification | T1 status |
|---|---|---|---|
| AC1 fresh setup/script/one canonical hook/all pipelines | 5-6 | Four-pipeline setup fixtures and resulting files/settings | verified: focused 16/16, full 136/136 |
| AC2 rerun idempotence | 5-6 | Repeat setup; managed count exactly one and stable JSON | verified: focused 16/16, full 136/136 |
| AC3 exact jq migration/near-miss preservation | 5, 8 | Exact and near-miss settings fixtures | verified: focused 16/16, full 136/136 |
| AC4 unrelated hooks/order/settings preservation | 5, 8 | Deep preservation fixtures, multiple events | verified: focused 16/16, full 136/136 |
| AC5 valid stdin cases/exact context/preservation | 3-4 | Real Node child-process stdout/status assertions | verified: focused 16/16, full 136/136 |
| AC6 invalid stdin status 2/stderr/no updatedInput | 3-4 | Six invalid child-process cases | verified: focused 16/16, full 136/136 |
| AC7 dry-run no settings/script mutation and rollback safety | 5-6, 8 | Dry-run and injected rollback fixtures | verified: focused 16/16, full 136/136 |
| AC8 update helpers do not install/remove Agent hook | 8 | Missing/present hook helper fixtures | verified: focused 16/16, full 136/136 |
| AC9 package inclusion and spaced-path execution | 3, 7, 10 | `npm run pack:dry`; installed command under path with spaces | verified: focused 16/16, pack 54 files, full 136/136 |
| AC10 no dependency/prompt/flag/opt-out/effortLevel/unrelated behavior | 5-9 | Diff/package/CLI/settings inspection and regression suite | verified: full 136/136, pack 54 files, diff scope |
| AC11 test cards on every new test | 4, 8 | Review test comments for exact card fields | verified: focused/full suites |
| AC12 implementation/tests together and existing coverage | 1, 4, 8, 10 | Focused tests, `npm test`, `npm run pack:dry`, detect_changes before commit | verified: focused/full/pack/detect_changes |

## T1 baseline commands and actual results

1. `npm test -- --test-name-pattern='settings|provision|setup'`
   - Exit status: 0.
   - Observed totals: 126 tests, 126 pass, 0 fail, 0 cancelled, 0 skipped.
   - Duration: 108684.963509 ms.
   - This is baseline evidence only; it does not verify Issue 109 behavior.
2. `npm run pack:dry`
   - Exit status: 0.
   - Observed package: `@negikirin/repo-pattern@1.2.6`.
   - Observed total files: 53.
   - Expected sanitizer script is not yet present; package output is pre-implementation baseline.
3. `git check-ref-format --branch feat/issue-109-agent-input-sanitization`
   - Exit status: 0.
4. `git switch -c feat/issue-109-agent-input-sanitization`
   - Exit status: 0.
5. SHA-256 hashing of source inputs completed; hashes are recorded in frontmatter.

Not run in T1: full final `npm test`, final `npm run pack:dry`, focused Agent-hook tests (not yet present), runtime spaced-path check, final `detect_changes`, live provider evaluation, paid evaluation. These are later-task checks.

## T2 GitNexus upstream impact gate

Exact impact calls run in T2, before implementation edits, using upstream callgraph mode and the current `repo-pattern` index:

1. `impact({target:"writeClaudeSettings", direction:"upstream", file_path:"src/setup/settings.mjs", kind:"Function", mode:"callgraph"})`
   - Current risk: `LOW`.
   - Direct callers: 1, specifically `provisionProject`.
   - Affected processes: 2 (`provisionProject`, `runGstackDoctorChecks`).
   - Affected modules: 2 (`Setup` direct, `Gstack` indirect).
   - Depth counts: d1=1, d2=1.
2. `impact({target:"provisionProject", direction:"upstream", file_path:"src/setup/provision.mjs", kind:"Function", mode:"callgraph"})`
   - Current risk: `LOW`.
   - Direct callers: 1, specifically `runGstackDoctorChecks` in `test/gstack/gstack-doctor.mjs`.
   - Affected processes: 1 (`runGstackDoctorChecks`).
   - Affected modules: 1 (`Gstack`).
   - Depth counts: d1=1.
3. `impact({target:"applyGeneratedAttributionHook", direction:"upstream", file_path:"src/setup/settings.mjs", kind:"Function", mode:"callgraph"})`
   - Current risk: `LOW`.
   - Direct callers: 2 (`writeClaudeSettings`, `updateClaudeAttribution`).
   - Affected processes: 2 (`provisionProject`, `runGstackDoctorChecks`).
   - Affected modules: 2 (`Setup` direct, `Gstack` indirect).
   - Depth counts: d1=2, d2=1, d3=1.

`validateAgentHookSettingsShape` does not exist yet, so no existing symbol can be queried. Its impact must be run immediately after creation and before its first edit/use, as required by the approved plan. No other existing function/class/method is currently selected for modification; any newly selected existing symbol requires its own upstream impact before editing.

Discrepancy retained: the approved plan records an earlier `HIGH` result for `writeClaudeSettings` with 2 direct callers, 2 affected processes, and 4 affected modules; the current index returned `LOW`, 1 direct caller, 2 affected processes, and 2 affected modules. This is not silently resolved. No current impact is HIGH or CRITICAL, so T2 does not create a blocker. The lower current result still requires Hermes assessment because the plan explicitly flags the prior HIGH risk.

## T5-CORRECTION resume gate result

Required pre-edit impacts were rerun before any correction edit:

- `auditProject`: `CRITICAL`; 4 direct callers, 5 affected processes, 3 affected modules.
- `doctorProject`: `HIGH`; 3 direct callers, 3 affected processes, 2 affected modules.
- `hasOnlyGeneratedAttributionHookFile`: `CRITICAL`; 1 direct caller, 5 affected processes, 3 affected modules.

The user confirmation authorizes continuation despite these previously reported impact levels. The current packet still requires stopping only on a *new* failed impact prerequisite or scope expansion; these are the same known results recorded in the prior blocker. No unrelated dirty files were found.

## T7/T9 implementation evidence

Task T7/T9 was bounded to the package allowlist and setup documentation. No implementation symbol was edited; the existing branch and prior intentional changes were preserved.

Changed files:

- `package.json`: added only `.claude.example/hooks/sanitize-agent-input.mjs` to the npm `files` allowlist.
- `docs/repo-pattern/setup-guide.md`: added a concise Agent input sanitization section covering setup-only installation, `^Agent$` matcher scope, removal of top-level `effort`/`isolation` for all providers, Node.js 20 prerequisite, no `jq` prerequisite, rerun requirement, managed-marker/exact-legacy cleanup, and the explicit non-general-worktree/provider guarantee.

Verification:

1. `npm run pack:dry`
   - Exit status: 0.
   - Package: `@negikirin/repo-pattern@1.2.6`.
   - Actual listing includes `.claude.example/hooks/sanitize-agent-input.mjs` at 1.4kB.
   - Total files: 54.
2. `node --test test/setup/mcp-and-settings.test.mjs test/setup/provision-and-pipelines.test.mjs test/setup/agent-input-hook.test.mjs`
   - Reused current-tree evidence from the T6/T8 handoff: exit status 0, 16/16 passed, 0 failed, 0 cancelled, 0 skipped.
   - Not rerun because T7/T9 changed only package metadata and documentation; no runtime/test source changed.

## Final implementation gate evidence

Hermes explicitly disposed the prior impact findings as the same previously authorized T5-CORRECTION risk classes, with no new edits, scope expansion, or unsafe tree. The final gate reran the required checks on the current tree.

Impact results:

- `writeClaudeSettings`: `LOW`, 1 direct caller, 2 affected processes, 2 affected modules.
- `provisionProject`: `LOW`, 1 direct caller, 1 affected process, 1 affected module.
- `validateAgentHookSettingsShape`: `LOW`, zero current callers/processes/modules.
- `updateClaudeAttribution`: `LOW`, zero current callers/processes/modules.
- `updateClaudePermissions`: `LOW`, zero current callers/processes/modules.
- `applyGeneratedAttributionHook`: known prior `HIGH`, 2 direct callers, 3 affected processes, 2 affected modules.
- `doctorProject`: known prior `HIGH`, 3 direct callers, 3 affected processes, 2 affected modules.
- `auditProject`: known prior `CRITICAL`, 4 direct callers, 5 affected processes, 3 affected modules.
- `hasManagedGeneratedAttributionHook`: known prior `CRITICAL`, 1 direct caller, 5 affected processes, 3 affected modules.
- `hasOnlyGeneratedAttributionHookFile`: known prior `CRITICAL`, 1 direct caller, 5 affected processes, 3 affected modules.
- `generatedAttributionHook`: known prior `HIGH`, 1 direct caller, 3 affected processes, 1 affected module.
- `copyGeneratedAttributionHook`: known prior `HIGH`, 2 direct callers, 3 affected processes, 2 affected modules.
- `applyAttributionSetting`: known prior `HIGH`, 2 direct callers, 3 affected processes, 2 affected modules.
- `applyPermissionSettings`: `LOW`, 2 direct callers, 2 affected processes, 2 affected modules.
- `reconcileLocalPluginSettings`: `LOW`, 1 direct caller, 2 affected processes, 2 affected modules.
- `copyAgentInputHook`: `UNKNOWN`/not found in the current index; no new HIGH/CRITICAL result and no source edit was made in this final gate.

Full regression:

- `npm test`
  - Exit status: 0.
  - 136 tests, 136 passed, 0 failed, 0 cancelled, 0 skipped.
  - Duration: 357773.21989 ms.

Package:

- `npm run pack:dry`
  - Exit status: 0.
  - Package `@negikirin/repo-pattern@1.2.6`.
  - Listing includes `.claude.example/hooks/sanitize-agent-input.mjs` (1.4kB).
  - Total files: 54.

Change-scope inspection:

- `git diff --check`: exit status 0.
- `git status --short`: only the 8 intentional Issue #109 changed/untracked files are present, plus the preserved approved plan/checkpoint files.
- `detect_changes({scope:"all"})`: returned exit-success tool output with 23 changed symbols, 22 affected symbols, 8 changed files, and `risk_level: "critical"`. The affected processes are provisioning/doctor flows and the changed files are within the Issue #109 implementation, tests, package allowlist, documentation, and plan/checkpoint scope. The critical aggregate reflects the known audit/doctor compatibility symbols already disposed by Hermes; no unrelated file or process was identified.

No source/package/docs changes were made in this final-gate task. Checkpoint state remains `awaiting_verification`; Hermes must independently decide acceptance and may record `verified` only after inspecting this evidence.

## T6/T8 implementation evidence

The resumed packet authorized the smallest production test-only failure-injection seam. Required pre-edit impact results were rerun:

- `provisionProject`: `LOW`, 1 direct caller, 1 affected process, 1 affected module.
- `writeClaudeSettings`: `LOW`, 1 direct caller, 2 affected processes, 2 affected modules.
- `updateClaudeAttribution`: `LOW`, zero current callers/processes/modules.
- `updateClaudePermissions`: `LOW`, zero current callers/processes/modules.
- `copyAgentInputHook`: initial query returned `UNKNOWN`/not found because the refreshed index did not include the new helper symbol; no HIGH/CRITICAL result was returned.

Implemented only the authorized seam and regression coverage:

- `src/setup/provision.mjs`: optional `testHooks = {}` is inert unless explicitly supplied; passes only the settings-write and sanitizer-copy callbacks.
- `src/setup/settings.mjs`: optional `testHook` callbacks run immediately before the corresponding write/copy operation; normal callers are unchanged. `updateClaudeAttribution` now validates malformed `hooks.PreToolUse` before writing.
- `test/setup/mcp-and-settings.test.mjs`: update-helper missing/preinstalled/malformed-state coverage and deterministic settings-write/sanitizer-copy rollback injection coverage, with required test cards.

Verification commands and actual results:

1. `node --test test/setup/mcp-and-settings.test.mjs`
   - Exit status: 0.
   - Observed totals: 10 tests, 10 pass, 0 fail, 0 cancelled, 0 skipped.
   - Includes rollback injection and update-helper boundary tests.
2. `node --test test/setup/mcp-and-settings.test.mjs test/setup/provision-and-pipelines.test.mjs test/setup/agent-input-hook.test.mjs`
   - Exit status: 0.
   - Observed totals: 16 tests, 16 pass, 0 fail, 0 cancelled, 0 skipped.
   - Duration: 377854.636774 ms.

A code review agent independently reported one medium preservation issue in `updateClaudeAttribution`; it was fixed by validating `hooks.PreToolUse` before the helper writes, and the focused settings suite was rerun with 10/10 passing. No HIGH or CRITICAL review finding remains.

## Blockers and remaining verification

No T6/T8 implementation blocker remains. Final package/docs/regression work is outside this task and remains pending in the approved ordered plan. `npm test`, final `npm run pack:dry`, final `detect_changes`, and Hermes acceptance were not run in this task.

## Hermes acceptance

- T1-T4 decisions: accepted by Hermes before their subsequent tasks (supplied task context).
- T5-CORRECTION continuation: accepted with focused 14/14 evidence (supplied task context).
- T6/T8: accepted by Hermes with independently inspected bounded diff and focused 16/16 evidence; no remote mutation.
- T7/T9: accepted by Hermes with independently rerun `npm run pack:dry` showing 54 files including the sanitizer.
- Final implementation gate: accepted by Hermes with `npm test` 136/136, `npm run pack:dry` 54 files, `detect_changes` scope all showing 23 changed symbols/22 affected symbols/8 changed files within Issue #109, and `git diff --check` passing. Known prior HIGH/CRITICAL findings were explicitly disposed as authorized T5-CORRECTION risk classes; no new risk was found.
- Current task: checkpoint-only final acceptance reconciliation.
- Current state: `verified` (Hermes acceptance record; not a claim of unrun checks).
- Limitations retained: `copyAgentInputHook` remains UNKNOWN/not found in the GitNexus index; provider/live Claude behavior, general worktree prevention, and paid evaluations were not tested and are outside scope.
