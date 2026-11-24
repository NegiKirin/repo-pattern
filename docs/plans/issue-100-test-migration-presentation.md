# Implementation Plan: Native Test Migration and Feature Presentation

## Status and evidence

- **Draft status:** consolidated implementation plan; CEO and Design reviews completed before implementation. The implementation is complete on this branch; implementation evidence and final verification are recorded in `docs/plans/issue-100-test-migration-presentation.md.implementation.md`.
- **Issue source:** GitHub issue #100, `refactor: finish native test migration and isolate feature presentation`, open, created 2026-11-13. The issue explicitly does not authorize implementation by itself.
- **Canonical archive:** `/home/kirin/Code/my-hobby/repo-pattern/.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/specs/20261113-235025-issue-100-test-migration-presentation.md`. Its requirements materially match the Issue. Metadata says `spec_executed: false`; `outside_status: completed` means specification generation, not implementation completion.
- **Working tree:** this plan predates the implementation; the current branch contains the implementation changes and migrated native tests described by the sibling checkpoint.
- **Baseline evidence:** a delegated inspection reports `npm test` passed with 36 tests and no failures, `npm run check:module-limits` passed, and a real `npm pack` produced a 50-file archive. `npm run test:coverage`, `npm run measure:test-duration`, external installation smoke, and remote CI were not run during planning. These results are research evidence, not claims about the post-change state.
- **GitNexus:** static import-cycle check returned zero cycles. Fresh upstream impact analysis run during planning returned **CRITICAL** risk for `doctorProject` (22 impacted symbols, 12 direct callers, 10 affected processes, 4 modules), `generateMcp` (22, 5 direct callers, 10 processes, 4 modules), and `auditProject` (25, 10 direct callers, 11 processes, 4 modules). These risks must be reported before editing those symbols. `skills.mjs` target name was not resolved by the index; locate the exact exported symbol before editing and run impact on that symbol.

## 1. Goal and user problem

### Goal

Finish the boundary migration started by #97:

1. Put every test scenario and fixture under `test/`, with one native `node:test` execution mechanism.
2. Leave `scripts/` with the five development tools named by the Issue plus the branch-local `select-evals.mjs` prompt-evaluation selector.
3. Extract report rendering and MCP interaction from `src/doctor.mjs`, `src/mcp.mjs`, `src/audit.mjs`, and `src/skills.mjs` behind optional callback adapters supplied by CLI/setup callers.
4. Replace historical raw-byte gates with behavioral contracts while keeping the 11 historical baseline files byte-unchanged and documenting their limited historical role.
5. Preserve commands, flags, defaults, validation, exit codes, prompt order/keyboard behavior/cancellation/retry, generated files and paths, schemas, permissions, secret handling, symlink safety, backups, rollback, cleanup, recovery, upstream policies, and dependency/package versions.

### Current observed behavior

- `package.json:12` runs seven explicit native test files, `scripts/phase-1-characterization.test.mjs`, and then `node scripts/self-check.mjs`.
- `scripts/self-check/` contains 30 `.mjs` files and fixture assets. Several modules aggregate checks; file count is not scenario count. `scripts/self-check.test.mjs` is only an import wrapper.
- `test/gstack/gstack-contract.test.mjs` imports fixture helpers from `scripts/self-check/fixtures.mjs`.
- `scripts/phase-1-baseline/` contains 11 files consumed by `test/cli/cli-contract.test.mjs`, which currently compares stdout/stderr bytes and normalizes dry-run paths.
- `src/doctor.mjs` imports React/Ink, inspects TTY state, renders, and throws after rendering failed checks. `doctorProject` is called by CLI, provisioning, and tests.
- `src/mcp.mjs` collects prompts, warns via `console.warn`, and prints a summary. `generateMcp` is called by CLI, provisioning, and tests.
- `src/audit.mjs` has a structured `auditProject` plus `printAudit`; `auditProject` is reused by CLI, setup, doctor, provisioning, self-checks, and tests.
- `src/skills.mjs` has `applyOptionalSkills`, which prints a summary and dry-run output directly.
- `setupProject` and `provisionProject` already accept partial output/progress seams, but nested feature calls do not receive a complete adapter.
- `package.json.files` already excludes tests, fixtures, development scripts, plans, and workflows. CI already performs real pack/install smoke on Ubuntu Node 20/22/24; issue #100 forbids matrix changes.

### Proposed behavior

- `npm test` invokes only native `node:test` entries, each once, and explicit-path focused runs remain valid.
- Test modules register scenarios but do not execute scenarios or create fixtures at import time. Fixture creation, process-global mutations, and cleanup are lifecycle-scoped and restored in `finally`/hooks.
- `scripts/` contains the five migration tools plus the branch-local `select-evals.mjs` prompt-evaluation selector:
  - `check-coverage.mjs`
  - `check-diff-coverage.mjs`
  - `check-module-limits.mjs`
  - `test-coverage.mjs`
  - `measure-test-duration.mjs`
  - `select-evals.mjs`
- Feature modules return/perform domain operations without UI imports, Ink/React imports, TTY inspection, prompting, or direct output. CLI/setup owns prompt and renderer invocation and supplies adapters to nested calls.
- The adapter is an optional plain object. At minimum it supports `audit(audit)`, `doctor(report)`, `summary(title, rows, options)`, and `warn(message)`; any additional callback must be justified by an existing output path. No class, container, event bus, or new framework is introduced.
- No adapter means no presentation on success, warning, or failure. `silent: true` suppresses presentation even with an adapter. Missing MCP interaction cannot silently become completed input; structured `missingValues`/`warnings` and validation remain available.
- Doctor builds and delivers a report containing at least `target`, `setupPipeline`, `checks`, `infoRows`, and `verbose` before throwing on failed diagnostics when an adapter is supplied.
- CLI diagnostics may be asserted across stdout and stderr. Stream identity is asserted only where a documented contract requires it; semantic, status, safety, and no-write assertions remain.

### Non-goals

- No new CLI features, UI redesign, prompt-flow change, validation/status/schema/workspace/secret/permission/rollback change.
- No strict cross-platform raw-byte parity restoration.
- No dependency/version changes, CI matrix changes, upstream policy changes, or broad runtime reorganization.
- No extraction of all shared/ECC/gstack output.
- No DI framework, event bus, TypeScript migration, controller/service layer, or unrelated cleanup.
- No overwrite of `docs/plans/issue-97-source-refactor.md`.

## 2. Requirement and acceptance matrix

