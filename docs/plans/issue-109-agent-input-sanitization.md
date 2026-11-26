# Implementation Plan: Agent Input Sanitization Hook

## Status and provenance

- **Draft only.** This document authorizes no implementation, review skill, commit, push, merge, deploy, branch change, or worktree change.
- **Issue:** #109, `https://github.com/NegiKirin/repo-pattern/issues/109`.
- **Canonical specification archive:** `/home/kirin/Code/my-hobby/repo-pattern/.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/specs/20261125-190059-issue-109-agent-input-sanitization.md`.
- The canonical archive was read exactly and is the authoritative source used for the requirements matrix below. Its provenance records `spec_issue_number: 109`, `spec_executed: false`, and filed time `2026-11-25T19:00:59Z`. No claim about unquoted GitHub issue text is needed for this plan.
- Repository working tree was clean at inspection time; current revision was `10d4c73` on `feat/issue-107-commit-msg-hook`.
- The issue explicitly directs use of Node.js, no new dependency, no prompt/flag/opt-out, and no live provider or paid evaluation. Those directions are retained below.

## Goal and behavior

### User problem

`repo-pattern setup` currently installs the managed Bash attribution-removal `PreToolUse` hook, but does not sanitize `Agent` inputs. Some providers reject `effort` and `isolation`, and an `Agent` input can request worktree creation. The requested behavior is to remove only those two own properties before the `Agent` tool executes, while preserving every other input value.

### Observed current behavior

- `src/setup/settings.mjs:9-34` defines and copies the managed generated-attribution hook only.
- `src/setup/settings.mjs:65-80` merges the template and current `.claude/settings.json`, applies permissions/attribution, and writes settings.
- `src/setup/settings.mjs:83-109` contains separate internal attribution and permission update helpers; there is no public `update` CLI command.
- `src/setup/provision.mjs:320-331` copies the workspace template, writes settings, copies the attribution hook, and writes local settings.
- `src/setup/provision.mjs:83-98` supports `ecc`, `gstack`, `both`, and `none` pipelines.
- `.claude.example/settings.example.json:3` has an empty `hooks` object. Adding a template-only entry would not reconcile existing settings, so the managed entry must be applied in settings code.
- `package.json:51-53` requires Node.js `>=20`; `package.json:54-67` explicitly allowlists packaged files.
- Existing setup tests use `node:test`, temporary directories, real child processes, and contract comments with `protects=...; fails_when=...; no_claim=...`.

### Proposed behavior

During full setup, for every supported pipeline:

1. Copy `.claude.example/hooks/sanitize-agent-input.mjs` to `.claude/hooks/sanitize-agent-input.mjs`.
2. Reconcile one canonical repo-pattern-owned `hooks.PreToolUse` entry with source marker `agent-input-sanitization`.
3. Replace all entries with that source marker by one canonical entry.
4. Migrate only an exact legacy jq entry whose matcher is exactly `^Agent$`, whose `hooks` array has exactly one command hook, and whose command/type/timeout exactly match the specification.
5. Preserve unrelated hooks, their relative ordering, hooks on other events, and unrelated settings.
6. Keep attribution and permission update helpers from installing or removing the Agent hook.

The copied command must be:

```json
{
  "_repo_pattern_source": "agent-input-sanitization",
  "matcher": "^Agent$",
  "hooks": [
    {
      "type": "command",
      "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/sanitize-agent-input.mjs\"",
      "timeout": 5
    }
  ]
}
```

The script reads one JSON object from stdin. It rejects invalid JSON, non-object top-level values, absent/invalid `tool_input`, `null`, and arrays with an explanatory stderr message, exit status `2`, and no stdout containing `updatedInput`. For valid `tool_input` objects, it emits `{}` when neither field is an own property; otherwise it removes both `effort` and `isolation`, including when either value is `null`, preserves all other properties/nested values, emits the required `hookSpecificOutput`, and exits `0`.

### Non-goals

- Do not change top-level `effortLevel` in `.claude/settings.local.json`.
- Do not install this hook from attribution or permission update helpers.
- Do not edit global settings or workspaces that have not rerun setup.
- Do not block worktree creation through Bash, Git, or other tools.
- Do not add provider-specific behavior, configuration, opt-out, setup prompt, CLI flag, dependency, jq installation, or a live provider test.
- Do not change unrelated setup behavior, hook entries, or settings.

## Requirement and acceptance-criterion matrix

| ID | Source | Expected behavior | Proposed change | Verification/test case | Negative or boundary case | Status |
|---|---|---|---|---|---|---|
| AC1 | Issue/SPEC AC1 | Fresh setup installs the script and exactly one canonical managed Agent hook for every pipeline. | Add template script; copy it from the full `provisionProject` path; reconcile canonical settings entry independently of pipeline. | Fixture setup for `ecc`, `gstack`, `both`, and `none`; assert script bytes and one canonical entry. | Existing unrelated hooks and a missing `.claude/hooks` directory must not prevent installation. | Ready |
| AC2 | Issue/SPEC AC2 | Repeating setup does not duplicate the managed entry. | Filter all entries carrying the managed source marker, then append/insert one canonical entry according to the selected ordering decision. | Run settings reconciliation twice and compare managed-entry count and resulting JSON. | Multiple stale managed entries collapse to one; unrelated duplicates remain untouched. | Ready |
| AC3 | Issue/SPEC AC3 | Exact legacy jq entries migrate; other Agent commands and mixed entries remain unchanged. | Define an exact legacy predicate for matcher, one-element hooks array, type, command, and timeout; remove only matching legacy entries before ensuring canonical entry. | Seed exact legacy, different command, different timeout, extra hook, different matcher, and mixed entries; assert exact migration and byte/value preservation of untouched entries. | A matching command with an extra hook is not migrated; a non-`^Agent$` matcher is not migrated. | Ready |
| AC4 | Issue/SPEC AC4 | Existing unrelated hooks, relative ordering, and settings survive. | Perform narrow event-array reconciliation; copy settings via existing merge path; avoid template-only replacement. | Seed hooks on multiple events and custom settings; assert deep equality except intended managed Agent entry. | Empty or absent event arrays, unknown hook fields, and other `PreToolUse` matchers remain valid. | Ready |
| AC5 | Issue/SPEC AC5 | Script covers every valid-input case and exact `additionalContext`. | Implement own-property checks and shallow removal from a validated `tool_input` object; emit exact response constant. | Child-process tests for neither field, effort only, isolation only, both, null values, nested preservation, prompt/model preservation. | Inherited-looking properties are irrelevant because JSON input has own enumerable data only; nested `effort`/`isolation` values remain nested. | Ready |
| AC6 | Issue/SPEC AC6 | Invalid input exits `2`, writes explanatory stderr, and does not emit an `updatedInput` response. | Validate JSON and top-level/`tool_input` shape before response construction; set `process.exitCode` or exit with status `2`. | Child-process tests for invalid JSON, primitive/array top-level, missing tool_input, null/array/primitive tool_input; assert status, stderr, and stdout. | A malformed input must not partially write stdout or leak a partial `updatedInput`. | Ready |
| AC7 | Issue/SPEC AC7 | Dry-run creates or modifies neither script nor settings. | Pass the existing `dryRun` flag to script-copy and settings-write/reconciliation paths; do not create directories in dry-run. | Seed settings and absent hook, run dry-run setup, assert bytes, existence, and directory inventory unchanged. | Dry-run against a symlinked or absent target must retain current dry-run semantics; no claim that a real setup occurred. | Ready |
| AC8 | Issue/SPEC AC8 | Attribution/permission update commands neither install a missing Agent hook nor remove an installed one. | Keep `updateClaudeAttribution` and `updateClaudePermissions` limited to their current responsibilities; do not call Agent-hook copy/reconciliation from them. | Call each helper with missing Agent hook and with a preinstalled Agent hook; assert missing remains missing and installed entry/script remain. | Attribution helper may still copy its own attribution hook and install its existing commit hook; those behaviors are out of this feature. | Ready |
| AC9 | Issue/SPEC AC9 | Package contains the script; installed command works from a project path containing spaces. | Add `.claude.example/hooks/sanitize-agent-input.mjs` to `package.json.files`; retain quoted `$CLAUDE_PROJECT_DIR` command. | Inspect `npm pack --dry-run` listing; copy/install fixture under a path containing spaces and spawn the command with JSON stdin. | Do not claim provider execution; verify only the real Node child process and quoted path. | Ready |
| AC10 | Issue/SPEC AC10 | No dependency, prompt, flag, opt-out, effortLevel change, or unrelated behavior change. | Make only runtime asset, settings/provision wiring, allowlist, tests, and setup-guide changes. | Inspect package/dependency diff, CLI help/option surface, settings.local output, and focused regression suite. | Existing provider-specific rejection and worktree behavior remain untested/out of scope; no new API contract. | Ready |
| AC11 | Issue/SPEC AC11 | Every new test states the required test card. | Add one comment per new test or test group containing `protects=...; fails_when=...; no_claim=...`. | Review new test file and changed tests for exact card format. | A green local test does not claim all Claude Code versions/providers, worktree prevention, or live Agent behavior. | Ready |
| AC12 | Issue/SPEC AC12 | Implementation and regression tests land together; existing coverage remains. | Add focused tests alongside implementation and preserve existing setup/attribution tests; update only positional assertions made invalid by hook ordering. | Run focused tests, then `npm test`, then `npm run pack:dry`; record actual results. | No live provider or paid evaluation; failure in unrelated pre-existing tests must be reported, not hidden. | Ready |

