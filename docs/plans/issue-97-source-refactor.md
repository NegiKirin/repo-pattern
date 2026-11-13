# Issue #97 Implementation Plan: Source Refactor

## Status and evidence

- **Plan type:** draft only; no implementation, review skill, commit, branch, worktree, release, or package publication is included.
- **Issue:** [#97](https://github.com/NegiKirin/repo-pattern/issues/97), “refactor: reorganize CLI source, isolate presentation, and migrate tests without behavior changes”. The issue page and the canonical archived specification agree on a behavior-preserving feature-based source refactor.
- **Canonical specification:** `/home/kirin/Code/my-hobby/repo-pattern/.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/specs/20261111-issue-97-source-refactor.md`.
- **Baseline:** `4ee09d32566d432630470e8adfe8108044a4478b`, as recorded by the specification and equal to the checked-out `HEAD` during planning.
- **Working tree:** clean when checked during planning.
- **Observed baseline commands:** `npm test` exited 0 and `npm run check:module-limits` exited 0 in this planning session. Their output was not used as a new expected-output source.
- **GitNexus:** available in this session. Cycle check was clean (`cycleCount: 0`). Upstream impact was run for the primary symbols before planning edits: `setupProject` returned **HIGH** risk (3 direct upstream callers, 3 affected processes, 2 modules); `provisionProject` returned **CRITICAL** risk (11 direct upstream callers, 8 affected processes, 2 modules). These are warnings for implementation, not permission to edit. Implementation must review these callers and rerun impact for each symbol before modifying it.
- **Static limitation:** current source inspection found no static import cycles, but this does not replace a post-refactor graph check.

## 1. Goal and boundaries

### User problem

Runtime code, presentation, tests, fixtures, and development checks currently share `scripts/`. This makes contribution boundaries unclear, ships tests/tooling in the package, couples provisioning to Ink/TTY presentation, and prevents a complete native-runner and whole-runtime coverage gate.

### Required current behavior

The refactor must preserve commands, aliases, flags, defaults, validation, errors, exit codes, prompt sequence and keyboard behavior, stdout/stderr routing, raw output bytes, progress and ANSI emission, generated workspace content, schemas, ownership markers, manifests, integrity checks, user-file preservation, secrets, permissions, symlink handling, backups, cleanup, recovery, upstream policies, and transaction boundaries.

### Proposed behavior

- Runtime code is organized under `bin/` and feature-oriented `src/` modules.
- Tests and fixtures are under `test/` and use only `node:test` and `node:assert/strict`.
- `scripts/` contains development checks and measurement tooling only.
- Provisioning receives output/progress adapters and does not inspect TTY state, ask questions, or create Ink renderers.
- Settings, interaction, and provisioning responsibilities are separated without changing execution order or transaction boundaries.
- Coverage includes every runtime file in `src/` and `bin/`, including unloaded files, with 80% minimum line/function/branch thresholds.
- CI validates PRs and `main` pushes on Ubuntu and macOS with Node 20, 22, and 24.
- A real packed-tarball installation runs outside the checkout and excludes tests, fixtures, development tooling, CI workflows, and internal plans.

### Non-goals

No new commands, flags, defaults, presentation changes, schema or permission changes, upstream installation/version/policy changes, gstack team-mode migration, TypeScript migration, enterprise controller/service/repository/DI/event-bus layers, Windows support, compatibility wrappers for removed internal paths, user-data migration, intermediate release, or automatic commit/push/publication.

### Premise and feasibility challenge

The requested architecture is feasible as a staged mechanical move followed by extraction, but exact output parity is the main constraint. Moving formatters or changing emission ownership can alter bytes even when semantic output is unchanged. The implementation must therefore capture baseline streams before relocation and inject existing adapters without rewriting text, ordering, ANSI handling, or timing. The `provisionProject` impact is CRITICAL; it has many self-check callers and must be migrated in small, independently verifiable phases rather than edited as a single broad rewrite.

## 2. Requirement and acceptance matrix

| ID | Source | Expected behavior | Proposed change | Verification / test case | Negative or boundary case | Status |
|---|---|---|---|---|---|---|
| AC-01 | Issue + SPEC §Acceptance 1 | Runtime is in `bin/` and `src/`; tests in `test/`; development tooling in `scripts/`. | Move entrypoint/runtime/test assets to the target map; keep only checks/measurement in `scripts/`. | Inventory and filesystem/layout check; package smoke. | No runtime remains in `scripts/`; no test is discovered twice. | Required |
| AC-02 | Issue + SPEC §Acceptance 2 | No active code, fixture, script, or contributor documentation references removed source paths. | Update static, dynamic, subprocess, `import.meta.url`, fixture, package-root, vendor, MCP, template, and docs paths; classify historical references rather than blind replacement. | Search active files and run focused path-resolution tests. | Historical changelog/spec text may retain old paths; active imports may not. | Required |
| AC-03 | Issue + SPEC §Acceptance 3 | Equivalent controlled CLI runs produce identical commands, flags, defaults, validation, prompts, streams, exit codes, and bytes. | Add characterization before moves; preserve parser, dispatch, formatters, order, and errors during moves/extraction. | Raw stdout/stderr byte comparisons on same OS, Node, locale, environment, terminal size, fixture, and absolute target. | Invalid options, missing values, `--force` + `--migrate`, cancellation, retry, upstream failure, and non-TTY behavior. | Required |
| AC-04 | Issue + SPEC §Acceptance 4 | Parity compares raw streams separately without hiding whitespace, ANSI, order, or line-ending differences. | Store/compare byte buffers independently; do not trim, normalize, strip ANSI, sort, or regenerate expectations from the new implementation. | `Buffer` equality assertions for stdout and stderr. | Uncontrolled live animation/external text cannot establish parity; report a blocker rather than weakening the test. | Required |
| AC-05 | Issue + SPEC §Acceptance 5 | Generated workspaces retain current content and behavior. | Preserve settings merge precedence, generated files, permissions, manifests, ownership, secrets, and controlled dynamic values. | Fixture-backed workspace snapshots and semantic file/mode/symlink/integrity assertions. | Existing user files, missing files, malformed settings, tracked managed paths, symlinked managed paths, and partial failure. | Required |
| AC-06 | Issue + SPEC §Acceptance 6 | Every old assertion and failure scenario is accounted for. | Build a Phase 0 inventory and old-check-to-new-test migration table; move each scenario into named tests. | Count and review inventory; test discovery check; one mapping per old check block. | No placeholder test or fixture created only at module import; failure-path cleanup included. | Required |
| AC-07 | Issue + SPEC §Acceptance 7 | `npm test` uses native `node:test` and discovers each entry exactly once. | Convert orchestration/self-check files into grouped `.test.mjs` entries and update package scripts/duration measurement. | Run `npm test`, focused explicit test path, and discovery-count check. | Process-global state tests serialize and restore state after assertion or setup failure. | Required |
| AC-08 | Issue + SPEC §Acceptance 8 | All runtime files, including unloaded files, participate in coverage; line/function/branch each meet 80%. | Replace ECC-only scope with whole `src/` + `bin/` scope; retain changed-line coverage and fail on unloaded files. | Linux/Node 24 coverage run; threshold and source-list assertions. | No ignore pragmas, threshold reduction, validator weakening, or expectation regeneration. | Required |
| AC-09 | Issue + SPEC §Acceptance 9 | No internal static import cycles. | Preserve feature direction and keep shared filesystem primitives below application/features. | GitNexus cycle check and static import check after every relocation stage. | New UI↔feature, ECC↔gstack, or feature↔feature cycle. | Required |
| AC-10 | Issue + SPEC §Acceptance 10 | Provisioning does not present UI, ask questions, or decide TTY behavior. | Move presentation into `src/ui/`; pass output/progress adapters into `src/setup/provision.mjs`; keep TTY decisions in CLI/setup/UI adapters. | Structural dependency check plus provision tests with injected adapters and no TTY access. | Provisioning called directly in CI/non-TTY and interactive setup; output remains equivalent. | Required |
| AC-11 | Issue + SPEC §Acceptance 11 | ECC and gstack remain independent and do not import presentation implementations. | Move ECC/gstack groups mechanically; enforce dependency direction and presentation boundary. | Import graph/forbidden-import check and feature-focused tests. | ECC setup must not import gstack; gstack setup must not import ECC or Ink/UI implementations. | Required |
| AC-12 | Issue + SPEC §Acceptance 12 | Real tarball installs and runs outside checkout, resolves assets, and excludes tests/fixtures/development tooling. | Explicit `package.json` allowlist; add temporary-directory pack/install smoke test from a different cwd. | Pack tarball, install outside checkout, run help/version and offline fixture setup, verify templates/MCP/vendor, inspect archive paths. | Assert absence of `test/`, fixtures, development scripts, `.github/workflows/`, and internal plans; `npm pack --dry-run` alone is insufficient. | Required |
| AC-13 | Issue + SPEC §Acceptance 13 | PR/main validation passes on Linux/macOS with Node 20/22/24. | Add `.github/workflows/ci.yml`; align release validation to reuse the same commands. Install Bun satisfying the existing runtime requirement without changing the requirement. | CI matrix or equivalent local command review; package smoke in each matrix job as specified. | Offline fixture tests must not download live ECC/gstack upstream code; dependency install may use the network. | Required |
| AC-14 | Issue + SPEC §Acceptance 14 | Schemas, ownership, secrets, permissions, and rollback boundaries are unchanged. | Extract settings mechanically; preserve provision rollback, ECC synchronization rollback, and gstack setup/rollback separately. | Existing failure-injection tests plus file content/mode/ownership/secret/snapshot comparisons. | Failure during each existing stage, rollback failure, retained recovery snapshot, and user-file preservation. | Required |
| AC-15 | Issue + SPEC §Acceptance 15 | GitNexus upstream impact precedes symbol edits; HIGH/CRITICAL risk is reported; `detect_changes()` precedes authorized commits. | Phase 0 restores/uses GitNexus; implementation logs per-symbol impact before edits and reports high risk; pre-commit verification runs change detection. | Review implementation log/plan checklist and run `detect_changes()` against intended scope before any separately authorized commit. | No edit proceeds when impact is unavailable or high/critical risk is unreported. This planning task makes no commit. | Required |
| AC-16 | Issue + SPEC §Acceptance 16 | Contributor docs explain module map, dependency direction, focused tests, coverage, and package smoke verification. | Add/update `docs/architecture.md` and `CONTRIBUTING.md`. | Documentation review and commands copied from actual package scripts/workflow. | Docs must not instruct contributors to use removed paths or claim live-upstream verification from fixtures. | Required |
| SPC-01 | SPEC §§Native runner, CI, Rules | Every changed/new test has `protects=...; fails_when=...; no_claim=...`. | Add behavioral card beside each migrated/new test or in the repository’s established test metadata format, to be decided in Phase 0 after inspecting existing conventions. | Search all changed tests and review cards against observable assertions. | No card that claims live upstream availability from a fixture. | Required |
| SPC-02 | SPEC §§Testing Plan, Rules | Fixture tests are deterministic and lifecycle-safe. | Create/clean fixtures in hooks or `try/finally`; control clocks, paths, tool results, progress scheduling, and external errors. | Failure injection at each cleanup/rollback stage; run with CI/non-TTY env. | Setup interruption, thrown assertion, permission failure, symlink/non-regular entry, timeout/retry. | Required |
| SPC-03 | SPEC §Packaging | Package version and dependency versions remain unchanged. | Change only bin/files/scripts needed for refactor; preserve version and dependency ranges. | Compare package metadata before/after and inspect lockfile changes. | No incidental dependency addition or version bump. | Required |
| SPC-04 | SPEC §Out of Scope | No implementation begins solely because the issue exists; delivery is phase-focused and independently revertible. | Deliver small phase PRs only after separate authorization; no child issues/commits/branches/PRs in this plan. | Review phase boundaries and rollback points. | Stop before release if parity or installed-package smoke fails. | Required |

## 3. Current architecture and end-to-end flow

### Verified current components

- `scripts/repo-pattern.mjs:1-220`: executable, argument parsing, package-root resolution, command dispatch, top-level errors and exit codes.
- `scripts/lib/setup.mjs:345-493`: `setupProject`; interactive/non-interactive preparation, retry state, wizard orchestration, permission/attribution decisions, and `provisionProject` call.
- `scripts/lib/provision.mjs:385-629`: `provisionProject`; audit, safety checks, progress creation, snapshot/backup, workspace generation, ECC/gstack setup, rollback, lock/result output.
- `scripts/lib/provision.mjs:93-383`: generated settings/attribution/permission/local-settings helpers that belong in `settings` under the proposed boundary.
- `scripts/lib/rules.mjs:83`: ECC rule application and presentation summary coupling.
- `scripts/lib/prompt.mjs`, `progress.mjs`, `setup-wizard.mjs`: Ink/React/prompt/progress presentation.
- `scripts/self-check.mjs` and `scripts/self-check/*.mjs`: current sequential self-check orchestration and scenarios; some modules are imported for side effects and `scripts/self-check/gstack-documents.mjs:8` creates a fixture at module load.
- `scripts/check-ecc-coverage.mjs`, `check-diff-coverage.mjs`, `test-coverage.mjs`, `check-module-limits.mjs`, `measure-test-duration.mjs`: development checks and measurements.
- `.github/workflows/nodejs-package.yml:6-70`: release-only Ubuntu/Node 20 workflow with `npm ci`, Bun setup, tests, dry-run packaging, and publish.
- `package.json:9-63`: current npm scripts, `bin` entry at `scripts/repo-pattern.mjs`, and broad `scripts/` package inclusion.

### Current control/data flow

1. Package or direct invocation enters `scripts/repo-pattern.mjs:168` `main()`.
2. `parseArgs()` validates command/options and resolves `target` against `process.cwd()`.
3. Dispatch invokes feature modules. `setup` calls `setupProject({ sourceRoot, ...options })`.
4. `setupProject()` selects interactive/non-interactive flow, reads target state, detects/audits the project, prepares wizard selections, and calls `provisionProject()`.
5. `provisionProject()` audits/rejects unsafe paths, constructs progress, snapshots state, backs up existing content, writes templates/settings/MCP/config, runs ECC/rules/skills/gstack, and restores the provision snapshot on failure.
6. Separate gstack recovery and rollback handling completes or reports failure; lock state, doctor checks, warnings, and summary are emitted.
7. Tests currently run through a single orchestration module rather than native discovery.

### Target control/data flow

1. `bin/repo-pattern.mjs` contains only shebang and invocation of `src/cli.mjs`.
2. `src/cli.mjs` owns argument parsing, validation, source/package asset-root resolution independent of cwd, command dispatch, top-level errors, and exit codes.
3. `src/setup/setup.mjs` prepares state/defaults and coordinates interaction/provisioning; `src/ui/setup-interaction.mjs` owns prompt definitions and wizard integration.
4. `src/setup/provision.mjs` receives resolved selections and supplied output/progress adapters, owns execution order, backups, snapshots, recovery, and results; it does not inspect TTY, ask questions, or construct Ink.
5. `src/setup/settings.mjs` owns the extracted settings generation/reconciliation helpers without changing precedence, secret handling, modes, or writes.
6. `src/ecc/` and `src/gstack/` remain independent feature groups. `src/ui/` and `src/shared/` provide presentation/adapters and low-level primitives respectively.
7. `test/` runs native `.test.mjs` entries exactly once; `scripts/` runs coverage, module-limit, diff-coverage, and duration tooling.
8. Packaging includes only the explicit runtime/assets allowlist; the installed package resolves all assets from its own root rather than the checkout or cwd.

### High-risk blast radius to preserve

Verified GitNexus results before any implementation edits:

- `setupProject` (`scripts/lib/setup.mjs:345`): **HIGH**; direct upstream callers include `main`, `runMcpServerChecks`, and `runProvisionAndPipelineChecks`; 3 affected processes and 2 modules.
- `provisionProject` (`scripts/lib/provision.mjs:385`): **CRITICAL**; 11 direct upstream callers including `setupProject` and multiple self-check scenario functions; 8 affected processes and 2 modules.

The implementation must inspect all direct callers before editing and use the exact symbol UID/path when rerunning `impact`. The CRITICAL result requires explicit warning and staged edits; it is not a reason to silently narrow the acceptance criteria.

## 4. Impacted files and proposed destinations

All existing paths below are **verified**. Destinations marked **proposed** must be finalized by the Phase 0 inventory before movement.

| Verified current path | Proposed destination / action | Responsibility |
|---|---|---|
| `scripts/repo-pattern.mjs` | `bin/repo-pattern.mjs` + `src/cli.mjs` | Thin executable wrapper; parser/dispatch/root/error logic |
| `scripts/lib/setup.mjs` | `src/setup/setup.mjs` + `src/ui/setup-interaction.mjs` | Setup state/orchestration versus interaction definitions |
| Settings portions of `scripts/lib/provision.mjs` | `src/setup/settings.mjs` | Settings generation, reconciliation, permissions, attribution, local settings |
| `scripts/lib/provision.mjs` | `src/setup/provision.mjs` | Provision transaction and results; injected adapters |
| `scripts/lib/bypass-permissions.mjs` | `src/setup/bypass-permissions.mjs` | Existing permission support |
| `scripts/lib/ecc*.mjs`, `scripts/lib/rules.mjs` | `src/ecc/` | ECC feature group and rule application |
| `scripts/lib/gstack*.mjs` | `src/gstack/` | gstack feature group |
| `scripts/lib/prompt.mjs`, `progress.mjs`, `setup-wizard.mjs` | `src/ui/` | Existing presentation/adapters, without output rewrites |
| `scripts/lib/fs-utils.mjs`, `git-progress.mjs` | `src/shared/` | Shared filesystem/progress primitives |
| Remaining `scripts/lib/{audit,cleanup,doctor,herdr,mcp,project-detect,skills}.mjs` | Corresponding top-level `src/*.mjs` (**proposed exact map**) | Existing feature modules |
| `scripts/vendor/herdr/` | `src/vendor/herdr/` | Vendored assets and license |
| `scripts/self-check.mjs`, `scripts/self-check.test.mjs`, `scripts/self-check/*.mjs` | Grouped `test/{cli,setup,ecc,gstack,ui,shared}/` and `test/fixtures/` | Native test entries and lifecycle-safe fixtures |
| `scripts/check-ecc-coverage.mjs` | `scripts/check-coverage.mjs` | Whole-runtime coverage |
| `scripts/check-diff-coverage.mjs`, `check-module-limits.mjs`, `measure-test-duration.mjs` | Same `scripts/` paths with updated source/runner integration | Development checks |
| `scripts/test-coverage.mjs` | Same path or minimal package-script-compatible adjustment (**resolve in Phase 0**) | Coverage orchestration |
| `package.json` | Update bin, npm scripts, explicit files allowlist; preserve version/dependency versions | Package contract |
| `.github/workflows/nodejs-package.yml` | Reuse common validation commands; preserve publish job | Release validation |
| `.github/workflows/ci.yml` | New file (**proposed**) | PR/main Linux/macOS Node matrix |
| `docs/architecture.md` | Update existing or add only if absent (**verify in Phase 0**) | Module map/dependency direction |
| `CONTRIBUTING.md` | Update existing or add only if absent (**verify in Phase 0**) | Test/coverage/package workflow |

### Compatibility contracts

- Public package executable remains `repo-pattern`; only its package path changes to `bin/repo-pattern.mjs`.
- Existing CLI commands and flags remain unchanged.
- Internal `scripts/repo-pattern.mjs` and `scripts/lib/*` paths have no supported external consumers according to the specification; do not add wrappers.
- Runtime asset paths must derive from the packaged source root, not the caller’s cwd.
- Package version and dependency versions remain unchanged.
- No user-data migration is needed. Each phase must be independently revertible.

## 5. Design decisions and alternatives

| Decision | Selected approach | Evidence / tradeoff | Rejected alternative |
|---|---|---|---|
| Source organization | Direct feature modules and functions | Explicit Issue/SPEC target map; current modules already expose function-based APIs. Smallest structural change. | Controller/service/repository hierarchy, DI framework, event bus, or TypeScript; explicitly out of scope. |
| CLI entry | Thin `bin/` wrapper plus `src/cli.mjs` | Separates executable mode from parser/dispatch and makes package-root resolution testable. | Keep runtime in the executable; preserves the current coupling and packaging gap. |
| Setup/UI split | Extract prompt definitions and wizard integration into `src/ui/setup-interaction.mjs`; keep state/orchestration in setup | Existing `setup.mjs` mixes both; preserves function names and avoids changing interaction semantics. | Rewrite the wizard or add a general UI framework; risks byte/prompt parity. |
| Provision output | Inject existing output/progress adapters | Required by the specification; removes TTY/Ink imports while preserving output ownership and order. | Let provisioning import `prompt`/`progress`; directly violates AC-10/11. |
| Settings extraction | Mechanical move to `src/setup/settings.mjs` first, then narrowly adapt imports | Existing helpers are localized at `provision.mjs:93-383`; preserves merge and permission behavior. | Rewrite settings algorithms during relocation; increases regression surface. |
| Test runner | Native `node:test` and `node:assert/strict` | Explicit requirement and standard-library first. | New test framework or retaining side-effect orchestration; violates the specification. |
| Coverage | Explicit runtime file enumeration under `src/` and `bin/`, including unloaded files | Meets AC-08 and avoids false success from only loaded modules. | ECC-only scope, ignore pragmas, or lower thresholds. |
| Packaging | Explicit `package.json.files` allowlist plus installed tarball smoke test | Prevents development/test leakage and verifies runtime asset resolution. | Broad `scripts/` allowlist or dry-run-only check; known insufficient. |
| CI | Matrix workflow for PR/main and reusable command set for release | Meets OS/Node matrix and avoids divergent release rules. | Separate release-only checks; current workflow misses PR regressions. |
| Parity evidence | Baseline characterization before relocation, raw `Buffer` stream comparisons | Prevents the refactor from generating its own expectations. | Snapshot normalization or uncontrolled live runs. |

### Feasibility blockers to resolve in Phase 0

1. **Complete destination map:** the target map says remaining modules go directly under `src/`, but does not enumerate every current module. Inventory must finalize exact destinations before moves.
2. **Coverage command graph:** the specification names `scripts/check-coverage.mjs`, while the current package runs `scripts/test-coverage.mjs` and the current checker is `check-ecc-coverage.mjs`. Preserve a stable public npm command while choosing one internal checker graph and document it.
3. **CI Bun pin:** repository code/docs require Bun `1.4.2+`, while the current release workflow pins Bun `1.3.14`. The refactor must install a version satisfying the existing runtime requirement; do not change the product requirement silently. Confirm the supported exact CI pin from current project documentation/tooling before editing the workflow.
4. **Documentation existence:** the requested `docs/architecture.md` and `CONTRIBUTING.md` must be checked in Phase 0; do not create duplicates if equivalent docs already exist.
5. **Exact test-card format:** the required behavioral card is specified, but current repository conventions for storing it need inspection before choosing comments or metadata.

## 6. Ordered implementation tasks

Each phase is independently revertible. No phase authorizes a commit or PR by itself.

### Phase 0 — Inventory, access, and baseline

**Prerequisites:** clean working tree; baseline rechecked if `HEAD` advances.

1. Confirm GitNexus repository/index availability and read repository context/processes.
2. Run exact upstream `impact` for every symbol that will be edited, beginning with `setupProject` and `provisionProject`; record direct callers, processes, modules, risk, and warnings. Stop/report before high/critical edits if unavailable.
3. Inventory all runtime files, exports, static/dynamic importers, subprocess paths, `import.meta.url` uses, templates, MCP definitions, fixtures, vendor assets, docs references, package files, and executable modes.
4. Record exact current assertion and failure-scenario counts by self-check module; do not invent counts.
5. Capture controlled baseline raw stdout/stderr for help/version, invalid arguments, setup modes, cancellation/retry, dry-run, force/migrate, and controlled failures; capture generated-workspace trees/content/modes/links and recovery results.
6. Resolve the destination map, coverage command graph, doc paths, test-card convention, and supported Bun CI pin from verified repository evidence.

**Exit condition:** complete inventory, caller map, baseline artifacts/counts, unresolved assumptions list, and impact record exist; no implementation files changed.

**Covers:** AC-02, AC-03, AC-06, AC-08, AC-15, SPC-03.

### Phase 1 — Characterization tests before movement

**Prerequisites:** Phase 0 baseline artifacts and counts; GitNexus impact reviewed.

1. Add raw-byte CLI characterization tests without changing runtime behavior.
2. Add generated-workspace, settings, permissions, symlink, integrity, backup, rollback, recovery, and controlled external-error characterization cases using deterministic fixtures.
3. Add tests for stream separation, prompt/order-sensitive flows, cancellation/retry, `--yes`, `--dry-run`, `--force`, and `--migrate`.
4. Ensure fixture creation/cleanup is lifecycle-safe and process globals restore in `finally`/hooks.
5. Record each test’s behavioral card and map each old scenario to a test ID.

**Exit condition:** characterization passes against the original layout; any byte difference blocks progression and is investigated rather than normalized.

**Covers:** AC-03, AC-04, AC-05, AC-06, AC-14, SPC-01, SPC-02.

### Phase 2 — Mechanical relocation and path/package updates

**Prerequisites:** Phase 1 green; exact impact run for symbols being moved; HIGH/CRITICAL warnings recorded.

1. Move the executable to `bin/repo-pattern.mjs`, preserving executable mode, with only invocation logic.
2. Move runtime modules to the finalized `src/` map while retaining symbol names and logic.
3. Move vendor assets and preserve licenses.
4. Update all imports and path assumptions, including package root, templates, MCP definitions, fixtures, subprocesses, vendored files, and documentation.
5. Update `package.json` bin/scripts without changing package/dependency versions.
6. Keep responsibility boundaries unchanged in this phase; do not combine extraction with relocation.
7. Run focused imports, module-limit checks, characterization tests, package dry-run inspection, and cycle check.

**Exit condition:** no active old-path references, imports resolve, characterization remains byte-identical, no cycle is introduced, and the moved package is internally runnable.

**Covers:** AC-01, AC-02, AC-03, AC-04, AC-09, AC-12, AC-15, SPC-03.

### Phase 3 — Responsibility extraction

**Prerequisites:** Phase 2 green; exact per-symbol impact for each changed function/class/method; CRITICAL `provisionProject` callers reviewed.

1. Extract settings helpers from `provision.mjs` into `src/setup/settings.mjs` mechanically, then verify merge precedence, secret filtering/persistence, file modes, tracked-file rejection, and generated hook behavior.
2. Extract prompt definitions, interaction validation, and wizard integration into `src/ui/setup-interaction.mjs`; keep setup state preparation and business defaults in `src/setup/setup.mjs`.
3. Adapt `src/setup/provision.mjs` to receive the existing output/progress adapters; remove direct presentation imports, Ink/React use, and TTY decisions from provision.
4. Move/match summary formatters without changing text or emission order. Keep TTY selection in the caller/UI adapter.
5. Verify ECC and gstack imports remain independent and neither imports presentation implementations.
6. Re-run provision/ECC/gstack rollback and recovery scenarios after each extraction boundary.

**Exit condition:** all boundary checks pass; exact CLI/workspace bytes remain equal; provision has no UI/TTY/prompt responsibilities; transaction boundaries are unchanged.

**Covers:** AC-03, AC-04, AC-05, AC-09, AC-10, AC-11, AC-14, SPC-02.

### Phase 4 — Native test migration and whole-runtime coverage

**Prerequisites:** Phase 3 green; old-check inventory complete.

1. Convert every existing self-check block into named `.test.mjs` entries grouped by feature under `test/cli`, `test/setup`, `test/ecc`, `test/gstack`, `test/ui`, and `test/shared`.
2. Move fixtures into `test/fixtures`; create/clean them within lifecycle hooks or `try/finally`, including failure paths.
3. Remove side-effect-only test imports and ensure each test entry is discovered exactly once.
4. Serialize tests mutating console, TTY, environment, streams, or other process-global state; restore state on all paths.
5. Preserve focused test-path execution and adapt `measure-test-duration.mjs`.
6. Replace ECC-only coverage scope with all `src/` and `bin/` runtime files, including unloaded files; update diff coverage paths and ingestion.
7. Run Linux/Node 24 coverage with 80% line/function/branch gates and add behavioral tests for genuine gaps.

**Exit condition:** inventory has no missing assertions/failure scenarios; `npm test`, focused tests, duration measurement, coverage, diff coverage, module limits, and cycle checks pass without suppressions.

**Covers:** AC-06, AC-07, AC-08, AC-09, SPC-01, SPC-02.

### Phase 5 — CI, packaging, smoke verification, and documentation

**Prerequisites:** Phases 1–4 green; package allowlist finalized; supported Bun pin verified.

1. Replace broad `scripts/` package inclusion with explicit runtime/assets/licenses allowlist; exclude tests, fixtures, development scripts, workflows, and internal plans.
2. Add a real tarball smoke test using temporary pack/install directories outside the checkout and a different execution cwd. Run help/version and fixture-backed offline setup; verify template/MCP/vendor resolution and forbidden paths.
3. Add PR and `main` push CI for Ubuntu/macOS × Node 20/22/24 using `npm ci`, supported Bun, tests, module checks, and installed-package smoke. Run coverage on Linux/Node 24 with PR-base changed-line coverage.
4. Make release validation reuse the same validation commands rather than maintaining divergent checks; retain publish behavior and permissions.
5. Update architecture/contributor documentation with module map, dependency direction, focused tests, coverage, package smoke, and offline-fixture limitations.
6. Run the full authorized verification set and `detect_changes()` before any separately authorized commit.

**Exit condition:** installed tarball passes outside checkout; package excludes forbidden paths; CI/workflow syntax and matrix match requirements; docs contain no active removed-path instructions; change detection matches intended scope.

**Covers:** AC-01, AC-02, AC-07, AC-08, AC-09, AC-12, AC-13, AC-15, AC-16, SPC-03.

## 7. Test and verification matrix

| Layer | Tests/checks | Required cases | Acceptance IDs |
|---|---|---|---|
| Unit | `node:test` tests for parser/defaults, settings reconciliation, rule selection, path helpers, formatters, coverage/discovery helpers | Empty/duplicate/invalid options, aliases, required values, merge precedence, secret filtering, modes, exact formatter bytes, unloaded-file detection | AC-03, AC-04, AC-05, AC-07, AC-08 |
| Integration | Workspace/provision tests | Generated files/content/schema, ownership markers, permissions, secrets, symlinks, non-regular entries, tracked paths, backups, cleanup, snapshot rollback, rollback failure and recovery snapshot | AC-05, AC-10, AC-14, SPC-02 |
| ECC | ECC source/rules/manifest/synchronization tests | Selection, staging, integrity, synchronization rollback, no gstack/UI imports | AC-05, AC-09, AC-11, AC-14 |
| gstack | gstack/runtime/upstream/document lifecycle tests | Upstream failure, retries, version policy, state/checkouts, document handling, separate rollback/recovery; fixture-only tests do not claim live availability | AC-05, AC-11, AC-14, SPC-01 |
| CLI fixture E2E | Spawn installed/direct CLI with captured streams | Help/version, invalid args, unknown command, setup interactive/non-interactive, cancellation, retry, dry-run, force/migrate, exact stdout/stderr and exit codes | AC-03, AC-04, AC-05 |
| Lifecycle | Native runner and fixture checks | No import-time fixture side effects, cleanup after assertion/setup failure, serial process-global state restoration, exactly-once discovery, focused path and duration command | AC-06, AC-07, SPC-01, SPC-02 |
| Architecture | GitNexus cycle check, static dependency check, forbidden-import/path scan, module-limit check | No cycles; provision has no UI/TTY/prompt; ECC/gstack independence; no active removed paths | AC-01, AC-02, AC-09, AC-10, AC-11 |
| Coverage | `npm run test:coverage` or finalized equivalent | All `src/`/`bin/` files included, unloaded files count uncovered, line/function/branch ≥80%, changed-line check uses new paths | AC-08, SPC-03 |
| Packaging | Real tarball smoke | Pack/install in temp dir outside checkout, execute from another cwd, help/version, offline setup, template/MCP/vendor resolution, forbidden paths absent | AC-12, AC-13 |
| CI | Workflow matrix | PR and `main` push, Ubuntu/macOS, Node 20/22/24, `npm ci`, supported Bun, tests/module/package checks, Linux Node 24 coverage | AC-13, SPC-03 |
| Documentation | Review `docs/architecture.md`, `CONTRIBUTING.md` | Module map, dependency direction, focused tests, coverage, package smoke, no stale active instructions | AC-02, AC-16 |

### Baseline protocol

Before each implementation phase that changes behavior-adjacent code, run the relevant baseline command on the original/refactored layout under the same OS, Node version, locale, environment, terminal dimensions, fixture, and absolute target path. Store stdout and stderr as separate byte sequences. Do not derive expected bytes from the refactored run. If animation or external-tool output cannot be controlled, mark the parity requirement blocked and do not weaken it.

### Security and filesystem cases

The plan preserves existing trust-boundary checks and adds explicit regression coverage for symlinks, non-regular entries, path boundaries, tracked managed files, permissions, secret persistence/filtering, backups, snapshots, and cleanup. Tests must use temporary targets and never operate on the operator’s home or checkout except through controlled read-only package inspection. No downloaded archive or external fixture is executed as code.

## 8. Failure-mode and risk register

| Risk | Severity | Detection | Mitigation | Recovery |
|---|---|---|---|---|
| Provision extraction changes output/order or transaction boundaries | Critical | Raw stream mismatch; rollback/recovery comparison; CRITICAL GitNexus blast radius | Characterize first; mechanical move before extraction; inject existing adapters; test each failure stage | Stop phase; revert only the affected authorized phase/PR; preserve unrelated work |
| `setupProject` callers lose exports/import paths | High | Focused callers and native test discovery fail; GitNexus impact review | Enumerate direct callers; retain symbol names; update all static/dynamic imports before deletion | Revert phase or restore missing import mapping; no compatibility wrapper unless separately authorized |
| Package asset resolution depends on cwd or checkout | High | Installed tarball run from different cwd fails; missing template/MCP/vendor tests | Resolve root from module URL/package location; run actual external install smoke | Stop release; fix path mapping before packaging changes ship |
| Test migration omits an assertion/failure scenario | High | Old/new inventory mismatch; coverage or focused behavior gap | Count and map every old block; named tests and behavioral cards; preserve failure injection | Block Phase 4 completion; restore missing scenario before removing old test |
| Coverage falsely excludes unloaded runtime files | High | Runtime file list differs from coverage source set; threshold passes with omissions | Enumerate all `src/`/`bin/`; assert unloaded files are uncovered; no ignore pragmas | Block coverage/CI; correct collector/checker scope |
| Fixture/import-time side effects leak state or files | High | Failure-path cleanup checks; repeated/parallel test runs; temp inventory | Hooks/`try/finally`, serial process-global tests, state restoration | Clean temporary fixtures; quarantine failing test and fix lifecycle before continuing |
| ECC/gstack/UI dependency cycle introduced | High | GitNexus cycle check and forbidden-import scan | Keep feature groups independent; use supplied adapters only | Revert offending move/extraction; redesign dependency direction without new framework |
| CI Bun version does not satisfy existing runtime requirement | High | `ensureBun`/gstack tests fail in CI; inspect current docs/code pin | Verify and align workflow pin to documented existing requirement; do not change product policy silently | Correct workflow before merging; no release publication on failing matrix |
| Package leaks tests, tooling, workflows, or plans | High | Tarball archive path assertions | Explicit allowlist and real install smoke | Adjust allowlist and rerun pack/install; do not rely on dry-run alone |
| Raw parity differs because live external output is uncontrolled | High | Byte comparison cannot stabilize external/animated text | Inject deterministic tools/clocks/progress; report blocker if control is impossible | Stop parity claim; do not trim/normalize or regenerate expected output |
| Documentation retains active old paths | Medium | Active-file path scan and docs review | Classify historical references; update contributor instructions and examples | Correct docs before AC-02 signoff |
| Public npm script/coverage naming becomes ambiguous | Medium | Package scripts and CI invoke different checkers | Resolve one internal graph in Phase 0; retain stable public command where possible | Update all callers/docs together; preserve dependency/version metadata |
| Phase scope becomes an oversized refactor | Medium | Diff/change detection and phase review | Separate characterization, relocation, extraction, runner, and CI/package phases | Revert only the out-of-phase change; continue from last green phase |

## 9. Open questions and safe interim assumptions

1. **Exact final destination for every remaining `scripts/lib` module:** unknown from the target map. Safe assumption: no move begins until Phase 0 records a complete one-to-one map, with remaining feature modules directly under `src/` as specified.
2. **Coverage checker naming/entrypoint:** sections are inconsistent. Safe assumption: preserve the existing public `npm run test:coverage` command while consolidating implementation under `scripts/check-coverage.mjs`; confirm before editing `package.json`.
3. **Behavioral-card storage convention:** not established in current files. Safe assumption: use the least invasive test-local metadata/comment format after inspecting existing tests; every changed/new test must contain the exact three fields.
4. **Documentation file existence:** not verified as present in the current shallow inventory. Safe assumption: update an existing equivalent document if present; otherwise add only the explicitly requested file.
5. **Bun CI pin:** current repository evidence reports a mismatch between documented/runtime minimum `1.4.2+` and release workflow `1.3.14`. Safe assumption: treat the documented/runtime requirement as authoritative and verify a supported exact CI version before changing workflow; do not change `package.json` engines.
6. **Live upstream validation:** not claimed by fixture tests. Safe assumption: CI fixture tests remain offline for ECC/gstack source downloads; live-upstream availability is a separate operational concern and a blocker only where the acceptance criterion explicitly requires controlled output.
7. **External consumers of removed internal paths:** the specification states none. Safe assumption: remove old paths without wrappers, while searching repository and package metadata for active references before deletion.

## 10. Final implementation-ready checklist

- [ ] Issue and canonical archive requirements reconciled; all explicit MUSTs mapped in the matrix.
- [ ] Baseline commit and clean working tree rechecked immediately before implementation.
- [ ] GitNexus index/context restored and exact upstream impact recorded for every symbol before edit; HIGH/CRITICAL warnings surfaced.
- [ ] Complete source/export/import/dynamic-import/path/fixture/package inventory recorded.
- [ ] Existing assertion and failure-scenario counts recorded, not estimated.
- [ ] Controlled raw stdout/stderr and generated-workspace baseline captured before moves.
- [ ] Complete old-to-new path map, coverage command graph, doc paths, test-card convention, and Bun pin resolved.
- [ ] Characterization tests pass against the original structure without normalized expectations.
- [ ] Mechanical moves are separate from responsibility extraction.
- [ ] Provision, ECC synchronization, and gstack rollback boundaries remain separate.
- [ ] Native tests preserve every old assertion/failure scenario and discover each entry once.
- [ ] Fixture lifecycle and process-global restoration cover failure paths.
- [ ] Whole-runtime line/function/branch coverage is ≥80% without suppressions and includes unloaded files.
- [ ] Cycle and forbidden-dependency checks pass.
- [ ] Actual installed-tarball smoke passes outside checkout and forbidden paths are absent.
- [ ] Linux/macOS Node 20/22/24 CI and Linux Node 24 coverage are wired with shared validation commands.
- [ ] Contributor/module documentation is updated without active removed-path instructions.
- [ ] `detect_changes()` is run before any separately authorized commit; no commit/push/release is part of this draft.

## Review applicability

The Issue/SPEC establishes no user-facing UI feature or visual design scope. It explicitly requires preserving existing CLI presentation and isolating it structurally, while excluding presentation changes. Therefore Design review is skipped with `no_ui_scope`. Engineering/DX/autoplan review phases are not added by this draft; the implementation should use the repository’s required impact, verification, and review gates when separately authorized.

## Draft readiness

**CEO review consolidated; not implementation-ready until the listed verification conditions are completed.** Known uncertainties are listed in Section 9; none is hidden behind a TBA/TODO placeholder. No implementation code or tests were changed, and no commit/push/deploy/release action was performed.

The CEO review is complete with `HOLD_SCOPE` and issues open. Design review is skipped under `no_ui_scope`. The plan is ready for the next authorized engineering review, not for implementation handoff.

## CEO Review — HOLD SCOPE

### Current scope and decision ledger

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| SCOPE-01 / CEO | Issue/SPEC requires source/test/tooling separation, parity, coverage, CI, packaging, and docs (`SPEC:183-200`) | Full refactor retained | Hold all stated requirements; no expansion or cut | approved | Prior branch decision: `CEO review (HOLD_SCOPE)` on 2026-11-11; no scope additions/cuts |
| APPROACH-01 / implementation owner | Mechanical move precedes responsibility extraction (`SPEC:170-181`) | Two-stage structure is planned | Preserve phase separation and transaction boundaries | approved | Direct Issue/SPEC direction; no new framework or wrapper |
| VERIFY-01 / implementation owner | GitNexus impact before symbol edits and change detection before commit (`SPEC:199`) | Primary symbols have HIGH/CRITICAL impact | Re-run exact impact for every edited symbol and report warnings before edits | approved | Direct project instruction; scope is verification only |
| TASK-01 / Phase 0 owner | Existing self-check/path/package inventory is not machine-auditable | Prior CEO task T1 | Carry T1 unchanged | approved | Prior task record `20261111T103220Z-2601117/T1` |
| TASK-02 / coverage owner | Existing coverage is ECC-scoped | Prior CEO task T2 | Carry T2 unchanged | approved | Prior task record `20261111T103220Z-2601117/T2` |
| TASK-03 / parity owner | Interactive raw-byte parity lacks a concrete terminal harness | Prior CEO task T3 | Carry T3 unchanged | approved | Prior task record `20261111T103220Z-2601117/T3` |
| TASK-04 / CI owner | Release and PR/main validation can diverge | Prior CEO task T4 | Carry T4 unchanged | approved | Prior task record `20261111T103220Z-2601117/T4` |
| DESIGN-01 / CEO | Full Issue/SPEC excludes presentation changes and requires CLI parity (`SPEC:265-267`) | No visual UI scope | Skip Section 11 with `no_ui_scope` | approved | Full Issue/SPEC evidence; no design review |

No new approach decision was needed. No user-originated scope expansion, cut, or TODO deferral was requested.

### 0A Premise challenge

The real problem is not directory naming alone. It is that runtime behavior, presentation ownership, tests, and package contents are coupled, making contributions and verification harder while allowing tests/tooling to ship. The plan addresses the direct causes: it moves code, separates provisioning from presentation, migrates the test lifecycle, expands coverage, and verifies an installed tarball. Doing nothing preserves the current broad package inclusion and prevents the required architecture and validation gates. The premise is supported by `scripts/lib/provision.mjs:6-13`, `scripts/self-check.mjs:1-35`, `package.json:9-63`, and `SPEC:20-31`.

### 0B Existing code leverage

The plan reuses the current parser/dispatch in `scripts/repo-pattern.mjs:22-220`, setup orchestration in `scripts/lib/setup.mjs:345-493`, provision transaction in `scripts/lib/provision.mjs:385-629`, settings helpers in `scripts/lib/provision.mjs:93-383`, feature modules in `scripts/lib/ecc*.mjs` and `scripts/lib/gstack*.mjs`, and existing self-check scenarios. Rewriting these paths would increase parity risk and contradict the SPEC’s instruction to retain symbol names and move mechanically (`SPEC:100`, `SPEC:170-181`). The four carried tasks target evidence gaps rather than replacing existing behavior.

### 0C Dream-state delta

```text
CURRENT STATE                         THIS PLAN                         12-MONTH IDEAL
scripts mixes runtime/tests/tools ---> src/bin + test + scripts ---> contributors find one clear feature boundary,
provision imports presentation      ---> adapters + settings split ---> add features without crossing UI/transaction lines,
self-check/package are broad        ---> native tests + tarball CI ---> every release is reproducibly verified outside checkout
```

### Complexity and scope check

The plan necessarily crosses many files because AC-01, AC-07, AC-08, AC-12, and AC-13 explicitly require layout, runner, coverage, packaging, and matrix changes. It avoids extra classes, services, frameworks, dependencies, commands, and migrations. The smallest correct approach is staged relocation plus narrow extraction; cutting the carried inventory, parity harness, coverage validation, or shared CI contract would leave an explicit acceptance criterion unverifiable.

## Review Sections 1–10

### Section 1: Architecture Review

**OK.** The proposed boundaries match the Issue/SPEC and reuse existing functions. The dependency direction is:

```text
bin/repo-pattern.mjs
        |
        v
src/cli.mjs ---> src/setup/setup.mjs ---> src/setup/provision.mjs ---> src/ecc/ + src/gstack/
    |                    |                         |
    v                    v                         v
src/shared/        src/ui/setup-interaction.mjs  src/setup/settings.mjs
    ^                    |
    +--------------------+

 test/*  ---> src/*       scripts/* ---> test/coverage/package checks
```

The implementation must not make `provision` import `src/ui`, React, Ink, or TTY detection. Happy, nil, empty, and error paths are already required in the task/test matrix; the concrete adapter contract remains an implementation choice owned by Phase 3 and must be proven by T3 and AC-10 tests. No new network endpoint, database, or persistent schema is introduced. The main single points of failure are path-root resolution, the provision transaction, and package allowlisting; installed-tarball and rollback tests cover them. Rollback is phase-level: stop before release and revert only the affected authorized phase/PR (`SPEC:224-226`).

### Section 2: Error and rescue map

| Codepath | What can go wrong | Exception/result | Rescue/action | User sees | Test |
|---|---|---|---|---|---|
| `src/cli.mjs` argument parse/dispatch | Missing/unknown option, invalid combination | validation error / exit 2 | Preserve current stderr and exit behavior | Existing error text | CLI invalid-argument cases |
| `src/setup/setup.mjs` preparation | Non-interactive without `--yes`, malformed lock/settings, unavailable Claude CLI | `Error`, `SyntaxError` | Preserve explicit error/warning; stop before mutation | Existing warning/error | setup boundary tests |
| `src/setup/provision.mjs` workspace transaction | Permission, tracked path, symlink, write, component failure | filesystem/upstream error | Restore provision snapshot; report rollback result | Existing failure and recovery text | failure injection at each stage |
| ECC synchronization | source/staging/integrity failure | setup result/error | Preserve ECC rollback boundary and warnings | Existing ECC warning/error | ECC rollback tests |
| gstack setup | Bun/upstream/bootstrap/hook failure | failed result/error | Preserve separate gstack rollback/recovery snapshot | Existing gstack failure/recovery | gstack failure tests |
| test fixture lifecycle | assertion/setup failure before cleanup | assertion/error | `finally`/hooks clean fixture and restore globals | Test failure, not silent pass | lifecycle tests |
| package smoke | missing packaged asset or forbidden path | subprocess/install failure | fail CI; do not weaken allowlist | CI failure | real tarball test |

No catch-all is proposed. Existing top-level CLI handling at `scripts/repo-pattern.mjs:213-217` and provision recovery at `scripts/lib/provision.mjs:508-535` must be preserved and rechecked after movement. Any newly introduced rescue action requires an explicit test and user-visible result; “swallow and continue” is not acceptable.

### Section 3: Security and threat model

**OK with required verification.** The plan adds no endpoint, credential, dependency, or authorization surface. It moves filesystem and subprocess code, so path-root resolution, symlink/non-regular handling, tracked-file rejection, secret filtering, permissions, temporary directories, and tarball execution are security-sensitive. Existing safeguards are named in `scripts/lib/provision.mjs:290-309`, `:364-383`, and `:397-398`; AC-05/AC-12/AC-14 require retaining them. No hardcoded secret is proposed. The implementation must inspect exact path joins and subprocess environment after every move; failure is a blocking test result, not a documentation warning.

### Section 4: Data flow and interaction edge cases

```text
argv/env/TTY
   | nil or empty -> existing defaults / interactive requirement error
   v
parse + validate
   | wrong/duplicate/invalid -> stderr + exit 2
   v
resolved options + package-root paths
   | missing asset -> explicit error before mutation
   v
setup interaction adapter
   | cancel/retry/timeout -> existing state transition and cleanup
   v
provision transaction
   | write/upstream/permission error -> snapshot restore + visible result
   v
workspace + lock + summary
   | pack/install from other cwd -> asset resolution must still succeed
```

The plan covers double invocation through existing retry/idempotence and backup/reconciliation tests, stale lock status through `setupOptionsFromLock`, empty selections through `none`/default pipeline cases, and external failures through controlled fixtures. The prior T3 remains a P1 because the plan’s original raw-byte requirement did not yet name a PTY/input/timing mechanism. Both completion orders around interactive input and progress must be tested with controlled release points; a plain non-TTY spawn is insufficient for keyboard parity.

### Section 5: Code quality review

**OK with three implementation constraints.** Direct function-based modules fit the repository and avoid speculative abstractions. Do not duplicate settings or output formatters during extraction; move the existing helpers once and update imports. Keep functions and file sizes within existing module-limit checks. Preserve names during mechanical moves and use graph-aware rename only if a true rename becomes necessary. The plan’s explicit “resolve exact destination map before movement” avoids guessed paths.

### Section 6: Test review

```text
old self-check block -> mapped native test -> fixture/hook -> observable assertion
CLI process ---------> raw stdout/stderr bytes -----------------> parity result
provision -----------> workspace/rollback fixture -------------> content + recovery result
package pack/install -> outside-cwd executable ----------------> asset + exclusion result
```

**WARNING:** the original plan names the required test categories but did not itself establish the machine-readable assertion/lifecycle inventory, syntactic branch/unloaded-file coverage proof, or controlled interactive harness. Prior CEO tasks T1–T3 are therefore P1 and must land before declaring the corresponding acceptance criteria verified. The test ambition is: Friday-at-2am confidence comes from raw CLI parity plus real tarball install; hostile QA targets stream ordering, cancellation, symlink/permission boundaries, rollback stages, and duplicate discovery; chaos testing injects failures after each provision stage and during cleanup. Fixture tests must explicitly state that they do not prove live upstream availability (`SPEC:212`).

### Section 7: Performance review

**OK.** This is a source/layout refactor with no intended algorithm, data-volume, database, or network-policy change. Packaging should reduce shipped files by removing tests/tooling, but no performance claim is made from the archived dry-run byte observations (`SPEC:31`). The main scalability concern is test runtime from broader coverage and a matrix; isolate tests where safe, serialize global-state tests, and retain the duration command. Measure before claiming improvement.

### Section 8: Observability and debuggability review

**OK for this CLI scope.** No production dashboard, metric, or alert is warranted for a behavior-preserving local CLI refactor. User-visible errors, warnings, progress, rollback results, and recovery snapshot paths are the existing observability surface and must remain byte-compatible. The plan requires preserving them and testing streams separately. CI logs and tarball archive assertions are the operational diagnostics. If an adapter hides an error or changes stream routing, it is a blocking parity failure.

### Section 9: Deployment and rollout review

The package is the deployment boundary; no database migration or feature flag is needed. Rollout sequence is: characterization green → mechanical move green → extraction green → native coverage green → installed-tarball/CI green → separately authorized release. A broken package is recovered by stopping before release or reverting the affected authorized PR; no user-data migration is required. Release workflow validation must reuse the PR/main validation contract, which is the carried P2 T4. Post-pack verification must execute from outside the checkout, not only inspect `npm pack --dry-run`.

### Section 10: Long-term trajectory review

**OK with known debt controls.** The refactor improves discoverability and makes future feature work safer by making dependency direction explicit. The main debt risks are a stale old-to-new inventory, incomplete test migration, and divergent CI commands; T1, T2, and T4 directly address them. Reversibility is **4/5**: phases are independently revertible and no user-data migration is required, but the native test/path migration touches many files and must be reverted by phase rather than piecemeal. The documentation requirement and explicit target map make the result understandable to a new contributor in 12 months.

### Section 11: Design and UX Review

**SKIPPED (no UI scope).** The full Issue and SPEC describe a CLI source refactor, explicitly require preserving existing CLI presentation byte-for-byte, assign UI to structural adapters, and list “any CLI presentation change” as out of scope (`SPEC:10-14`, `102-113`, `115-127`, `265-267`). No screen, frontend component, design system, responsive layout, or new user interaction is proposed. Existing prompt/keyboard behavior is covered as a compatibility contract, not a new design surface.

## Reality rows

REALITY: premise-table pass current problem and target are evidenced by existing runtime/test/package coupling and SPEC requirements `scripts/lib/provision.mjs:6-13`
REALITY: already-done pass base history and related-symbol search found no post-baseline implementation of this plan `4ee09d3`
REALITY: surface-check pass `--help` and `--version` both exit 0; npm scripts are listed in package metadata `package.json:9-17`
REALITY: binding-decisions pass prior branch decision holds scope with no additions or cuts `.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/decisions.jsonl:1`
REALITY: numbers pass baseline counts and risk figures are labeled for re-measure before implementation gate `docs/plans/issue-97-source-refactor.md:7-10`
REALITY: deferred-asks pass no linked Issue/SPEC request is omitted; unresolved implementation facts are retained in Section 9 `docs/plans/issue-97-source-refactor.md:308-316`
REALITY: pr-count pass one PR per wave is the review policy applied in this run `docs/plans/issue-97-source-refactor.md:605`
REALITY: prior-art pass existing function modules, self-check scenarios, and package scripts are reused rather than replaced `docs/plans/issue-97-source-refactor.md:69-80`
REALITY: contract-assumptions pass compatibility contracts and no-wrapper assumption are explicit `docs/plans/issue-97-source-refactor.md:139-146`
REALITY: dependency-fallback pass GitNexus impact and cycle checks are available; static inspection remains a fallback limitation `docs/plans/issue-97-source-refactor.md:103-110`
REALITY: obligation-tiers pass required acceptance IDs and tests are mapped in the matrix `docs/plans/issue-97-source-refactor.md:42-65`

PLAN_REALITY: phase=ceo rows=11/11 missing=none verdict=complete

## Implementation Tasks

Synthesized from the completed CEO review. These are verification conditions within the approved HOLD_SCOPE. No time estimate is used as completion evidence. Task IDs T1–T4 are unique across this plan.

- [ ] **T1 (P1)** — Phase 0 inventory — Produce machine-readable assertion, lifecycle, asset, and path inventory.
  - Surfaced by: Sections 2, 4, and 6; current self-check and package/path inventory is not auditable.
  - Files: `scripts/self-check.mjs`, `scripts/self-check/`, `scripts/lib/`, `package.json`, `scripts/`
  - Verify: inventory records every assertion/failure scenario, dynamic path, package asset, and old-to-new destination before movement.
- [ ] **T2 (P1)** — Coverage — Select and validate whole-runtime line/function/branch coverage.
  - Surfaced by: Section 6; the current checker does not establish syntactic branch coverage or unloaded-file accounting.
  - Files: `scripts/check-coverage.mjs`, `scripts/test-coverage.mjs`, `scripts/check-diff-coverage.mjs`, `package.json`
  - Verify: Linux/Node 24 coverage enumerates every `src/`/`bin/` runtime file and enforces line/function/branch thresholds without suppressions.
- [ ] **T3 (P1)** — Interactive parity — Define a controlled TTY, input, timing, and raw-stream parity harness.
  - Surfaced by: Section 4; non-TTY process capture cannot prove interactive byte parity.
  - Files: `test/cli/`, `test/setup/`, `src/ui/`
  - Verify: same scripted keyboard/input/timing produces separately byte-equal stdout/stderr for equivalent baseline and refactored runs on Linux and macOS.
- [ ] **T4 (P2)** — CI validation — Share one validation contract between PR/main and release workflows.
  - Surfaced by: Section 9; release and CI validation can diverge.
  - Files: `.github/workflows/ci.yml`, `.github/workflows/nodejs-package.yml`, `package.json`
  - Verify: matrix and release jobs invoke the same tests, module checks, coverage lane, and real installed-package smoke contract.

## NOT in scope

- No expansion or cut was proposed in this HOLD SCOPE review.
- Visual redesign, frontend/design-system work, new CLI behavior, TypeScript, enterprise layering, Windows support, live-upstream fixture downloads, migration wrappers, commits, branches, PRs, release, and deployment remain excluded by the Issue/SPEC (`SPEC:265-267`).
- No TODO deferral was created; all four prior tasks address required implementation readiness rather than optional future work.

## What already exists

- CLI parser/dispatch and error contract: `scripts/repo-pattern.mjs:22-220` — reuse by mechanical extraction.
- Setup orchestration and retry state: `scripts/lib/setup.mjs:345-493` — reuse and split only at the stated boundary.
- Provision snapshot/backup/rollback: `scripts/lib/provision.mjs:311-629` — preserve transaction behavior and inject adapters.
- Settings generation/reconciliation: `scripts/lib/provision.mjs:93-383` — move without algorithmic rewrite.
- ECC/gstack feature groups: `scripts/lib/ecc*.mjs`, `scripts/lib/gstack*.mjs` — preserve independence.
- Self-check scenarios and package scripts: `scripts/self-check*`, `package.json:9-17` — migrate and retain coverage of each scenario.

## Dream state delta

The plan moves the repository from a mixed `scripts/` layout to explicit runtime, UI, feature, test, and tooling boundaries, with installed-package proof and cross-platform validation. It does not attempt speculative platform abstractions or new product capabilities. The remaining 12-month work is ordinary feature development on top of clearer dependency direction, not another source-layout migration.

## Error & Rescue Registry

The registry above in Section 2 is the authoritative capability-level map. Its required implementation proof is: exact current error class/result, preserved handler, visible stream/exit result, and a failure-injection test for each row before the phase exit condition is accepted.

## Failure Modes Registry

| CODEPATH | FAILURE MODE | RESCUED? | TEST? | USER SEES? | LOGGED? |
|---|---|---:|---:|---:|---:|
| CLI parse/dispatch | Invalid argument or command | Y | Y | Y | Y, stderr |
| Setup preparation | Missing interactive terminal / malformed state | Y | Y | Y | Y, warning/error |
| Provision transaction | Filesystem/component failure | Y | Y | Y | Y, rollback result |
| ECC sync | Integrity or staging failure | Y | Y | Y | Y, warning/error |
| gstack setup | Upstream/bootstrap failure | Y | Y | Y | Y, recovery result |
| Fixture lifecycle | Assertion/setup failure before cleanup | Y | Y | Y | Y, test failure |
| Package smoke | Missing asset/forbidden package path | Y | Y | Y | Y, CI failure |

No row is intentionally `RESCUED=N`, `TEST=N`, `USER SEES=Silent`; the implementation must preserve this polarity and fail the phase if it cannot.

## Completion Summary

```text
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | HOLD SCOPE                                  |
  | System Audit         | Clean tree; HIGH setup and CRITICAL provision|
  | Step 0               | Scope held; four prior tasks carried       |
  | Section 1  (Arch)    | 0 new issues                                 |
  | Section 2  (Errors)  | 7 paths mapped, 0 gaps                       |
  | Section 3  (Security)| 0 new issues, 0 high                        |
  | Section 4  (Data/UX) | 7 edge paths, 1 concrete harness warning    |
  | Section 5  (Quality) | 0 new issues                                 |
  | Section 6  (Tests)   | Diagram produced, T1–T3 P1 gaps             |
  | Section 7  (Perf)    | 0 new issues                                 |
  | Section 8  (Observ)  | 0 gaps                                       |
  | Section 9  (Deploy)  | 1 CI divergence risk                         |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 3           |
  | Section 11 (Design)  | SKIPPED (no UI scope)                         |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (no additions/cuts)                  |
  | What already exists  | written                                      |
  | Dream state delta    | written                                      |
  | Error/rescue registry| 7 rows, 0 critical gaps                       |
  | Failure modes        | 7 total, 0 critical gaps                      |
  | TODOS.md updates     | 0 items proposed                             |
  | Scope proposals      | 0 proposed, 0 accepted                       |
  | CEO plan             | consolidated in this plan                   |
  | Outside voice        | disabled; no completed external review       |
  | Lake Score           | N/A — no new 0D coverage choices             |
  | Diagrams produced    | 3 (architecture, data flow, dream state)     |
  | Stale diagrams found | 0                                          |
  | Unresolved decisions | 0 user decisions; T1–T4 implementation gates |
  | Reality rows         | 11/11 rows, 0 unverified                     |
  +====================================================================+
```

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 2 | ISSUES OPEN | HOLD_SCOPE, 3 P1 implementation gaps carried; no scope changes |
| Outside Review | Codex plan review | Independent 2nd opinion | 1 prior | unavailable | Timeout; no completed external review |
| Eng Review | `/autoplan` | Architecture & tests (required) | 0 | not run | Eng review required |
| Design Review | `/plan-design-review` | UI/UX gaps | skipped | skipped | no_ui_scope; full Issue/SPEC excludes presentation changes |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | not invoked by requested skill |

- **OUTSIDE COVERAGE:** Codex plan review was disabled in the current configuration; the prior recorded attempt timed out. No completed external review is claimed.
- **VERDICT:** CEO review complete with issues open; engineering review required before implementation. Design review is skipped with `no_ui_scope`.
- **UNRESOLVED DECISIONS:**
- No user-originated material decisions remain. Implementation conditions remain: complete T1 machine-readable inventory, T2 whole-runtime coverage/unloaded-file proof, T3 controlled interactive raw-stream parity harness, and T4 shared CI/release validation contract. These are concrete verification tasks, not approvals.

<!-- KFLOW_REVIEW_COMPLETION_BEGIN -->

```json
{
  "issueUrl": "https://github.com/NegiKirin/repo-pattern/issues/97",
  "specArchivePath": "/home/kirin/Code/my-hobby/repo-pattern/.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/specs/20261111-issue-97-source-refactor.md",
  "reviews": {
    "ceo": {
      "status": "completed",
      "outcome": "HOLD_SCOPE; no scope additions or cuts; issues remain open",
      "evidence": "Saved plan CEO Review — HOLD SCOPE section, GSTACK REVIEW REPORT, and native review-read record for /plan-ceo-review at baseline 4ee09d3"
    },
    "design": {
      "status": "skipped",
      "reason": "no_ui_scope",
      "evidence": "Issue/SPEC evidence reviewed by Hermes: CLI source refactor, byte-preserving presentation contract, structural UI adapter boundary, and presentation changes explicitly out of scope (SPEC lines 13-15, 103-128, 266-268)"
    }
  },
  "findings": [
    {
      "id": "T1",
      "severity": "high",
      "disposition": "implementation_verification",
      "task": "Produce a machine-readable Phase 0 inventory covering every assertion, failure scenario, lifecycle, dynamic path, package asset, and old-to-new destination before movement",
      "evidence": "CEO Review Section 6 warning; carried task T1 in the saved plan and prior task record 20261111T103220Z-2601117/T1"
    },
    {
      "id": "T2",
      "severity": "high",
      "disposition": "implementation_verification",
      "task": "Prove whole-runtime line, function, and branch coverage, including unloaded src/bin files, at the 80% gate without suppressions",
      "evidence": "CEO Review Section 6 warning; carried task T2 in the saved plan and prior task record 20261111T103220Z-2601117/T2"
    },
    {
      "id": "T3",
      "severity": "high",
      "disposition": "implementation_verification",
      "task": "Define and run a controlled TTY/input/timing harness comparing raw stdout and stderr bytes on Linux and macOS",
      "evidence": "CEO Review Section 4 warning; carried task T3 in the saved plan and prior task record 20261111T103220Z-2601117/T3"
    },
    {
      "id": "T4",
      "severity": "medium",
      "disposition": "implementation_verification",
      "task": "Use one validation contract for PR/main and release CI, including the installed-package smoke test",
      "evidence": "CEO Review Sections 9 and GSTACK REVIEW REPORT; carried task T4 in the saved plan and prior task record 20261111T103220Z-2601117/T4"
    }
  ],
  "unresolvedMaterialDecisions": [],
  "implementationConditions": [
    "Complete T1 before source movement so the old-to-new map and assertion/failure inventory are auditable.",
    "Complete T2 before claiming the coverage acceptance criterion; include unloaded runtime files and line/function/branch thresholds.",
    "Complete T3 before claiming interactive output parity; compare separate raw stdout/stderr bytes under controlled terminal conditions on Linux and macOS.",
    "Complete T4 before CI/release signoff; PR/main and release must invoke the same validation contract.",
    "Restore GitNexus connectivity and run upstream impact before editing each affected symbol; report HIGH/CRITICAL risk before edits.",
    "Run detect_changes() before any separately authorized commit."
  ],
  "scopeChangedAfterReview": false
}
```

<!-- KFLOW_REVIEW_COMPLETION_END -->