| ID | Source | Expected behavior | Proposed change | Verification / negative case | Status |
|---|---|---|---|---|---|
| R1 | Issue/Spec AC1 | No test/scenario/fixture remains under `scripts/`; five migration tools remain, plus the branch-local eval selector | Relocate all test assets and rename coverage tool; inventory every remaining script before deletion | Assert exact migration-tool list and verify `select-evals.mjs` is the only additional selector | Complete; final tree and package checks passed |
| R2 | Issue/Spec AC2 | Every scenario/failure path has an old-to-new mapping and replaced assertions are justified | Create a checked-in machine-readable inventory with one row per independently meaningful observable behavior and assertion retirement reason | Review inventory against all 30 self-check modules, existing native tests, characterization test, and distinct failure branches; helpers remain dependency rows | Inventory row/count rule is fixed in Resolved implementation decisions |
| R3 | Issue/Spec AC3 | Native runner executes every entry once and supports explicit paths | Convert self-check modules into named `node:test` entries; update `package.json` and tooling | `npm test`; each focused `node --test ... path` run; detect duplicate registration and legacy runner references | Complete; 74 native tests passed |
| R4 | Issue/Spec AC4 | Fixture/global lifecycle is safe after failures | Move builders/assets to `test/fixtures/`; wrap temp dirs, env, console, TTY, renderer, and Git state in hooks/`try/finally` | Inject assertion/process failure; verify cleanup and restoration; serialize process-global tests | Complete; lifecycle and rollback tests passed |
| R5 | Issue/Spec AC5 | Four feature modules contain no UI/React/Ink/TTY/prompt ownership | Move renderers to `src/ui/reports.mjs`, MCP interaction to `src/ui/mcp-interaction.mjs`; remove imports and checks | Structural test forbids imports/usages and prompt/TTY ownership in four files | Complete; structural and UI contract tests passed |
| R6 | Issue/Spec AC6 | No adapter means no feature-attributable output, including nested output | Pass optional adapter through CLI/setup/provision and make lower-level helpers silent when caller owns presentation | Capture console/stdout/stderr on success/warning/failure with no adapter; include nested provision paths | Complete; adapter-coverage tests passed |
| R7 | Issue/Spec AC7 | Normal CLI/setup execution supplies adapters without duplicates; `silent` works | Extend existing `setupProject`/`provisionProject` output seam; propagate to MCP, doctor, audit, skills | Assert callback payloads, no duplicate summaries/warnings, and silent suppression in interactive setup | Complete; final verification passed |
| R8 | Issue/Spec AC8 | Doctor failure reports then fails; MCP missing input structured and secret-safe | Report before doctor throw; retain `missingValues`/`warnings`; render incomplete configuration without a new exception | Doctor failure has adapter report and nonzero CLI status; missing MCP names only variable names, never leaks secret, and never claims full configuration | Resolved in design review and delegated research |
| R9 | Issue/Spec AC9 | Compatibility contract preserved | Treat existing operations as unchanged; modify only presentation ownership and test layout | CLI flow matrix for flags, prompts, cancellation/retry, generated tree, permissions, symlinks, backup/rollback/recovery | Complete; final verification passed |
| R10 | Issue/Spec AC10 | 11 baselines move byte-unchanged, become historical evidence | Move to `test/fixtures/cli-baseline/`; add provenance outside the baseline files; remove active byte gates | Hash/byte comparison before/after; archive inspection; no baseline rewrite | Provenance location fixed: migration inventory or `test/fixtures/cli-baseline/README.md` |
| R11 | Issue/Spec AC11 | Behavioral tests reject missing diagnostics, wrong status/version, dry-run writes, broken interactions, secrets | Replace raw comparisons with semantic assertions, retaining safety/no-write checks | Help/version/invalid/conflict/dry-run/doctor/MCP/interactive matrix | Complete; final verification passed |
| R12 | Issue/Spec AC12 | No dependency or static import cycle added | Use existing Node/Ink/React dependencies only; run cycle check | `mcp__gitnexus__check`; package diff confirms no dependency changes | Baseline cycle check clean |
| R13 | Issue/Spec AC13 | Coverage scope/threshold/validators/suppression unchanged | Rename references only; preserve `src/`/`bin/` unloaded-file coverage and 80% gates | `npm run test:coverage`; inspect checker scope and thresholds; no new ignore pragmas | Complete; final verification passed |
| R14 | Issue/Spec AC14 | Tooling uses new layout | Update coverage, diff coverage, module limits, duration, and quality-gate callers | Run each tooling command and focused tool tests | Complete; final verification passed |
| R15 | Issue/Spec AC15 | Packed package installs/runs outside checkout and excludes dev assets | Preserve `files` allowlist; run real pack/install smoke from temporary dirs | `npm pack`, external install, help/version/setup, archive forbidden-path check | Existing CI procedure verified; local external smoke not run in planning |
| R16 | Issue/Spec AC16 | Architecture/contributor docs describe current layout, adapter ownership, focused tests, baseline policy | Update `docs/architecture.md` and `CONTRIBUTING.md`; leave issue-97 plan unchanged | Documentation review against tree and commands; no stale active self-check/byte-parity claims | Complete; final verification passed |
| R17 | Issue/Spec AC17 | GitNexus impact precedes symbol edits; detect changes precedes separately authorized commit | Run fresh upstream impact for every modified function/class/method, warn on HIGH/CRITICAL; run `detect_changes()` before any later authorized commit | Record blast radius in implementation notes/PR; no commit is authorized by this plan | Process gate |
| R18 | Issue/Spec AC18 | Every new/modified test states observable, wrong result, and limits | Add exact `protects=...; fails_when=...; no_claim=...` comments immediately above each new/modified test or grouped assertion profile | Structural test scans all changed tests; multiline/parameterized cases use one profile per test group | Resolved from existing repository comment convention |

### Contradictions and material ambiguities

1. “No adapter emits no output” and “deliver doctor report before throwing” are compatible only when the adapter is supplied. Make that qualification explicit in code/tests.
2. Baselines must be byte-unchanged and documented; provenance must therefore live outside baseline files.
3. Exact callback-order assertion grouping remains an implementation detail, but the required stale/double-submit, zero-item, duplicate-item, cancellation/retry, and overlapping completion behaviors are fixed in the interaction registry.
4. `docs/architecture.md` and `CONTRIBUTING.md` currently contain stale claims about self-checks, byte parity, and a macOS CI matrix. Update current claims, but preserve historical plans and evidence statements where they are explicitly historical.

## 3. Architecture and end-to-end flow

### Current flow

```text
bin/repo-pattern.mjs
  -> src/cli.mjs
     -> auditProject / printAudit
     -> generateMcp (prompts, warning, summary)
     -> doctorProject (checks, TTY/Ink/plain rendering, throw)
     -> setupProject
        -> provisionProject
           -> generateMcp / applyOptionalSkills / auditProject / doctorProject
              -> direct console or prompt/UI helpers bypassing complete output seam
```

Native tests currently run as explicit files, then a sequential self-check orchestrator. Self-check modules import runtime functions and some dynamically import modules for side effects. Fixture helpers and baseline assets remain under `scripts/`.

### Target flow

```text
CLI or setup interaction boundary
  -> resolves prompts, TTY/color mode, and output adapter
  -> invokes feature operation with { output, progress, silent, ... }
     -> doctorProject: diagnostics/report data only; output.doctor(report); throw on failure
     -> auditProject: structured inspection only; output.audit(audit) at caller/UI boundary
     -> generateMcp: metadata/validation/generation; interaction adapter owned by src/ui;
                    returns missingValues/warnings; output.warn/summary when supplied
     -> applyOptionalSkills: selection/install/generation; output.summary when supplied
  -> provision propagates the same adapter to nested operations and suppresses lower-level duplicate output
```

`src/ui/reports.mjs` owns audit/doctor/MCP/skills report formatting and rendering. `src/ui/mcp-interaction.mjs` owns MCP prompt text, field collection, masking, validation UI, and cancellation/retry. Existing prompt/progress/wizard utilities are reused; no new framework is added. Filesystem writes, lock updates, generated schemas, rollback, and recovery stay in feature/setup modules.

### Existing components to reuse

- `src/ui/prompt.mjs`: prompt components, styling, `printBox`, `printSummary`, existing Ink test seams.
- `src/ui/progress.mjs`: durable and interactive progress adapters.
- `setupProject` and `provisionProject` output/progress injection seams.
- Structured `auditProject` result and doctor check/info row shapes.
- Existing fixture builders/assets, moved without changing generated fixture semantics.
- Existing `package.json.files` allowlist and CI installed-package smoke procedure.

### Impacted verified files/symbols