### Resolved implementation decisions

No contradiction was found between the Issue and canonical archive. The following decisions make the implementation contract explicit without expanding the SPEC scope:

1. **Managed-entry ordering.** Remove owned/eligible legacy entries, preserve every remaining entry in its existing relative order, and append exactly one canonical managed Agent entry. If existing tests rely on attribution being last, locate it by source marker instead; no unrelated entry is reordered.
2. **Preflight helper and ordering.** Add a pure `validateAgentHookSettingsShape(settings)` helper in `src/setup/settings.mjs`. `provisionProject` must invoke this validation against the merged settings before any settings write, hook-script copy, or other managed mutation. `writeClaudeSettings` must also invoke it immediately after reading/merging and before its write boundary, so direct callers cannot bypass the guard. A non-array `hooks.PreToolUse` fails with an actionable error naming `.claude/settings.json`, the required array shape, and repair/rerun guidance. The failure must leave settings bytes unchanged and must not create, replace, or delete the sanitizer script; tests assert both bytes/state and stderr.
3. **Other malformed hook events.** The supported shape boundary is narrow: `hooks.PreToolUse`, when present, must be an array because this feature reconciles that event. Other existing `hooks` event values, including non-array values, are preserved verbatim and are never iterated or reconciled by the new Agent helper. Add a fixture proving a non-array `PostToolUse` (and an unrelated array event) survives unchanged while the Agent reconciliation succeeds. This does not broaden or repair the existing attribution hook's unrelated event behavior.
4. **Exact legacy migration.** Matching is field-based for the required legacy contract: entry matcher exactly `^Agent$`, `hooks` array length exactly one, sole hook `type` exactly `command`, command exactly the full jq string in the SPEC, and timeout exactly numeric `5`. Any additional property on the entry or sole hook invalidates migration; the near-match remains untouched. The canonical managed entry may contain only its specified marker/matcher/hooks fields.
5. **Script error wording.** Use stable category messages for invalid JSON and invalid `tool_input`; tests require category-identifying stderr, status `2`, and no `updatedInput`, but do not overconstrain punctuation.
6. **Own-property semantics.** Use `Object.hasOwn`/equivalent so `null`, `false`, `0`, empty strings, and empty objects trigger removal, while nested properties remain unchanged.

## Architecture and end-to-end flow

### Existing flow to preserve

1. `bin/repo-pattern.mjs` imports the CLI.
2. `src/cli.mjs:167-205` dispatches `setup` to `setupProject`; no public update command exists.
3. `src/setup/setup.mjs:136-165` handles non-interactive setup and passes setup options, including `dryRun`, to `provisionProject`; interactive setup passes the same options after its wizard/status handling.
4. `src/setup/provision.mjs:238-494` validates, snapshots/backs up, writes workspace settings, copies hooks, applies selected pipeline work, handles rollback, and runs final doctor/summary behavior.
5. `src/setup/settings.mjs:65-80` reads template/current settings, applies permission and attribution transformations, then writes `.claude/settings.json`.
6. `src/setup/settings.mjs:83-109` remains the boundary for attribution/permission update helpers and must not gain Agent-hook installation behavior.

### Proposed data/control flow

1. Full setup reads and merges settings without writing any managed file.
2. `validateAgentHookSettingsShape(settings)` runs before any settings write, sanitizer-script copy, or other managed mutation. It rejects a present non-array `hooks.PreToolUse` and reports repair/rerun guidance; it does not inspect or rewrite unrelated event values.
3. `writeClaudeSettings` invokes the same preflight immediately after merge and before its write boundary, then applies the narrow Agent-hook reconciliation transformation.
4. The transformation removes repo-pattern entries with source marker `agent-input-sanitization`, removes only exact legacy jq entries, preserves all other entries and event ordering, and ensures one canonical entry.
5. Full setup copies the new script from the template directory only after validation has passed, through the existing copy helper, with `dryRun` and `silent` propagated exactly like the attribution script; both settings and script mutations remain inside the existing provisioning rollback transaction.
6. Claude Code dispatches the command only for matcher `^Agent$`; the command uses the quoted project path and invokes Node.js.
7. The script parses stdin, validates `tool_input`, removes only top-level `effort`/`isolation`, and emits either `{}` or the exact `hookSpecificOutput` response.
8. Attribution/permission update helpers continue to update only their existing settings/files. An installed Agent hook is preserved because their settings transformations must not reconcile it.
9. Packaging includes the template runtime asset, so a published package has the source needed by setup.

### Existing components to reuse

- `copyRecursive` and existing `copyGeneratedAttributionHook` pattern in `src/setup/settings.mjs`.
- Existing `writeClaudeSettings` merge/malformed-file/dry-run behavior, plus a shared `validateAgentHookSettingsShape` preflight used before every settings/script mutation.
- Existing `writePrivateJson`, `readPrivateJson`, and settings symlink/tracked-file protections.
- Existing `provisionProject` backup/rollback and pipeline dispatch; do not move the new operation outside the established mutation boundary without a specific rollback analysis.
- Existing Node.js `node:test`, `spawnSync`, temporary-directory fixtures, and package dry-run command.

### Impacted files and symbols

**Verified existing files/symbols:**

- `src/setup/settings.mjs`: `applyGeneratedAttributionHook`, `copyGeneratedAttributionHook`, `writeClaudeSettings`, `updateClaudeAttribution`, `updateClaudePermissions`.
- `src/setup/provision.mjs`: `provisionProject`, setup pipeline helpers, the settings/hook copy step around lines `327-328`.
- `src/setup/setup.mjs`: `setupProject` and dry-run propagation.
- `package.json`: `files` allowlist and Node engine.
- `test/setup/mcp-and-settings.test.mjs`: settings merge, dry-run, attribution, and update-helper assertions.
- `test/setup/provision-and-pipelines.test.mjs`, `test/setup/setup-characterization.test.mjs`, and `test/setup/interactive-provision.test.mjs`: provisioning, pipeline, rollback, and dry-run contracts.
- `docs/repo-pattern/setup-guide.md`: setup behavior and limitation documentation.
- `.claude.example/settings.example.json`: intentionally not sufficient as the only implementation location; preserve its empty hooks template unless a code-grounded reason appears.
- Existing test helpers were inspected during planning: process tests, temporary-directory fixtures, setup/provision fixtures, and package dry-run helpers already support the required cases. Keep one focused `test/setup/agent-input-hook.test.mjs` only if its groups remain readable; otherwise place process cases in that file and extend existing settings/provision suites rather than creating a second broad fixture. This is a maintainability check, not extra scope.