- **High-risk runtime symbols:** `src/doctor.mjs:doctorProject` (CRITICAL), `src/mcp.mjs:generateMcp` (CRITICAL), `src/audit.mjs:auditProject` (CRITICAL), plus exact exported skill operation to be resolved before editing.
- **Direct callers:** `src/cli.mjs:main`, `src/setup/setup.mjs:setupProject`, `src/setup/provision.mjs:provisionProject`, existing native tests, and legacy self-check modules during migration.
- **Presentation files:** `src/doctor.mjs`, `src/mcp.mjs`, `src/audit.mjs`, `src/skills.mjs`, `src/ui/prompt.mjs`, `src/ui/setup-interaction.mjs`, `src/ui/reports.mjs` (existing or to verify), `src/ui/mcp-interaction.mjs` (existing or to verify).
- **Test/tooling files:** all 30 `scripts/self-check/*.mjs`, `scripts/self-check.mjs`, `scripts/self-check.test.mjs`, `scripts/phase-1-characterization.test.mjs`, `scripts/phase-1-baseline/*`, current `test/**/*.test.mjs`, `package.json`, coverage/module/duration tools.
- **Docs:** `docs/architecture.md`, `CONTRIBUTING.md`; `docs/plans/issue-97-source-refactor.md` is historical and must not change.

### Compatibility and rollback

No user-data migration or release migration is needed. Keep mechanical moves separate from presentation extraction where practical. If regressions occur, revert the authorized changes together with callers, test paths, and tooling references; never reset unrelated work. Historical baselines remain available as reference but cannot be used to claim new raw-byte parity.

## 4. Design decisions and alternatives

| Decision | Selected approach | Evidence / tradeoff |
|---|---|---|
| Test runner | Native `node:test` entries, explicit grouped paths or native discovery, serial where globals require it | Required by Issue; current suite already uses Node native tests and `--test-concurrency=1`. Avoids a wrapper that hides scenarios. |
| Fixture ownership | `test/fixtures/` helpers/assets; lifecycle setup in tests/hooks | Required by Issue and needed because `gstack-documents.mjs` has import-time fixture risk. Slightly more test boilerplate prevents leakage. |
| Adapter shape | Optional plain callbacks extending existing `setupProject`/`provisionProject` output seam | Explicit Issue direction; avoids classes/DI/event bus and minimizes blast radius. |
| Rendering ownership | `src/ui/reports.mjs` and `src/ui/mcp-interaction.mjs`; CLI/setup invokes UI | Explicit destination; keeps domain operations free of TTY/Ink/prompt ownership. |
| MCP missing input | Preserve structured result and make absence observable as incomplete/error at the existing caller boundary; do not treat it as success | Exact shape is not specified. Choose the smallest behavior consistent with current `missingValues`/`warnings`, `--yes`, `silent`, and validation tests; record the chosen contract in inventory before implementation. |
| Baseline provenance | Separate Markdown/JSON inventory adjacent to migrated fixtures or docs; never modify baseline bytes | Required byte identity conflicts with embedded metadata. Use one stable checked-in source and document historical Linux/environment/path-normalization limits. |
| Coverage rename | Rename `check-ecc-coverage.mjs` to `check-coverage.mjs`, preserving algorithm, thresholds, source scope, and callers | Explicit Issue direction; current checker already covers whole `src/`/`bin/`, so rename terminology without algorithm rewrite. |
| Packaging | Retain `package.json.files` allowlist and existing CI smoke; add no package files for tests/fixtures/tools | Existing tarball boundary already excludes development assets. Validate actual pack/install rather than adding packaging code. |

### Premise/feasibility challenge

The requested boundary is feasible without reorganizing runtime: structured audit data already exists, setup/provision already have output seams, and UI primitives already exist. The risky premise is that all self-check scenarios can be mechanically moved. They cannot: 30 modules aggregate checks, some modules execute at import time, and process-global state is shared. The first implementation deliverable must therefore be a complete scenario/caller/output inventory, not a bulk move. Any scenario that cannot be mapped to a native lifecycle test blocks deletion of the legacy runner.

## 5. Ordered implementation tasks

### Phase 0 — inventory and baseline

1. Enumerate every current test entry, self-check module, exported check, assertion/failure path, fixture asset, dynamic import, subprocess path, `import.meta.url` calculation, and package/docs reference.
   - **Files:** all `scripts/self-check*`, `scripts/phase-1-*`, `test/**/*.test.mjs`, `package.json`, docs, CI.
   - **Exit:** old-to-new inventory has one row per scenario/failure path and identifies intentionally retired byte assertions.
   - **Accepts:** R1, R2, R3, R4, R10.
2. Capture baseline file hashes/bytes and write separate provenance describing controlled Linux role, historical path normalization, and lack of interactive/rollback parity evidence.
   - **Exit:** 11 files have recorded bytes and no planned in-file edits.
   - **Accepts:** R10, R11.
3. Resolve exact adapter/missing-input/test-profile contracts from current callers and tests; run impact for every runtime symbol planned for edit and report CRITICAL findings before proceeding.
   - **Exit:** caller matrix and risk register are attached to implementation notes; no HIGH/CRITICAL risk is unreported.
   - **Accepts:** R7, R8, R17, R18.

### Phase 1 — native test and fixture migration

4. Move fixture builders/assets to `test/fixtures/`, preserving modes, generated content, symlink checks, and package exclusion. Refactor import-time fixture creation into test lifecycle hooks.
   - **Exit:** no fixture is created merely by importing a test module; cleanup runs after injected failures.
   - **Accepts:** R1, R4, R9.
5. Convert self-check responsibilities into named native tests in `test/cli`, `test/setup`, `test/ecc`, `test/gstack`, `test/ui`, `test/shared`, and `test/tooling` as specified by the Issue. Split mixed modules by protected behavior, not by source file.
   - **Exit:** inventory maps every scenario to a test name/path with required profile metadata.
   - **Accepts:** R1–R4, R18.
6. Move `scripts/phase-1-characterization.test.mjs` to `test/setup/setup-characterization.test.mjs`; move all 11 baselines to `test/fixtures/cli-baseline/` byte-unchanged; update imports/path roots.
   - **Exit:** hashes match and explicit focused execution works.
   - **Accepts:** R1, R3, R10.
7. Replace `test/cli/cli-contract.test.mjs` raw-byte gates with behavioral assertions. Keep no-write, exit-status, semantic diagnostics, version metadata, conflict, and secret-safety checks. Remove normalization helpers only after caller search and record historical normalization in provenance.
   - **Exit:** tests fail for missing/wrong semantics but do not require incidental whitespace/ANSI/stream placement.
   - **Accepts:** R9–R11.
8. Update `package.json` and tooling to run only native tests once. Remove `scripts/self-check.mjs`, `scripts/self-check.test.mjs`, and obsolete self-check directory only after the inventory and all focused tests pass.
   - **Exit:** `npm test` has one native mechanism and no active legacy path reference.
   - **Accepts:** R1–R4, R14.

### Phase 2 — presentation extraction and adapter propagation

9. Extract deterministic report construction/rendering from doctor and audit into `src/ui/reports.mjs`; preserve doctor report shapes and throw-after-report behavior. Remove React/Ink/TTY imports and checks from feature modules.
   - **Exit:** feature modules are operation-only; report adapter receives required fields before doctor failure.
   - **Accepts:** R5–R9.
10. Move MCP prompt/collection from `src/mcp.mjs` into `src/ui/mcp-interaction.mjs`; preserve field order, environment/default precedence, relative-path validation, password masking, cancellation/retry, and secret filtering. Keep structured missing values/warnings in the feature contract.
    - **Exit:** feature module never asks questions; absent interaction cannot become successful completion.
    - **Accepts:** R5, R8, R9, R11.