**Proposed addition:**

- `.claude.example/hooks/sanitize-agent-input.mjs` — stdin/stdout Node.js hook script.
- `test/setup/agent-input-hook.test.mjs` — focused script, settings/setup, package, and path-with-spaces regression coverage, unless existing test organization proves a smaller placement is preferable.

### Compatibility and rollback

- Settings schema compatibility: preserve all non-owned JSON values and hook entries; only add/remove the specified managed Agent entries.
- CLI/API compatibility: no new command, flag, prompt, dependency, or public export is required.
- Package compatibility: Node.js `>=20` remains the runtime prerequisite; jq is no longer needed for the installed Agent hook.
- Rollback: reverting implementation stops future installations but does not remove already-installed entries/scripts. Existing workspaces must remove only entries marked `_repo_pattern_source: "agent-input-sanitization"` and the corresponding `.claude/hooks/sanitize-agent-input.mjs`, preserving all other hooks.

## Design decisions and alternatives

| Decision | Selected option | Evidence | Tradeoff/blast radius |
|---|---|---|---|
| Script runtime | Node.js standard library | Node `>=20` is already required; issue explicitly approves replacing jq. | Adds a small runtime asset but no dependency or jq prerequisite. |
| Installation scope | Full `setup` only | Issue requires all setup pipelines and explicitly excludes update helpers. | Existing workspaces do not change until setup reruns. |
| Reconciliation marker | `_repo_pattern_source: "agent-input-sanitization"` | Matches existing managed-hook marker convention in `settings.mjs`. | Marker becomes the ownership signal; rollback must preserve unmarked entries. |
| Legacy migration | Exact structural/string match only | Issue explicitly says mixed/different entries remain untouched. | Some semantically equivalent legacy commands will remain; that is safer than broad migration. |
| Input filtering | Own top-level properties only | Requirement says remove `effort`/`isolation` while preserving nested values and all other arguments. | Does not prevent nested or non-Agent worktree behavior; explicitly out of scope. |
| Settings placement | Reconcile in settings transformation, not template alone | Existing settings merge must handle reruns and existing hooks. | `writeClaudeSettings` is a high-risk shared setup boundary. |
| Tests | Real Node child processes and temp fixtures | Specification requires observable stdout/stderr/status and installed command with spaces. | Does not prove live Claude/provider behavior. |
| Hook ordering | Preserve remaining entries; append one canonical Agent entry | Preserves unrelated order with the fewest transformations. | Existing positional assertions must use source markers. |

### Premise/feasibility challenge

The hook can sanitize the `Agent` tool input only when Claude Code dispatches the `PreToolUse` matcher and honors `hookSpecificOutput.updatedInput`. It cannot guarantee that every provider accepts the hook protocol, that every Claude Code version applies updated input identically, or that worktrees cannot be created through Bash/Git. The specification explicitly limits scope to the Agent matcher and requires local fixture tests rather than a live provider evaluation. The implementation plan therefore treats provider behavior as an unverified boundary, documents it, and avoids claiming stronger prevention.

### GitNexus impact and edit gate

A GitNexus upstream impact query was run for `writeClaudeSettings` before planning edits. It reported **HIGH** risk, 2 direct upstream callers, 2 affected processes, and 4 affected modules; direct callers included `provisionProject` and `test/setup/mcp-and-settings.test.mjs`. The plan must therefore keep the settings transformation narrow, preserve existing contracts, and warn/reassess before modifying any additional shared symbol. The implementation phase must run impact for each function/class/method it changes and must stop for review if a new HIGH/CRITICAL result appears. No implementation edits were made during this planning pass.

## Ordered implementation tasks

1. **Baseline and guardrails**
   - Prerequisite: clean working tree and reviewed plan.
   - Verify current relevant tests/commands without changing implementation: focused setup tests, `npm test` if time permits, and `npm run pack:dry` baseline if package assertions are added.
   - Record actual command results; do not present baseline as passing unless run.
   - Acceptance: AC12; establishes regression baseline.

2. **Impact analysis for implementation symbols**
   - Prerequisite: baseline and final selection of exact symbols to edit.
   - Run GitNexus upstream `impact` for `writeClaudeSettings`, `provisionProject`, `validateAgentHookSettingsShape`, and any additional function selected for modification. Review direct callers, affected processes, and risk before edits.
   - If a new HIGH/CRITICAL result appears, stop and report it before editing.
   - Acceptance: AC10/AC12; safety prerequisite, not a user-visible feature.

3. **Add the Node.js hook script**
   - File: proposed `.claude.example/hooks/sanitize-agent-input.mjs`.
   - Implement stdin collection, JSON parse validation, object/`tool_input` validation, own-property checks, exact removal, exact `additionalContext`, newline-terminated JSON output, and status `2` errors.
   - Do not add dependencies or alter unrelated runtime behavior.
   - Exit condition: direct child-process cases for all valid/invalid input categories are specified and executable.
   - Acceptance: AC5, AC6, AC9, AC10.

4. **Add focused script tests first**
   - File: proposed `test/setup/agent-input-hook.test.mjs`.
   - Use `node:test`, `spawnSync`/equivalent, parsed stdout, stderr, and exit status. Add required test cards to each new test/group.
   - Cover six valid and six invalid categories from the specification, including nested preservation and null values.
   - Exit condition: tests fail for a missing/incorrect script and pass only for the specified observable contract.
   - Acceptance: AC5, AC6, AC11, AC12.

5. **Implement managed settings reconciliation**
   - File: `src/setup/settings.mjs`.
   - Add the smallest `validateAgentHookSettingsShape(settings)` preflight and transformation/helper needed to reconcile the canonical Agent entry and exact legacy jq entries while preserving unrelated settings/hooks and current malformed/tracked/dry-run behavior.
   - Validate the merged settings before any settings write, sanitizer-script copy, or other managed mutation. A present non-array `hooks.PreToolUse` must fail with actionable repair/rerun guidance; the original settings bytes and sanitizer-script state must remain unchanged.
   - Integrate reconciliation only into full setup's `writeClaudeSettings`; do not call it from `updateClaudeAttribution` or `updateClaudePermissions`.
   - Reassess the HIGH impact result before editing and inspect the diff immediately after the edit.
   - Exit condition: direct transformation fixtures demonstrate deduplication, exact migration, extra-field near-miss preservation, malformed-shape rejection, non-PreToolUse preservation, and stable unrelated ordering.
   - Acceptance: AC1–AC4, AC7, AC8, AC10.

6. **Integrate script copying into full provisioning**
   - Files: `src/setup/settings.mjs`, `src/setup/provision.mjs`.
   - Run the merged-settings preflight before the mutation phase. After validation succeeds, write settings and copy the sanitizer script inside the existing snapshot/rollback transaction; preserve the existing attribution-copy behavior and ensure rollback restores both settings and hook-directory contents.
   - Add a copy helper following the existing attribution-hook pattern and call it from the main setup provisioning path for all pipelines. Propagate `dryRun`/`silent`; do not install from attribution/permission updates.
   - Exit condition: fresh/rerun/dry-run fixtures verify file and settings behavior across `ecc`, `gstack`, `both`, and `none`.
   - Acceptance: AC1, AC2, AC7, AC8, AC12.

7. **Add package allowlist coverage**
   - File: `package.json`; focused test file.
   - Add only the new template script to `files`. Inspect actual `npm pack --dry-run` output rather than asserting source text alone.
   - Exit condition: package dry-run lists the script and no dependency/CLI surface changes exist.
   - Acceptance: AC9, AC10, AC12.

8. **Extend existing settings/update regression assertions**
   - Files: `test/setup/mcp-and-settings.test.mjs`, `test/setup/provision-and-pipelines.test.mjs`, and the focused process test file only where each case belongs.
   - Keep process/stdin/package cases in `test/setup/agent-input-hook.test.mjs` if its groups remain readable; put settings/update-helper cases beside existing settings helpers and rollback/failure-injection cases beside provisioning helpers. Do not create a second broad fixture file solely to separate headings.
   - Change the attribution assertion at the documented location to locate `_repo_pattern_source: "generated-attribution-removal"` if the new Agent entry changes order; retain the semantic assertion.
   - Add tests for D2 preflight failure before write: settings bytes unchanged, sanitizer script absent/pre-existing bytes unchanged, actionable repair/rerun stderr, and no managed mutation. Add separate injected settings-write and hook-copy failures that assert existing provisioning rollback restores pre-existing `.claude/settings.json` and `.claude/hooks` contents.
   - Add malformed non-`PreToolUse` preservation and legacy extra-field near-miss tests. Add tests that update helpers neither install nor remove the Agent hook.
   - Ensure every new/changed test card is present.
   - Exit condition: existing attribution, permissions, dry-run, malformed, tracked, symlink, plugin, and rollback tests remain meaningful.
   - Acceptance: AC3, AC4, AC7, AC8, AC11, AC12.

9. **Document behavior and limits**
   - File: `docs/repo-pattern/setup-guide.md`.
   - Add a concise section covering always-installed-on-setup behavior, removal of per-Agent `effort`/`isolation` selection for all providers, Node.js prerequisite, no jq prerequisite, matcher scope, and explicit limitation that this is not general worktree prevention. Mention rerun requirement and local rollback removal by managed marker where appropriate.
   - Acceptance: AC1, AC9, AC10, and the common no-claim boundary.

10. **Focused and full verification**
    - Run focused Agent-hook/settings tests, then `npm test`, then `npm run pack:dry` on the final tree. Report each actual command, exit status, counts, and failing lines without suppressing stderr.
    - Include path-with-spaces runtime and dry-run checks. Do not run live providers or paid evaluations.
    - Run `mcp__gitnexus__detect_changes` with `scope: "all"` before any commit; no commit is authorized by this plan.
    - Acceptance: AC7, AC9, AC11, AC12 and regression safety.

## Test matrix

| Layer | Fixture/case | Observable assertion | Failure injection/boundary | Acceptance IDs |
|---|---|---|---|---|
| Unit/process | Valid input with neither field | Exit `0`, stdout exactly `{}` plus newline, no stderr requirement | Empty `tool_input` and unrelated fields | AC5 |
| Unit/process | `effort` only; `isolation` only; both | Exit `0`, parsed `updatedInput` omits both fields | Values `null`, `false`, `0`, empty string, empty object | AC5 |
| Unit/process | Nested data | All unrelated top-level and nested JSON values preserved | Nested keys named `effort`/`isolation` remain nested | AC5 |
| Unit/process | Prompt/model preservation | Exact values preserved | Long Unicode/string values and empty values | AC5 |
| Validation/process | Invalid JSON | Exit `2`, explanatory stderr, no stdout `updatedInput` | Truncated JSON, whitespace-only input | AC6 |
| Validation/process | Invalid top-level values | Exit `2` for string/number/null/array | Valid JSON but non-object | AC6 |
| Validation/process | Invalid `tool_input` | Exit `2` for missing, null, array, primitive | Object top-level with malformed field | AC6 |
| Settings unit | Fresh merged settings | One canonical entry, unrelated settings retained | Existing settings absent or empty hooks | AC1, AC4 |
| Settings unit | Rerun/deduplication | Exactly one managed entry after repeated reconciliation | Multiple managed entries | AC2 |
| Settings unit | Legacy migration | Exact jq entry removed and canonical entry present | Different matcher/command/type/timeout, or any extra property on the entry/sole hook | AC3 |
| Settings unit | Mixed-entry preservation | Unrelated/mixed entries unchanged and in relative order | Legacy-like entry with extra hook or extra field | AC3, AC4 |
| Settings unit | D2 preflight failure | Setup fails before write/copy; settings bytes and sanitizer-script state unchanged; stderr gives repair/rerun guidance | Present non-array `hooks.PreToolUse` | AC4, AC7 |
| Settings unit | Other event-shape preservation | Non-array `PostToolUse` and unrelated arrays survive verbatim while Agent reconciliation succeeds | Only `PreToolUse` has the required array boundary | AC4 |
| Provision rollback | Settings-write injection | Pre-existing settings and `.claude/hooks` contents restored | Inject write failure after snapshot | AC7, AC12 |
| Provision rollback | Hook-copy injection | Pre-existing settings and `.claude/hooks` contents restored | Inject sanitizer copy failure after settings mutation | AC7, AC12 |
| Setup integration | Four pipelines | Script and settings installed for `ecc`, `gstack`, `both`, `none` | Pipeline-specific downstream work is fixture-controlled | AC1 |
| Setup integration | Dry-run | No script, settings, or hook-directory mutation | Preexisting files and absent files | AC7 |
| Update-helper regression | Attribution helper | Missing Agent hook stays absent; installed one remains | Existing attribution hook still updated | AC8 |
| Update-helper regression | Permission helper | Agent hook state unchanged | Permission fields still change as before | AC8 |
| Filesystem/runtime | Path containing spaces | Installed quoted command launches script and returns expected response | `$CLAUDE_PROJECT_DIR` with spaces | AC9 |
| Packaging | Actual npm dry-run | Package listing contains script | No new package dependency | AC9, AC10 |
| Regression | Existing settings/provision suites | Existing behavior remains covered and passes | Malformed/tracked settings, symlink safety, rollback | AC4, AC7, AC12 |
| CI | `npm test`; `npm run pack:dry` | Actual exit statuses recorded | No live provider or paid evaluation | AC9, AC12 |

**Common no-claim boundary:** passing local tests does not establish behavior on every Claude Code version/provider, guarantee that a live Agent session honors `updatedInput`, prevent worktree creation through Bash/Git, or validate a real provider dispatch. The matcher is limited to `Agent`.

## Failure-mode and risk register

| Risk/severity | Detection | Mitigation | Recovery/rollback |
|---|---|---|---|
| HIGH: shared `writeClaudeSettings` changes alter all setup pipelines | GitNexus impact, focused settings tests, full suite | Narrow pure reconciliation; preserve existing merge and malformed/tracked guards; inspect diff | Revert code; restore settings from existing provision snapshot/backup if an implementation run fails |
| HIGH: unrelated user hooks removed/reordered | Seeded preservation fixtures and deep comparison | Filter only exact managed marker/legacy predicate; preserve remaining arrays | Remove only managed marker entry manually; restore from backup if unexpected mutation occurred |
| HIGH: unsafe broad legacy migration | Exact predicate tests with near-miss commands | Require exact matcher, one hook, type, command, timeout | Leave near misses untouched; no automatic cleanup beyond exact match |
| MEDIUM: dry-run writes script/directory/settings | Before/after file inventory and bytes | Thread `dryRun` through copy/write helpers; no direct filesystem writes | Delete only newly created managed artifact if a regression is found; preserve user files |
| MEDIUM: command fails under spaces or missing environment | Spawn installed command from spaced target path | Quote `$CLAUDE_PROJECT_DIR`; use Node child process fixture | Remove managed hook/script and rerun setup after correction |
| MEDIUM: malformed stdin emits partial sensitive output | Process tests inspect stdout/stderr/status | Validate before constructing response; exit `2` on errors | Replace script with prior package version; no settings rollback needed for process-only defect |
| MEDIUM: hook ordering breaks existing positional test or consumer | Existing attribution assertion and full test suite | Locate managed attribution by source marker; preserve unrelated order | Revert ordering change or update only justified test assumption |
| MEDIUM: package omits runtime asset | `npm pack --dry-run` listing | Explicit `package.json.files` entry | Publish no release until package listing includes script |
| LOW: docs overclaim provider/worktree guarantees | Documentation review against out-of-scope list | State matcher scope, provider uncertainty, and no jq requirement | Correct docs without changing runtime behavior |
| LOW: update helper accidentally installs hook | Dedicated helper fixture for missing/present states | Keep new copy/reconcile calls solely on full setup path | Revert helper integration and rerun regression tests |