11. Extract audit/doctor/MCP/skills summary and warning presentation into report callbacks. Make `applyOptionalSkills` use the supplied adapter and keep filesystem/cache/lock/rollback behavior unchanged.
    - **Exit:** no direct feature-attributable console output without adapter; `silent` suppresses all presentation.
    - **Accepts:** R5–R8.
12. Propagate one adapter through `src/cli.mjs`, `src/setup/setup.mjs`, `src/setup/provision.mjs`, and `src/ui/setup-interaction.mjs`; ensure nested operations do not duplicate output or corrupt Ink setup rendering.
    - **Exit:** normal CLI/setup paths show required reports once; interactive setup owns rendering and lower layers are silent.
    - **Accepts:** R6–R9.

### Phase 3 — tooling, docs, and packaging

13. Rename `scripts/check-ecc-coverage.mjs` to `scripts/check-coverage.mjs`; update `test-coverage`, diff coverage, quality-gate, package scripts, and docs without changing algorithm, thresholds, source scope, or suppression policy.
    - **Exit:** all coverage/module/duration commands resolve new paths.
    - **Accepts:** R13, R14.
14. Update `docs/architecture.md` and `CONTRIBUTING.md` for the final test layout, adapter ownership, focused commands, baseline policy, coverage scope, and packaging procedure. Leave issue-97 historical plan untouched.
    - **Exit:** no active documentation claims self-check runner, stale scripts layout, or obsolete raw-parity requirement.
    - **Accepts:** R2, R10, R13–R16.
15. Run real pack/install smoke outside checkout, inspect forbidden archive paths, and verify runtime assets resolve from installed package root. Do not change package allowlist unless verification demonstrates a real regression.
    - **Exit:** installed `help`, `version`, and `setup --setup-pipeline none --yes` succeed from another working directory.
    - **Accepts:** R15.

### Phase 4 — integrated verification

16. Run focused native tests while iterating, then full test/tooling/package commands. Record exact commands, exit codes, counts, failures, and skipped checks; do not claim remote CI or live upstream validation.
    - **Exit:** all required local gates pass or the plan/implementation reports the exact blocker.
    - **Accepts:** R3, R9, R11, R13–R15.
17. Run structural checks for forbidden imports/TTY/prompt ownership, static cycles, exact scripts inventory, stale path references, baseline bytes, and test profile metadata.
    - **Exit:** all structural acceptance checks pass.
    - **Accepts:** R1, R2, R5, R10, R12, R18.
18. Before any separately authorized commit, run `mcp__gitnexus__detect_changes({scope: "all"})` and verify only expected symbols/processes/files changed. This plan authorizes no commit.
    - **Exit:** detect-changes report is reviewed and any unexpected scope is resolved before commit authorization.
    - **Accepts:** R17.

## 6. Test matrix

| Layer | Tests and failure injection | Acceptance IDs |
|---|---|---|
| Migration inventory | Enumerate all 30 current self-check modules, current native entries, characterization test, baselines, imports, dynamic imports, subprocesses, and failure paths; compare inventory to final tree | R1–R4 |
| Native lifecycle | Import each migrated test without creating fixtures; create temp dirs in hooks/callbacks; inject assertion/operation failure; verify cleanup in `finally`; restore env, console, TTY, renderer, cwd, and process-global state | R3, R4, R9 |
| CLI behavior | Help, version metadata, invalid command/option, force+migrate conflict, dry-run no-write, target quoting, exit codes; inspect stdout+stderr semantically and separately where documented | R9, R11 |
| Doctor | Pass/fail checks, verbose and silent modes, adapter report fields, report-before-throw, no adapter output capture, no secret disclosure | R5–R9, R11 |
| MCP | Server discovery/deduplication, input order, env/default precedence, path rejection (`~`, absolute, drive path, `..`), password masking, cancellation/retry, `--yes`, missing values, tracked files, symlink state, secret filtering | R5, R8, R9, R11 |
| Audit/skills | Structured audit without rendering; adapter report/summary/warn payloads; skills dry-run, cache, plugin/local settings, symlink rejection, silent mode, no duplicate output | R5–R9 |
| Setup/provision | Noninteractive and interactive adapter ownership; nested MCP/doctor/audit/skills calls; no Ink corruption/direct console leakage; rollback and cleanup failure warnings; generated files, locks, permissions, backups | R6–R9 |
| UI | `ink-testing-library` report rendering, prompt order, keyboard selection, cancellation, retry/edit, progress milestones, ANSI/NO_COLOR/TERM=dumb/CI modes | R5, R8, R9, R11 |
| Architecture | Static forbidden-import/TTY/prompt scan; no feature import of `src/ui/`, React, or Ink; no direct console output in feature paths; no static import cycles | R5, R12 |
| Tooling | Coverage lane, changed-line coverage against default branch, module limits, duration measurement, focused tool tests; verify 80% thresholds and unloaded runtime scope | R13, R14 |
| Packaging | Real `npm pack`; install under temporary prefix outside checkout; run help/version/setup from another cwd; inspect required runtime assets and reject tests/fixtures/scripts/plans/workflows in archive | R15 |
| Cross-platform assumptions | Preserve existing Linux controlled-baseline limits; do not claim macOS parity locally; verify Node 20/22/24-compatible syntax through CI configuration without changing matrix | R9, R15 |

Verified existing commands to run during implementation (not run as part of this plan except where explicitly reported as baseline evidence):

```bash
node --test --test-concurrency=1 test/cli/cli-contract.test.mjs
node --test --test-concurrency=1 test/setup/setup-contract.test.mjs
node --test --test-concurrency=1 test/ecc/ecc-contract.test.mjs
node --test --test-concurrency=1 test/gstack/gstack-contract.test.mjs
node --test --test-concurrency=1 test/ui/ui-contract.test.mjs
node --test --test-concurrency=1 test/shared/shared-contract.test.mjs
node --test --test-concurrency=1 test/setup/mcp-attribution-contract.test.mjs
npm test
npm run test:coverage -- "origin/${GITHUB_BASE_REF:-main}"
npm run check:module-limits
npm run measure:test-duration
```

The local pack/install procedure is documented in `CONTRIBUTING.md:33-48`; CI uses the same real-tarball shape in `.github/workflows/ci.yml:54-76`.

## 7. Failure-mode and risk register

| Risk | Severity | Detection | Mitigation | Recovery |
|---|---|---|---|---|
| Scenario silently dropped during self-check deletion | Critical | Inventory-to-test mapping and final path scan; native test count/assertion review | Migrate by protected behavior, not file; do not delete runner until all rows pass | Restore only authorized moved files/references together |
| Import-time fixture or global side effect | High | Import-only test, injected failure, cleanup assertions | Move creation into hooks/callbacks; serialise global-mutating tests; `try/finally` | Isolate offending test and retain legacy check until fixed |
| Doctor/MCP/audit shared callers break | Critical | Fresh GitNexus impact, focused caller tests, CLI/setup/provision matrix | Update direct callers atomically; report CRITICAL risk before edits | Revert extraction plus caller changes as one unit |
| Output duplicated or lost in nested provision | High | Adapter call-count assertions; stdout/stderr capture; interactive Ink snapshot | Propagate one adapter, use `silent` for lower layers, retain progress ownership | Disable affected adapter path only with explicit failure report; do not treat failure as success |
| Doctor failure no longer explains failure | High | Failed doctor test checks adapter report before nonzero result | Build report before throw; keep failure status | Restore throw ordering and adapter delivery |
| Missing MCP input treated as complete | Critical | No-adapter/`--yes`/noninteractive missing-input tests; inspect generated placeholders and result | Preserve structured `missingValues`/`warnings`; define explicit incomplete/error contract | Block success and preserve safe incomplete result |
| Secret leaked through warning/summary/fixture | Critical | Sentinel secret tests across callbacks, streams, files, and errors | Reuse secret filtering; never include values in payload formatting; no credentials in fixtures | Revoke/rotate only if a real credential was used; remove leak before proceeding |
| Generated workspace/rollback/symlink behavior changes | Critical | Existing setup/provision/ECC/gstack tests, symlink/non-regular entries, failure injection | Keep domain writes/transactions untouched; presentation only at boundary | Revert feature extraction, retain test migration separately |
| Baseline bytes changed or old gate remains active | Medium | Hash/byte comparison and source scan for baseline comparisons | Move unchanged; document provenance separately; replace assertions semantically | Restore baseline bytes and revise tests |
| Coverage scope or thresholds weakened during rename | High | Checker source review and coverage command | Rename references only; preserve 80% line/function/branch and unloaded files | Restore checker logic and update path references |
| Package includes development assets or misses runtime assets | High | Archive listing and external install from another cwd | Preserve explicit `files` allowlist; real pack/install smoke | Correct allowlist, rerun package smoke |
| Static cycle introduced | Medium | `mcp__gitnexus__check` | Keep UI dependencies one-way and avoid feature/UI cycles | Remove cycle before commit |
| Documentation claims stale architecture | Medium | Docs review against final tree and CI | Update current docs; preserve historical issue-97 plan | Correct docs without changing historical record |

## 8. Resolved decisions and implementation-time verification

- **Scenario inventory:** one row per independently meaningful observable behavior with its own assertion group and lifecycle; aggregate/helper modules are dependency rows, and distinct failure paths get separate rows when they protect different contracts. The machine-readable inventory is the completeness authority and must cover all 30 self-check modules before runner deletion.
- **MCP missing input:** preserve `missingValues`/`warnings`, add no exception type, render incomplete configuration with variable names only, and preserve existing exit/status behavior unless an existing caller already classifies it as failure.
- **Partial adapter:** callbacks are independent channels; missing callbacks suppress only those channels, supplied callbacks still run, and feature modules never fall back to direct console output.
- **Test profile:** use exact source comments immediately above each new/modified test or grouped assertion profile: `protects=...; fails_when=...; no_claim=...`.
- **Baseline provenance:** place hashes, controlled-Linux role, path-normalization history, and historical-only status in the migration inventory or `test/fixtures/cli-baseline/README.md`, outside the 11 byte-unchanged files.
- **Residual `scripts/`:** retain exactly the five named tools; migrate characterization and baseline assets under `test/`; remove the legacy runner, wrapper, and self-check tree only after inventory coverage is proven.
- **Interaction verification:** exact test grouping remains implementation-time, but registry rows must cover stale/double submission, zero-item selection, duplicate-item handling, cancellation/retry, and both completion orders for overlapping progress/report callbacks.
- **Packaging procedure:** use the existing documented temporary-directory procedure and CI smoke shape; no network/upstream claim follows from fixture-backed local tests.
- **GitNexus process gate:** run impact on exact symbols before edits, including the unresolved skills export; warn on all HIGH/CRITICAL results. Run `detect_changes()` before any separately authorized commit; this draft does not authorize one.

## 9. Review applicability

**UI scope is established by the Issue/Spec**, but it is presentation extraction and interaction ownership, not a UI redesign. The requested change explicitly names report renderers, MCP prompts, keyboard interaction, cancellation/retry, Ink/React removal from feature modules, and adapter ownership. Therefore a Design review was applicable and has been completed. Its approved terminal-UX decisions and remaining implementation-time verification detail are recorded in the appended review sections.

`no_ui_scope` is **not** appropriate for this Issue.

## 10. Implementation-ready checklist

- [ ] Confirm the repository remains clean immediately before implementation.
- [ ] Complete the scenario/caller/output inventory; do not reuse stale historical assertion counts as current.
- [ ] Record baseline bytes and provenance outside baseline files.
- [ ] Run and record GitNexus upstream impact for every runtime symbol planned for edit; report CRITICAL risks before edits.
- [ ] Migrate fixtures and scenarios with lifecycle-safe cleanup before deleting legacy runner.
- [ ] Preserve exact fixture modes, symlink/non-regular-file protections, generated files, locks, permissions, rollback, and secret handling.
- [ ] Keep test profile metadata on every new/modified test.
- [ ] Extract reports and MCP interaction without adding dependencies or changing business behavior.
- [ ] Propagate adapters through CLI/setup/provision, including nested calls, with no duplicate output and correct `silent` handling.
- [ ] Replace only obsolete presentation assertions; retain semantic, status, safety, no-write, interaction, and secret assertions.
- [ ] Rename coverage tool without weakening scope, thresholds, validators, or suppression policy.
- [ ] Update current docs while leaving `docs/plans/issue-97-source-refactor.md` historical.
- [ ] Run focused tests, `npm test`, coverage, module limits, duration, real pack/install smoke, structural scans, and cycle check; record actual results only.
- [ ] Run `detect_changes()` before any separately authorized commit.

## Final draft assessment

- **Exact implementation plan path:** `/home/kirin/Code/my-hobby/repo-pattern/docs/plans/issue-100-test-migration-presentation.md`
- **Requirements coverage:** all 18 acceptance criteria have stable matrix rows, implementation tasks, and verification coverage; explicit compatibility and out-of-scope requirements are recorded.
- **Known uncertainties:** exact test grouping and callback-order assertion arrangement remain implementation-time verification details. Required behavior, inventory fields, output ownership, MCP incomplete-state contract, metadata syntax, baseline provenance boundary, and residual-script classification are resolved above from repository/spec evidence.
- **Review readiness:** CEO and Design reviews have terminal evidence in the gstack review records and are consolidated below; delegated research is incorporated. Scenario inventory, test-profile metadata, baseline provenance, and residual-script classification are resolved from repository/spec evidence. One interaction-registry detail remains an implementation-time verification item.

## CEO Review Addendum

### Review decisions and dispositions

| ID | Decision | Disposition | Reference |
|---|---|---|---|
| D1 | Skip `/office-hours`; review now | Accepted | User answer from Step 0 |
| D2 | Hold scope | Accepted | User answer from Step 0 |
| F1 | Preserve domain errors when report callbacks fail | Required implementation constraint | Sections 1–2; no scope expansion |
| F2 | Keep feature-attributable output silent without a supplied callback, while preserving CLI-owned argument/operational diagnostics | Required implementation constraint | Section 5; R6–R7 |
| F3 | Make migration inventory the coverage authority; do not infer completeness from file/test counts | Required implementation constraint | Sections 1 and 6; R2–R4 |
| F4 | Preserve serial execution for process-global tests and measure post-migration duration | Required verification | Section 7; R13–R14 |
| F5 | Preserve terminal text/status accessibility and non-TTY behavior; no mobile surface applies | Required compatibility constraint | Section 11; R8–R11 |

### Review findings