## Out of scope and open questions

### Explicitly out of scope

- Global settings and existing workspaces without rerunning setup.
- General worktree prevention through Bash/Git.
- Provider-specific behavior, configurable stripping, opt-out, setup prompt, or CLI flag.
- jq installation, new dependency, top-level `effortLevel` changes.
- Live provider calls and paid evaluations.
- Changes to attribution/permission update commands beyond preserving their current Agent-hook behavior.

### Resolved decisions and verification notes

1. **Canonical managed entry location:** append after preserved entries; this is final and preserves all existing relative ordering.
2. **Non-array `hooks.PreToolUse`:** fail before writing or copying, preserve settings bytes and sanitizer-script state, and show repair/rerun guidance. This is final under D2 and has explicit fixtures in the task and test matrix.
3. **Other event values:** preserve non-array values verbatim and do not iterate them; only `PreToolUse` has the required array boundary for this feature.
4. **Legacy extra fields:** any extra property on the candidate legacy entry or its sole hook invalidates migration; the near-match remains unchanged. This is final and tested.
5. **Error message exactness:** use stable explanatory category messages; only status/no-`updatedInput`/useful stderr are contractual.
6. **Existing non-regular/symlink hook script:** follow existing `copyRecursive` and symlink safeguards; do not broaden filesystem behavior without a separate impact review. The issue requires dry-run and path safety but does not request a new destructive cleanup path.
7. **No implementation baseline results yet:** commands have not been run in this planning pass; the implementing agent must establish and report baseline/final results rather than infer results.

## Review applicability

The Issue/SPEC describes a CLI/setup runtime hook, JSON settings reconciliation, packaging, tests, and documentation. It establishes no UI surface, visual component, browser flow, or design-system change. **Design review is skipped with `no_ui_scope`.** No Engineering, DX, autoplan, or gstack review phase is added to this draft.

## Implementation-ready checklist

- [ ] Issue and canonical archive requirements reconciled; no contradiction silently resolved.
- [ ] Existing setup/provision/settings entrypoints and callers identified.
- [ ] HIGH impact on `writeClaudeSettings` recorded; implementation must rerun impact before edits.
- [ ] Four setup pipelines and dry-run path covered.
- [ ] Exact managed marker and exact legacy migration predicate defined.
- [ ] Unrelated hooks/settings preservation and ordering covered.
- [ ] Script valid/invalid input contract covered with real child processes.
- [ ] Path-with-spaces command and npm package listing covered.
- [ ] Attribution/permission update boundaries covered.
- [ ] Every new test has the required protects/fails_when/no_claim card.
- [ ] Documentation states Node.js prerequisite, no jq prerequisite, always-installed setup behavior, and limitations.
- [ ] Focused tests, `npm test`, and `npm run pack:dry` run and reported by the implementing agent.
- [ ] `detect_changes()` run before any commit; no commit authorized here.

## Readiness conclusion

**Draft reviewed and consolidated.** Requirements AC1–AC12 are mapped to proposed code paths and tests. Canonical entry placement, malformed hook-array handling, legacy extra-field matching, preflight ordering, rollback injection points, and test placement are resolved as implementation constraints. No implementation code or tests were changed, no feature was executed, and no implementation, Design, Engineering, DX, autoplan, commit, merge, or deploy work was performed.

**IMPLEMENTATION_PLAN_PATH:** `/home/kirin/Code/my-hobby/repo-pattern/docs/plans/issue-109-agent-input-sanitization.md`

## CEO REVIEW LEDGER

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| D1 — CEO review | Review posture selected through native UI; issue #109 is an added capability with explicit limits. | Four review modes available. | HOLD SCOPE: review required behavior, failure paths, tests, rollback, documentation; no optional expansions. | approved | User selected “HOLD SCOPE”; applies only to this review’s scope. |
| D2 — Implementation owner | Valid JSON may contain `hooks.PreToolUse` with a non-array value; AC1 requires installation and AC4/AC7 require preservation/safe failure. | Existing settings code expects hook arrays but does not define malformed event handling. | Fail before writing, preserve the original settings and script state, emit an actionable setup error, and require repair/rerun. | approved | User selected “Fail before writing (recommended)”; applies only to full setup settings reconciliation for non-array `hooks.PreToolUse`. |

## CEO REVIEW REALITY CHECK

- REALITY: premise-table finding current setup has no Agent sanitizer and issue requires one `src/setup/settings.mjs:20-80` `package.json:51-67`
- REALITY: already-done pass upstream history contains adjacent commit-hook work but no issue-109 implementation `git log origin/main --since=2026-11-25 -- src/setup/settings.mjs src/setup/provision.mjs` receipt=`origin/main@10d4c73`
- REALITY: surface-check pass setup/mcp/upgrade-gstack are the existing CLI surfaces and no public update command exists `src/cli.mjs:167-205`
- REALITY: binding-decisions pass no branch decision supersedes the issue/spec; review mode is recorded as D1 `docs/plans/issue-109-agent-input-sanitization.md:324-327`
- REALITY: numbers pass AC count is 12 and the HIGH impact result is recorded from the actual GitNexus query `docs/plans/issue-109-agent-input-sanitization.md:67-82` `docs/plans/issue-109-agent-input-sanitization.md:166-168`
- REALITY: deferred-asks pass no explicit issue request is omitted; out-of-scope items are named from the issue/spec `docs/plans/issue-109-agent-input-sanitization.md:277-286`
- REALITY: pr-count pass repository policy defaults to one PR per wave `.claude/skills/gstack/.gstack/ship-policy.json:14`

## CEO REVIEW — CURRENT SCOPE

- **Accepted:** Issue/spec AC1–AC12, Node.js hook, exact legacy migration, settings preservation, four setup pipelines, dry-run behavior, update-helper boundary, package/docs changes, and required tests.
- **Deferred:** None.
- **Rejected:** Live provider evaluation, jq installation, opt-out/configuration, global settings, general Bash/Git worktree prevention, and unrelated behavior changes, exactly as required by the issue/spec.
- **Mode:** HOLD SCOPE, selected by the user in D1. No expansion proposals are being considered.

## CEO REVIEW SECTIONS 1–10

### Section 1: Architecture Review

**Current scope:** D1 approved HOLD SCOPE. D2 approved fail-before-writing for non-array `hooks.PreToolUse`; the settings contract is now explicit.

The proposed boundaries are appropriate: the stdin hook is a standalone Node.js runtime asset; setup-only copying belongs beside the existing attribution copy helper; settings reconciliation belongs in the shared settings transformation; update helpers remain unchanged. The HIGH blast radius of `writeClaudeSettings` is real and documented.

```text
CLI setup
  |
  v
setupProject -- setup options/dryRun
  |
  v
provisionProject -- backup/rollback + four pipelines
  |                         \
  v                          v
writeClaudeSettings       copy hook script
  |                          |
  v                          v
.claude/settings.json   .claude/hooks/sanitize-agent-input.mjs
  |
  v
Claude Code PreToolUse matcher ^Agent$
  |
  v
stdin JSON -> validate -> remove top-level effort/isolation -> stdout JSON
```