- **APPROVED DESIGN DECISION — Information hierarchy:** All user-visible Doctor, MCP, optional-skills, and setup/provision output follows one scan order: `operation title -> current status/progress -> primary result or first blocking problem -> recovery action or next input -> secondary warnings and detail`. Non-TTY output uses the same order without Ink. Focused tests may assert the order and required labels, but not incidental whitespace or ANSI bytes.
- **APPROVED DESIGN DECISION — Visible state contract:** Empty and partial states are explicit user-facing outcomes, not bare internal values: Doctor with no checks shows `N/A` group status plus diagnostic context and no repair claim; MCP with no selected servers reports that no MCP configuration was requested and ends without claiming generated servers; missing required MCP values reports an incomplete configuration, names only variable names, and tells the user to export values or edit `.mcp.json`; no optional skills reports that none were selected; plugin-only/local-only results identify the applied channel and any pending manual action; cancelled or partially completed setup identifies the completed stage, the interrupted stage, and the safe next action. These states retain existing exit/status contracts and never turn incomplete work into success.
- **APPROVED DESIGN DECISION — User journey storyboard:** The unchanged terminal journey is `identify operation and target -> show active progress without claiming completion -> show success and changed-surface summary -> distinguish incomplete/partial work from failure -> on failure or cancellation show completed stage, interrupted stage, and safe next action -> allow a safe rerun under existing rollback/recovery rules`. Tests should protect the sequence and status meaning, not incidental formatting.
- **APPROVED DESIGN DECISION — Terminal copy rules:** Operate surfaces use visible labels and text status symbols (`✓`, `✗`, `!`, `i`) so meaning does not depend on color; keep recovery lines short and action-oriented; avoid decorative separators and generic mood copy; emit one authoritative summary per operation; keep warnings and information subordinate to the primary result; preserve existing `printBox`/Ink structure only when it serves those jobs. These rules apply equally to Ink and plain non-TTY output.
- **APPROVED DESIGN DECISION — Existing terminal vocabulary:** The current prompt/Ink vocabulary is the compatibility reference, not a new design system: cyan/bold for titles, green plus `✓` for success, red plus `✗` for failure, yellow plus `!` for warnings, and dim text plus `i` for supporting information where already used. Plain/non-TTY output keeps the symbols and labels without color or Ink. No new font, color, border, spacing, or visual token system is introduced.
- **APPROVED DESIGN DECISION — Terminal accessibility:** Every prompt keeps a visible label; placeholders are never the only label. Existing keyboard navigation, selection, cancellation, retry, and prompt order remain unchanged. Selection and status remain understandable through text/symbols without color. Long target paths, server names, and validation messages wrap without hiding the action. `CI`, `NO_COLOR`, `TERM=dumb`, and non-TTY output stay linear, readable, and complete. No mobile/tablet layout is required because the product surface is terminal-only.
- **APPROVED DESIGN DECISION — MCP incomplete state:** Keep the existing structured `missingValues` plus `warnings` result and do not introduce a new exception type. CLI/setup callers render an explicit incomplete-configuration warning, name only missing variable names, and must not describe the operation as fully configured. Existing exit/status behavior remains unchanged unless an existing caller contract already classifies the result as failure.
- **APPROVED DESIGN DECISION — Partial output adapters:** Callbacks are independent channels. A missing callback suppresses only that channel; supplied callbacks still run; feature modules never fall back to direct console output. This preserves optional callbacks, prevents duplicate nested output, and keeps the no-adapter boundary intact.
- **APPROVED DESIGN DECISION — Callback failures:** If a domain operation has already failed, preserve that domain error as primary and surface report-callback failure as contextual cause/detail; never swallow either failure. If the domain operation succeeded but a required supplied callback fails, propagate the callback failure as an operational error rather than silently losing presentation. Tests must cover both precedence cases.
- **WARNING — Section 1:** `src/ui/reports.mjs` must remain presentation-only. It must not become a second source of truth for diagnostics, MCP completeness, or mutation decisions.
- **WARNING — Section 2:** If a report callback fails while the domain operation has already failed, the implementation must preserve the domain failure as primary and attach presentation context; no catch-all may turn the failure into success or hide either error.
- **WARNING — Section 4:** The final interaction registry must name double-submit/stale callback behavior, zero-item MCP selection, duplicate-item handling, and both completion orders for overlapping progress/report callbacks.
- **WARNING — Section 5:** `applyOptionalSkills` contains direct dry-run output in lower-level helpers. The implementation must establish one explicit ownership rule and test it; mixed silent/direct output is not acceptable.
- **WARNING — Section 6:** Scenario and assertion inventory, not module count or native test count, is the migration completeness authority. The inventory must map aggregate self-check modules and import-time side effects before legacy deletion.
- **OK — Sections 3, 7, 8, 9, 10:** No new endpoint, dependency, database migration, service rollout, or production observability system is introduced. Existing filesystem, secret, packaging, rollback, and documentation safeguards remain required.
- **OK — Section 11:** UI scope is real but limited to existing terminal reports and prompts. Preserve text labels, non-color status markers, keyboard behavior, cancellation, retry, and non-TTY rendering. Consider `/plan-design-review` before implementation.

### REALITY rows

- `REALITY: Issue #100 and the archived Spec both require native test migration, presentation extraction, behavioral contracts, safety preservation, tooling/docs updates, and real package verification.`
- `REALITY: The repository currently has a hybrid native/self-check test runner, import-time fixture risks, direct presentation in four feature modules, and existing setup/provision output seams.`
- `REALITY: GitNexus classified doctorProject, generateMcp, and auditProject as CRITICAL upstream-impact symbols; exact skills operation impact remains an implementation prerequisite.`
- `REALITY: No implementation, commit, merge, deployment, or remote-CI claim is authorized by this review.`
- `PLAN_REALITY: verified=4; unverified=0; pending_implementation=18 acceptance rows; source=Issue/Spec/repository review.`

### NOT in scope

- Separate interactive raw-byte parity harness — rejected by the accepted behavioral-contract requirement; existing interaction and semantic tests remain required.
- CI workflow/matrix unification or expansion — rejected by the explicit no-CI-matrix-change constraint; existing CI and package smoke remain the verification path.
- Runtime redesign, new dependencies, DI/container/event-bus architecture, mobile/responsive UI, new telemetry, dashboards, or unrelated cleanup — rejected by HOLD SCOPE.

### What already exists

- Native `node:test` contract files and serial execution are already present; the migration extends this mechanism rather than adding a runner.
- `setupProject`/`provisionProject` already expose partial output/progress seams; the plan propagates one narrow callback shape through nested operations.
- `auditProject` already returns structured state; doctor already computes checks before throwing; prompt/progress helpers already provide Ink and durable-output seams.
- `package.json.files` and CI already provide a package allowlist and real install smoke shape; the plan verifies them without broadening the package.

### Dream state delta

After implementation, a new engineer can locate all tests and fixtures under `test/`, run one native test mechanism or a focused path, identify one caller-owned presentation boundary, and distinguish historical CLI evidence from active behavioral gates. The remaining gap is implementation proof: inventory completeness, lifecycle safety, adapter propagation, and package verification must still be demonstrated by the implementation run.

### Error & Rescue Registry

| Capability | Failure class | Rescued? | Action | User/test visibility |
|---|---|---:|---|---|
| Test lifecycle | assertion/operation failure | Yes | restore globals and temporary paths in hooks/finally; rethrow original failure | named test failure and cleanup assertion |
| Doctor report | report callback/render failure | Required | preserve diagnostic failure as primary; add presentation context; do not swallow | failed doctor status plus visible report/error |
| MCP interaction | cancellation/validation/missing required input | Yes | preserve cancellation/validation; return structured incomplete state or caller-compatible error | no false success; no secret disclosure |
| MCP/write state | tracked file, symlink, write, or lock failure | Yes | fail operation and progress; no completion summary | operational error and no partial-success claim |
| Optional skill sync | clone/fetch/checkout/copy/rollback failure | Yes | fail operation, preserve cleanup/rollback semantics | contextual error and failed progress |
| Adapter propagation | absent/duplicate/partial callback | Yes | suppress absent channels, propagate one caller-owned adapter, test call counts | no duplicate or hidden feature output |
| Packaging/tooling | stale path or forbidden archive entry | Yes | fail structural/package smoke check with offending path | command failure identifies path |