**Happy path:** valid settings and array-shaped `PreToolUse` produce one canonical entry; setup copies the script only after preflight passes; Claude invokes Node; valid input produces `{}` or sanitized `updatedInput`.

**Nil path:** missing settings uses the template; missing `hooks` or missing `PreToolUse` is treated as an empty event list and receives the canonical entry. A present non-array `PreToolUse` fails preflight before any write/copy; other event values are preserved verbatim.

**Empty path:** empty hook arrays are valid and receive the canonical entry; empty `tool_input` emits `{}`.

**Error path:** malformed settings abort before write; invalid stdin exits 2 with stderr and no `updatedInput`; setup copy/write failures flow through existing rollback boundaries.

**State machine:** the hook is stateless. Settings transition is idempotent:

```text
unknown/current settings
        |
        +-- malformed JSON/non-array PreToolUse --> fail before write/copy; preserve bytes; repair/rerun
        |
        v
remove owned/exact legacy entries
        |
        v
append one canonical entry
        |
        v
stable managed settings
```

No new endpoint, database, authentication boundary, background job, or persistent state exists. At 10x/100x setup volume, work is still bounded by one settings parse/write and one script copy per setup; the main single point of failure is shared settings reconciliation. Rollback is the existing provisioning snapshot for setup failures; a post-install defect is removed by the marker-based manual rollback described in the plan.

**Decision gate:** architecture is acceptable for HOLD SCOPE. Non-array `hooks.PreToolUse` fails before writing under approved D2; no optional infrastructure or observability expansion is added.

### Section 2: Error & Rescue Map

| Codepath | Failure | Exception/status | Rescue/action | User sees |
|---|---|---|---|---|
| stdin JSON parser | Invalid JSON/empty stdin | `SyntaxError`/validation error | Write explanatory stderr; exit 2; no stdout response | Hook failure visible to Claude Code |
| `tool_input` validator | Missing/null/array/primitive | validation error | Write explanatory stderr; exit 2 | Hook failure visible to Claude Code |
| settings reader | Malformed `.claude/settings.json` | `SyntaxError` | Existing explicit error; no settings write | Setup error and recovery instruction |
| settings reconciliation | Non-array `hooks.PreToolUse` | approved D2 | Fail before any settings/script write; preserve bytes/state and report repair/rerun guidance | Setup error; repair settings and rerun |
| hook copy | Missing source/read/write/permission failure | filesystem error | Existing provisioning rollback path | Setup failure/recovery output |
| settings writer | write/permission failure | filesystem error | Existing rollback path | Setup failure/recovery output |
| package assembly | allowlist omission | package listing mismatch | Block release verification | Maintainer sees failed packaging check |

No catch-all rescue is proposed. Existing setup rollback handles provisioning exceptions; the hook intentionally fails closed on invalid input. Approved D2 fails before writing on non-array `hooks.PreToolUse` and preserves the original settings/script state.

### Section 3: Security & Threat Model

- **Input boundary:** stdin is untrusted JSON. The plan validates top-level and `tool_input` object shape, uses own-property checks, removes only the two specified top-level keys, and preserves nested data. Invalid input fails closed with status 2.
- **Command/path boundary:** the installed command quotes `$CLAUDE_PROJECT_DIR`; the path-with-spaces test exercises this. No new shell interpolation or dependency is introduced.
- **Settings mutation boundary:** only full setup writes the managed Agent entry; exact marker/legacy matching limits migration. Unrelated hooks and settings must remain unchanged.
- **Dependency risk:** no dependency is added; Node.js is already an engine requirement.
- **Scope limitation:** the hook does not prevent Bash/Git worktree creation and does not claim provider-wide enforcement; this is explicitly documented.

No new secrets, endpoints, or authorization paths are introduced. Main security risk is destructive settings reconciliation if D2 is left unresolved or if matching is broader than exact; the plan’s exact predicate and preservation tests mitigate the latter.

### Section 4: Data Flow & Interaction Edge Cases

```text
stdin bytes
  -> JSON.parse
  -> top-level object check
  -> tool_input non-null/non-array object check
  -> own-property check
  -> shallow delete effort/isolation
  -> JSON.stringify + newline
  -> Claude Code hook response

shadow paths:
invalid bytes/JSON -> stderr + exit 2 -> no response
wrong top-level type -> stderr + exit 2 -> no response
missing/invalid tool_input -> stderr + exit 2 -> no response
empty object -> {} + newline
nested effort/isolation -> preserved because transform is top-level only
```

The flow has no awaits or concurrent shared mutation inside the script. Setup does have multiple filesystem awaits, but existing snapshot/rollback boundaries and serialized `node:test` execution cover the relevant ordering. Tests must still assert before/after bytes for dry-run and preservation fixtures. There is no user navigation, double-click, back-button, or external timeout interaction in this CLI hook.

**Decision gate:** required data/error cases are mapped; the approved D2 failure path is explicit and testable.

### Section 5: Code Quality Review

The plan reuses existing settings and copy helpers and avoids a new abstraction layer. The likely implementation is a small pure reconciliation helper plus a small standalone script. Do not duplicate the canonical hook object in multiple modules unless an existing repository pattern requires it; keep the exact command/marker definition in one settings-side source of truth where practical. No method is expected to exceed the plan’s complexity ceiling; if it does, split only the transformation predicates, not into speculative services.

**Finding:** the current plan’s test file is proposed to cover script, settings, setup, package, and runtime cases; that breadth is acceptable only if the file remains readable. No scope change is required. The approved D2 rule must be covered by a fixture asserting failure before write and byte preservation.

### Section 6: Test Review

The plan’s matrix covers the required script, validation, setup, update-helper, package, path, dry-run, and regression paths. The strongest ship-confidence test is the real child-process matrix plus a fresh setup under a target path containing spaces, followed by the full `npm test` suite. A hostile QA test should seed near-miss legacy entries and assert they are byte/value preserved while exact legacy entries migrate. The chaos tests inject settings-write and hook-copy failures at separate points and assert existing provisioning rollback leaves pre-existing settings and hook-directory contents intact. D2 also has a preflight test that fails before either mutation and asserts settings bytes/script state plus actionable repair/rerun stderr.

```text
new script path          -> process tests: valid + invalid stdin
settings reconciliation  -> settings fixtures: dedupe + exact migration + preservation
full setup integration   -> pipeline/dry-run fixtures: copy + settings + rollback
package allowlist        -> npm pack dry-run listing
update helpers           -> helper fixtures: missing/present Agent hook unchanged
```

**Finding:** the issue’s “20” is a test-case planning count, not a verified test count. The plan correctly labels it as specification data; the implementer must report actual test counts and not promise exactly 20 test functions. No additional test scope is added.

### Section 7: Performance Review

No database, network, polling, or background job is introduced. The hook parses one tool-input JSON document and serializes it once; setup parses/writes one settings document and copies one small script. Memory and latency scale with input/settings size, which are bounded by the existing settings/tool protocol rather than a new unbounded collection. No cache, index, or load test is warranted under HOLD SCOPE.

### Section 8: Observability & Debuggability Review

The hook’s user-visible failure signal is stderr plus exit 2; successful sanitization is visible in the returned hook response. Setup failures use existing error/rollback output. A new metrics/dashboard system would be outside the issue and is not proposed. Documentation must retain the explicit no-live-provider and no-general-worktree-prevention boundary so operators do not mistake local fixture success for provider enforcement.

**Finding:** no silent failure is acceptable for invalid stdin or settings writes. The plan now requires status/stderr assertions plus D2’s fail-before-write behavior for a malformed hook-array shape, preventing silent skipping or destructive coercion.

### Section 9: Deployment & Rollout Review

This is an npm package/template rollout, not a database migration. The package allowlist must ship the script and setup must be rerun to install it in existing workspaces. Rollback has two layers:

```text
package rollback -> future setup stops installing new hook
existing workspace -> remove only marked settings entry + script
unrelated hooks/settings -> preserve throughout
```

The first five-minute smoke check is `npm run pack:dry`, a fresh setup fixture, and the installed command from a spaced path. No feature flag is appropriate because the issue explicitly forbids an opt-out and requires default installation. Existing workspaces remain unchanged until rerun, which is a documented compatibility boundary.

### Section 10: Long-Term Trajectory Review

The design is reversible: marker-based removal and script deletion make rollback straightforward (reversibility 5/5). Main debt is a second managed-hook reconciliation rule in a shared settings module and the need to preserve exact legacy string compatibility. The plan mitigates this with source markers, exact predicates, focused tests, and documentation. A new engineer should understand the path from `provisionProject` to the installed hook from the architecture section and setup guide. No future platform expansion is added under HOLD SCOPE.

### Section 11: Design & UX Review

**SKIPPED (no UI scope).** Full Issue/SPEC evidence covers CLI setup, JSON settings, a local Node.js hook, package files, tests, and setup documentation only. It specifies no UI screen, component, frontend framework, user-visible interactive state, mobile/responsive behavior, or design system.

## NOT IN SCOPE

- Live Claude/provider evaluation or claims of provider acceptance.
- Bash/Git worktree prevention outside the `Agent` PreToolUse matcher.
- Global settings migration, automatic changes to workspaces that do not rerun setup, or an opt-out/configuration surface.
- jq installation, new dependencies, setup prompts, CLI flags, top-level `effortLevel` changes.
- Optional observability dashboards/metrics and unrelated refactors.

## WHAT ALREADY EXISTS

- `writeClaudeSettings` already merges template/current settings, applies managed settings, handles malformed JSON, and honors dry-run.
- `applyGeneratedAttributionHook` demonstrates source-marker ownership and managed-entry replacement.
- `copyGeneratedAttributionHook` demonstrates template-to-target runtime asset copying.
- `provisionProject` already supplies four pipeline paths, snapshot/rollback, and dry-run propagation.
- Existing `node:test` fixtures and `npm pack --dry-run` provide the requested verification mechanisms.

## DREAM STATE DELTA

```text
CURRENT STATE                 THIS PLAN                         12-MONTH IDEAL
Agent args may be rejected    Setup installs a marked Node hook  A maintained hook contract
or request worktree behavior  that strips two top-level args     across supported providers
without local sanitization -> and preserves other input      -> with explicit compatibility proof
```

This plan moves directly toward safer provider-compatible Agent dispatch, but intentionally does not claim the full ideal because live provider compatibility and non-Agent worktree paths are outside the issue.

## ERROR & RESCUE REGISTRY

| Codepath | Exception/status | Rescued? | Rescue action | User sees |
|---|---|---|---|---|
| Hook JSON parse | invalid JSON/empty stdin | yes | stderr + exit 2; no response | hook failure |
| Hook input shape | invalid top-level or `tool_input` | yes | stderr + exit 2; no response | hook failure |
| Settings read | malformed JSON | yes | existing explicit setup error; no write | setup error |
| Settings shape | non-array `PreToolUse` | yes | fail before writing; preserve original settings/script state; report actionable repair guidance | setup error |
| Hook copy | filesystem error | yes | existing provisioning rollback | setup failure/recovery |
| Settings write | filesystem error | yes | existing provisioning rollback | setup failure/recovery |
| Package listing | omitted asset | yes | packaging check blocks release | maintainer failure |

## FAILURE MODES REGISTRY

| CODEPATH | FAILURE MODE | RESCUED? | TEST? | USER SEES? | LOGGED? |
|---|---|---:|---:|---:|---:|
| stdin hook | Invalid JSON or shape | Y | Y | Y (stderr/status) | N/A |
| settings read | Malformed JSON | Y | Y | Y (setup error) | N/A |
| settings reconcile | Non-array `PreToolUse` | Y | Y | Y (actionable repair/rerun setup error) | N/A |
| settings reconcile | Non-array unrelated event value | Y | Y | Y (preserved verbatim) | N/A |
| hook copy | Read/write/permission failure | Y | Y | Y (rollback/recovery) | N/A |
| provisioning rollback | Injected settings-write or hook-copy failure | Y | Y | Y (rollback/recovery) | N/A |
| settings write | Read/write/permission failure | Y | Y | Y (rollback/recovery) | N/A |
| package | Script omitted from npm files | Y | Y | Y (pack check) | N/A |

No `RESCUED=N, TEST=N, USER SEES=Silent` critical row is accepted; D2 now has an explicit fail-before-write rescue and test.

## TEMPORAL INTERROGATION

- **Hour 1 foundations:** apply approved D2, run impact for every changed symbol before edits, and establish the clean baseline.
- **Hours 2–3 core logic:** implement the standalone script and settings predicate; run child-process and settings preservation tests before integration.
- **Hours 4–5 integration:** wire copy/reconciliation into `provisionProject`; exercise all four pipelines, rerun/deduplication, dry-run, rollback, and update-helper boundaries.
- **Hour 6+ polish/tests:** verify package listing, path-with-spaces execution, documentation, full `npm test`, `npm run pack:dry`, and `detect_changes` before any commit.

Human-team effort remains the issue estimate: approximately 3.5 hours total; CC+gstack approximately 55 minutes, both `[estimated]` and to be re-measured by the implementer. These are planning estimates, not test results.

## REALITY CHECK SUMMARY

REALITY: premise-table finding current setup has no Agent sanitizer and issue requires one `src/setup/settings.mjs:20-80` `package.json:51-67`
REALITY: already-done pass no issue-109 implementation appears in upstream history `git log origin/main --since=2026-11-25 -- src/setup/settings.mjs src/setup/provision.mjs`
REALITY: surface-check pass existing CLI commands and absence of public update command verified `src/cli.mjs:167-205`
REALITY: binding-decisions pass no superseding branch decision; D1 is the only review-mode decision `CEO REVIEW LEDGER:D1`
REALITY: numbers pass AC1–AC12 and prior HIGH impact are source-backed; estimates remain tagged `[estimated]` `docs/plans/issue-109-agent-input-sanitization.md:67-82` `docs/plans/issue-109-agent-input-sanitization.md:166-168`
REALITY: deferred-asks pass all explicit requests retained; out-of-scope items are named `docs/plans/issue-109-agent-input-sanitization.md:277-286`
REALITY: pr-count pass one PR per wave from `.gstack/ship-policy.json`

## PLAN_REALITY

The first reality-check command reported missing rows because the plan had not yet recorded them. The rows are now recorded above; rerun `gstack-plan-reality check --phase ceo` after this checkpoint and require a passing result before finalization.

## IMPLEMENTATION TASKS FROM CEO REVIEW

_No new implementation tasks beyond the existing issue/spec task list. The existing implementation tasks must include D2’s fail-before-write fixture before coding proceeds._

## COMPLETION SUMMARY