### Failure Modes Registry

| CODEPATH | FAILURE MODE | RESCUED? | TEST? | USER SEES? | LOGGED? |
|---|---|---:|---:|---:|---:|
| Native lifecycle | leaked temp/global state after failed test | Y | Y | Y | Y |
| Doctor | report lost before failure is raised | Y | Y | Y | Y |
| MCP | missing required value treated as success | Y | Y | Y | Y |
| MCP/secrets | secret appears in warning, callback, or fixture | Y | Y | Y | Y |
| Provision | nested summaries duplicated or omitted | Y | Y | Y | Y |
| Skills | dry-run output bypasses ownership rule | Y | Y | Y | Y |
| Migration | scenario silently dropped before runner deletion | Y | Y | Y | Y |
| Coverage | renamed checker weakens scope/threshold | Y | Y | Y | Y |
| Packaging | dev assets included or runtime assets missing | Y | Y | Y | Y |
| Cycles | new static import cycle | Y | Y | Y | Y |

### Implementation Tasks

Synthesized from this review's findings. Existing Issue tasks remain authoritative; these tasks close review-specific gaps.

- [ ] **CEO-T1 (P1)** — Phase 0 inventory — Produce machine-readable assertion, lifecycle, asset, and path inventory before deleting the legacy runner.
  - Surfaced by: Sections 1, 2, and 6 — module/test counts do not prove scenario coverage.
  - Files: `scripts/self-check.mjs`, `scripts/self-check/`, `scripts/`, `package.json`, `test/`
  - Verify: inventory maps every scenario/failure path and focused native tests cover every row before legacy deletion.
- [ ] **CEO-T2 (P1)** — Coverage — Validate whole-runtime line/function/branch coverage after the checker rename without changing thresholds or unloaded-file accounting.
  - Surfaced by: Section 6 — coverage remains a required gate during test-layout migration.
  - Files: `scripts/check-coverage.mjs`, `scripts/test-coverage.mjs`, `scripts/check-diff-coverage.mjs`, `package.json`
  - Verify: `npm run test:coverage` and changed-line coverage pass with unchanged 80% gates and source scope.

  Review-time effort estimates are intentionally omitted; implementation sizing must use the verified inventory and actual migration state.

### Approval readiness

**Approval readiness: CONDITIONAL** — CEO and Design review terminal records are present and consolidated. The plan preserves HOLD SCOPE, has no critical review gaps, and does not authorize implementation. The remaining interaction-registry verification must be implemented and tested before the affected behavior is considered complete.

### Completion Summary

```text
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | HOLD SCOPE                                  |
  | System Audit         | Hybrid tests, direct UI ownership, critical |
  |                      | symbol blast radius; migration is feasible  |
  | Step 0               | D1 skip office-hours; D2 hold scope        |
  | Section 1  (Arch)    | 1 issue found                               |
  | Section 2  (Errors)  | 7 capability paths mapped, 1 warning       |
  | Section 3 (Security) | 0 issues found, 0 High new threats         |
  | Section 4 (Data/UX)  | 4 edge-case warnings, 0 accepted gaps     |
  | Section 5 (Quality)  | 2 issues found                             |
  | Section 6 (Tests)    | Diagram produced, 1 task gap               |
  | Section 7 (Perf)     | 0 issues found                             |
  | Section 8 (Observ)   | 0 issues found                             |
  | Section 9 (Deploy)   | 2 risks flagged                             |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 3         |
  | Section 11 (Design)  | 1 compatibility warning                    |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (3 groups)                          |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 7 rows, 0 CRITICAL GAPS                    |
  | Failure modes        | 10 total, 0 CRITICAL GAPS                  |
  | TODOS.md updates     | 0 items proposed                           |
  | Scope proposals      | 0 proposed, 0 accepted                     |
  | CEO plan             | written                                    |
  | Outside voice        | unavailable; configuration probe returned no value |
  | Lake Score           | N/A                                         |
  | Diagrams produced    | 7 (architecture, flows, state/interaction, error, deployment, rollback) |
  | Stale diagrams found | 0                                         |
  | Unresolved decisions | 1 implementation-time verification detail  |
  | Reality rows         | 5/5 rows (PLAN_REALITY), 0 unverified      |
  +====================================================================+
```

## Design Review Implementation Tasks

- [ ] **DESIGN-T1 (P1)** — Terminal presentation — Apply the shared information hierarchy and terminal copy contract across Doctor, MCP, optional-skills, and setup/provision output.
  - Surfaced by: Passes 1 and 4 — output ordering and concrete OPERATE copy rules were not explicit.
  - Files: `src/ui/reports.mjs`, `src/ui/prompt.mjs`, `src/ui/mcp-interaction.mjs`, `src/cli.mjs`, `src/setup/provision.mjs`
  - Verify: focused output tests assert title/status/result/recovery ordering, visible status labels/symbols, and no duplicate summaries in Ink and non-TTY modes.
- [ ] **DESIGN-T2 (P1)** — Terminal states — Specify and test empty, partial, cancelled, and failed state presentation.
  - Surfaced by: Passes 2 and 3 — user-visible state meaning and recovery journey were under-specified.
  - Files: `src/ui/reports.mjs`, `src/ui/mcp-interaction.mjs`, `test/ui/`, `test/setup/`, `test/cli/`
  - Verify: tests cover no checks, no MCP servers, missing MCP values, no skills, plugin/local-only results, cancellation, rollback, and safe rerun context.
- [ ] **DESIGN-T3 (P1)** — Terminal accessibility — Verify labels, symbols, wrapping, keyboard behavior, and non-TTY completeness.
  - Surfaced by: Pass 6 — terminal accessibility and portable output rules were broad.
  - Files: `src/ui/prompt.mjs`, `src/ui/reports.mjs`, `test/ui/`, `test/setup/`, `test/cli/`
  - Verify: focused tests cover visible labels, unchanged key/cancellation behavior, long paths/server names, `CI`, `NO_COLOR`, `TERM=dumb`, and non-TTY output.

  Review-time effort estimates are intentionally omitted; implementation sizing must use the verified inventory and actual migration state.

## Design Review Completion Summary

```text
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | No DESIGN.md; terminal OPERATE UI scope      |
  | Step 0               | 6/10; focus: all seven dimensions           |
  | Pass 1  (Info Arch)  | 7/10 → 9/10 after fix                       |
  | Pass 2  (States)     | 7/10 → 9/10 after fix                       |
  | Pass 3  (Journey)    | 7/10 → 9/10 after fix                       |
  | Pass 4  (AI Slop)    | 8/10 → 9/10 after fix                       |
  | Pass 5  (Design Sys) | 6/10 → 9/10 after fix                       |
  | Pass 6  (Responsive) | 7/10 → 9/10 after fix                       |
  | Pass 7  (Decisions)  | 8 resolved, 1 verification detail         |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (no redesign/mobile/new tokens)    |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                           |
  | Approved Mockups     | 0 generated, 0 approved                    |
  | Decisions made       | 8 added/resolved in plan                   |
  | Decisions deferred   | 1 implementation-time verification detail  |
  | Overall design score | 6/10 → 9/10                                |
  +====================================================================+
```

### Design Review Findings and Decisions

- **Pass 1 — Information architecture:** Added shared scan order for operation title, status/progress, primary result/problem, recovery/next input, and secondary detail.
- **Pass 2 — Interaction states:** Added explicit visible empty/partial semantics for Doctor, MCP, optional skills, and setup/provision.
- **Pass 3 — User journey:** Added success, progress, incomplete, cancellation/failure, and safe-rerun storyboard.
- **Pass 4 — AI slop:** Classified the surface as OPERATE; added concrete terminal copy rules and recorded no hard rejection.
- **Pass 5 — Design system:** Recorded existing prompt/Ink color-symbol vocabulary as compatibility reference; introduced no new tokens.
- **Pass 6 — Accessibility:** Added visible-label, keyboard/cancellation, symbol, wrapping, and non-TTY/CI requirements.
- **Pass 7 — MCP incomplete state:** Preserve structured `missingValues`/`warnings`; render incomplete configuration without a new exception.
- **Pass 7 — Partial adapters:** Suppress only missing channels; supplied callbacks run; no console fallback.
- **Pass 7 — Callback failures:** Preserve an existing domain error as primary and surface callback context; propagate callback failure after successful work.

### NOT in scope

- UI redesign, new terminal navigation, changed prompt order, new animation, mobile/tablet layout, new color/font/spacing token system, or decorative output.
- Visual mockups: designer was installed but generation failed because no OpenAI or Gemini image API key was configured; no mockup was approved.
- Outside design voices: user selected no; no Codex or Claude subagent design critique was run.

### What already exists

- `src/ui/prompt.mjs` provides current prompt labels, Ink components, `printBox`, `printSummary`, styling, and test seams.
- `src/ui/progress.mjs` provides interactive/durable progress selection.
- `src/ui/setup-interaction.mjs` and setup/provision callers already own wizard interaction and partial output seams.
- Existing tests cover prompt order, keyboard selection, cancellation, retry/edit, progress, doctor output, silent mode, and CLI diagnostics.

### Resolved implementation decisions

- **Scenario definition/count:** one inventory row represents one independently meaningful observable behavior with its own assertion group and lifecycle. Count inventory rows, not files, assertions, or `node:test` registrations. Aggregate/helper modules are dependency rows; distinct failure paths are separate rows when they protect different observable contracts. Do not delete the legacy runner until every invoked module and distinct failure branch has a row and a destination test.
- **Scenario inventory representation:** use a checked-in machine-readable inventory with source module/line range, scenario ID, protected observable, success/failure class, fixture/global-state requirements, old assertion/failure path, destination test path/name, `protects`, `fails_when`, `no_claim`, and baseline-retirement rationale where applicable.
- **Test-profile metadata:** place exact `protects=...; fails_when=...; no_claim=...` source comments immediately above every new or modified test or grouped assertion profile, matching the existing repository convention. Do not infer profiles from filenames.
- **Baseline provenance:** store hashes, controlled-Linux role, path-normalization history, and the fact that raw parity is no longer active in the migration inventory or `test/fixtures/cli-baseline/README.md`, outside the 11 byte-unchanged files.
- **Residual `scripts/` classification:** retain exactly the five named development tools. Rename `check-ecc-coverage.mjs`; migrate `phase-1-characterization.test.mjs` and `phase-1-baseline/` under `test/`; remove `self-check.mjs`, `self-check.test.mjs`, and `self-check/` only after inventory coverage is proven. No test or fixture remains under `scripts/`.
- **Interaction registry:** keep stale/double-submit, zero-item selection, duplicate-item handling, cancellation/retry, and both completion orders for overlapping progress/report callbacks as explicit implementation-time registry rows and tests. The exact test grouping remains an implementation detail, not a scope uncertainty.

The MCP missing-input shape, partial-adapter behavior, and callback-failure precedence were resolved in this design review and are no longer unresolved: preserve structured `missingValues`/`warnings` without a new exception; suppress only missing callback channels without console fallback; preserve a pre-existing domain error as primary while surfacing callback failure context, and propagate callback failure after successful work.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | ISSUES OPEN | mode: HOLD_SCOPE, 0 critical gaps |
| Outside Review | codex plan review | Independent 2nd opinion | 1 | unavailable | no completed external review; configuration probe returned no value |
| Eng Review | `/autoplan` | Architecture & tests (required) | 0 | not run | not run |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | ISSUES OPEN | score: 6/10 → 9/10, approved terminal contracts; delegated research incorporated |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | not run |

- **OUTSIDE COVERAGE:** design outside voices skipped by user choice; no Codex or Claude subagent design critique completed.
- **VERDICT:** Design review ISSUES OPEN — delegated research resolved the implementation/inventory decisions; one interaction-registry detail remains an implementation-time verification item. No implementation is authorized by this plan.
**UNRESOLVED IMPLEMENTATION VERIFICATION:**
- Exact test grouping and callback-order assertion arrangement for stale/double submission and overlapping progress/report callbacks; required behaviors and registry rows are fixed above.

<!-- KFLOW_REVIEW_COMPLETION_BEGIN -->

```json
{
  "issueUrl": "https://github.com/NegiKirin/repo-pattern/issues/100",
  "specArchivePath": "/home/kirin/Code/my-hobby/repo-pattern/.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/specs/20261113-235025-issue-100-test-migration-presentation.md",
  "reviews": {
    "ceo": {
      "status": "completed",
      "outcome": "HOLD SCOPE; 0 critical gaps; open implementation-verification findings",
      "evidence": "gstack-review-read record for plan-ceo-review at 2026-11-15T00:00:00Z; saved plan CEO Review Addendum and Completion Summary"
    },
    "design": {
      "status": "completed",
      "outcome": "HOLD SCOPE; score 6/10 to 9/10; approved terminal contracts; open implementation-verification finding",
      "evidence": "gstack-review-read record for plan-design-review with score_initial 6, score_final 9, unresolved 5; saved plan Design Review Completion Summary and Findings and Decisions"
    }
  },
  "findings": [
    {
      "id": "CEO-F1-F5",
      "severity": "informational",
      "disposition": "resolved",
      "task": "Preserve domain-error precedence, no-adapter silence, inventory authority, serial global-mutating tests, and terminal accessibility/non-TTY behavior.",
      "evidence": "Saved plan CEO Review Addendum, Review decisions and dispositions, F1-F5."
    },
    {
      "id": "DESIGN-TERMINAL-CONTRACTS",
      "severity": "informational",
      "disposition": "resolved",
      "task": "Apply the approved output hierarchy, explicit empty/partial/cancelled states, existing status vocabulary, MCP incomplete-state contract, partial-adapter suppression, and callback-failure precedence.",
      "evidence": "Saved plan Design Review Findings and Decisions; gstack-review-read plan-design-review record."
    },
    {
      "id": "DELEGATED-INVENTORY-DECISIONS",
      "severity": "informational",
      "disposition": "resolved",
      "task": "Use the machine-readable scenario inventory, source-comment test profiles, external baseline provenance, and exact five-file scripts classification recorded in Sections 2, 5, and 8.",
      "evidence": "Two completed delegated research reports; incorporated in the saved plan Resolved implementation decisions and acceptance matrix."
    },
    {
      "id": "INTERACTION-REGISTRY-ORDERING",
      "severity": "medium",
      "disposition": "implementation_verification",
      "task": "Add registry rows and tests for stale/double submission, zero-item selection, duplicate-item handling, cancellation/retry, and both completion orders for overlapping progress/report callbacks; keep exact test grouping as an implementation detail.",
      "evidence": "Saved plan Design Review warning, Resolved implementation decisions, and final unresolved implementation-verification line."
    }
  ],
  "unresolvedMaterialDecisions": [],
  "implementationConditions": [
    "Before declaring the affected implementation complete, verify the interaction registry and callback-order tests listed under INTERACTION-REGISTRY-ORDERING.",
    "Before editing any runtime symbol, run GitNexus upstream impact and report HIGH/CRITICAL risk; before any separately authorized commit, run detect_changes()."
  ],
  "scopeChangedAfterReview": false
}
```

<!-- KFLOW_REVIEW_COMPLETION_END -->