- Mode selected: HOLD SCOPE.
- System audit: clean working tree before review; no issue-109 implementation upstream; no TODOs file; one PR policy; prior reviews are stale/unrelated to this plan.
- Step 0: D1 approved HOLD SCOPE; D2 approved fail-before-writing for non-array `hooks.PreToolUse`; malformed event boundaries, legacy extra-field matching, preflight ordering, rollback injection points, and test placement are now explicit final constraints.
- Sections 1–10: architecture/error/security/data/code/test/performance/observability/deployment/trajectory reviewed; the CEO findings were consolidated into explicit preflight, malformed-shape, migration, and rollback requirements.
- Section 11: SKIPPED (no UI scope).
- NOT in scope: written, 5 categories.
- What already exists: written.
- Dream state delta: written.
- Error/rescue registry: 7 rows, 0 critical gaps accepted; 0 pending rows.
- Failure modes: 8 rows, 0 critical gaps accepted; 0 pending rows.
- TODOS.md updates: 0.
- Scope proposals: 0 proposed, 0 accepted.
- CEO plan: skipped by HOLD SCOPE mode.
- Outside voice: Codex execution was unavailable because its refresh token was revoked and the request returned HTTP 401; this remains missing coverage, not a clean pass.
- Lake Score: N/A (mode choice unscored).
- Diagrams produced: architecture, data flow, state machine, rollback, dream-state.
- Stale diagrams found: 0.
- Unresolved decisions: 0; all prior review questions are resolved below and retained as final implementation constraints.
- Reality rows: 7/7 recorded; unverified=0.

## APPROVAL READINESS

**PASS:** The CEO findings are resolved in the plan. D1 is the user-selected HOLD SCOPE mode; D2 is the user-selected fail-before-writing rule for non-array `hooks.PreToolUse`. The plan now names preflight ordering and helper, rollback injection points, malformed-event boundaries, exact legacy matching, and test placement. Scope remains limited to AC1–AC12 and the Issue/SPEC non-goals.

## GSTACK REVIEW REPORT

| Run | Status | Findings |
|---|---|---|
| CEO review | PASS | All seven findings resolved: preflight validation/order and byte/state assertions; settings-write and hook-copy rollback injections; non-PreToolUse preservation boundary; legacy extra-field decision; open-question consistency; archive-only provenance wording; and helper-based test placement. |
| Design review | SKIPPED | `no_ui_scope`; the Issue/SPEC defines CLI setup, JSON settings, a local hook, packaging, tests, and documentation only. |
| Codex outside review | UNAVAILABLE | Execution failed with revoked refresh token / HTTP 401. No outside findings were produced; this is missing coverage, not a pass. |
| Plan reality check | PASS | `7/7` reality rows recorded; no missing receipts reported. |

**VERDICT:** PASS — the plan is implementation-ready, but implementation remains prohibited by the user’s scope.

**CEO finding dispositions:**

1. **Resolved:** `validateAgentHookSettingsShape(settings)` is named; it runs after merge and before any settings write, sanitizer-script copy, or other managed mutation. Tests assert unchanged settings bytes, unchanged sanitizer-script state, and actionable repair/rerun stderr.
2. **Resolved:** separate settings-write and hook-copy failure injections are required; both assert existing provisioning rollback restores pre-existing `.claude/settings.json` and `.claude/hooks` contents.
3. **Resolved:** only present non-array `hooks.PreToolUse` fails; other event values are preserved verbatim and not iterated. A dedicated preservation fixture is required.
4. **Resolved:** any extra property on a candidate legacy entry or its sole hook invalidates migration; the near-match remains untouched.
5. **Resolved:** open questions were converted to final decisions or verification notes; completion and readiness claims now agree that unresolved decisions are zero.
6. **Resolved:** provenance now states only what the canonical archive establishes and makes no unsupported equivalence claim about unquoted issue text.
7. **Resolved:** existing process, settings, and provisioning helpers determine placement; one focused file is retained only while readable, with no second broad fixture created for appearance.

Outside coverage is unavailable because Codex authentication failed. No implementation, source/test change, commit, merge, deployment, branch change, or worktree change was performed by this review.

<!-- KFLOW_REVIEW_COMPLETION_BEGIN -->

```json
{
  "issueUrl": "https://github.com/NegiKirin/repo-pattern/issues/109",
  "specArchivePath": "/home/kirin/Code/my-hobby/repo-pattern/.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/specs/20261125-190059-issue-109-agent-input-sanitization.md",
  "reviews": {
    "ceo": {
      "status": "completed",
      "outcome": "PASS after consolidation; all seven CEO findings were explicitly disposed in the saved plan.",
      "evidence": "GSTACK REVIEW REPORT in this plan: CEO review PASS and CEO finding dispositions 1-7."
    },
    "design": {
      "status": "skipped",
      "reason": "no_ui_scope",
      "evidence": "GSTACK REVIEW REPORT Section 11: full Issue/SPEC scope is CLI setup, JSON settings, local hook, packaging, tests, and documentation with no UI surface."
    }
  },
  "findings": [
    {
      "id": "ceo-preflight-order-and-preservation",
      "severity": "high",
      "disposition": "resolved",
      "task": "Implement validateAgentHookSettingsShape(settings) before any settings write, sanitizer-script copy, or managed mutation; test unchanged settings bytes, unchanged script state, and actionable repair/rerun stderr.",
      "evidence": "GSTACK REVIEW REPORT CEO finding disposition 1; Resolved implementation decisions item 2; test matrix D2 preflight failure row."
    },
    {
      "id": "ceo-provisioning-rollback-injections",
      "severity": "high",
      "disposition": "resolved",
      "task": "Inject separate settings-write and hook-copy failures and assert rollback restores pre-existing .claude/settings.json and .claude/hooks contents.",
      "evidence": "GSTACK REVIEW REPORT CEO finding disposition 2; test matrix Provision rollback rows."
    },
    {
      "id": "ceo-non-pretooluse-shape-boundary",
      "severity": "medium",
      "disposition": "resolved",
      "task": "Preserve non-array unrelated hook-event values verbatim and test that only present non-array hooks.PreToolUse fails before mutation.",
      "evidence": "GSTACK REVIEW REPORT CEO finding disposition 3; Resolved implementation decisions item 3; test matrix Other event-shape preservation row."
    },
    {
      "id": "ceo-legacy-extra-fields",
      "severity": "medium",
      "disposition": "resolved",
      "task": "Reject legacy migration when the candidate entry or sole hook has any extra property, and test the near-match remains unchanged.",
      "evidence": "GSTACK REVIEW REPORT CEO finding disposition 4; Resolved implementation decisions item 4; test matrix legacy/mixed-entry rows."
    },
    {
      "id": "ceo-open-question-consistency",
      "severity": "medium",
      "disposition": "resolved",
      "task": "Keep canonical ordering, shape handling, legacy matching, and error wording as final decisions; retain zero unresolved decisions consistently.",
      "evidence": "GSTACK REVIEW REPORT CEO finding disposition 5; Resolved decisions and verification notes; final NO UNRESOLVED DECISIONS sentinel."
    },
    {
      "id": "ceo-provenance-wording",
      "severity": "informational",
      "disposition": "resolved",
      "task": "Use the canonical archive as the stated evidence source without claiming unquoted Issue/archive equivalence.",
      "evidence": "GSTACK REVIEW REPORT CEO finding disposition 6; Status and provenance line 8."
    },
    {
      "id": "ceo-test-file-placement",
      "severity": "informational",
      "disposition": "implementation_verification",
      "task": "Keep process/package cases in the focused test file only while readable; place settings and rollback cases beside existing helpers and avoid a second broad fixture.",
      "evidence": "GSTACK REVIEW REPORT CEO finding disposition 7; impacted-files test-placement note; ordered task 8."
    }
  ],
  "unresolvedMaterialDecisions": [],
  "implementationConditions": [
    "Before editing any implementation symbol, rerun GitNexus upstream impact for writeClaudeSettings, provisionProject, validateAgentHookSettingsShape, and any additional changed symbol; stop on new HIGH/CRITICAL risk.",
    "Run the D2 preflight, rollback injection, non-PreToolUse preservation, exact legacy near-miss, four-pipeline, dry-run, update-helper, path-with-spaces, package, focused, and full regression checks specified in the plan; report actual results.",
    "Run GitNexus detect_changes with scope all before any commit; no commit is authorized by this plan."
  ],
  "scopeChangedAfterReview": false
}
```

<!-- KFLOW_REVIEW_COMPLETION_END -->

NO UNRESOLVED DECISIONS
