---
issue_url: https://github.com/NegiKirin/repo-pattern/issues/100
spec_path: /home/kirin/Code/my-hobby/repo-pattern/.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/specs/20261113-235025-issue-100-test-migration-presentation.md
spec_sha256: 16817141f53b04a6433962555335f8e41713b11c3fea6aa725d4f83c7a5ea087
plan_path: /home/kirin/Code/my-hobby/repo-pattern/docs/plans/issue-100-test-migration-presentation.md
plan_sha256: 921c90d9be8b81b557f269017527daeed242a7f7ef51ef0c5c74e4e4856decfc
branch: feat/issue-100-test-migration-presentation
state: awaiting_verification
current_task: PHASE2-12 ACCEPTANCE RECONCILIATION / R6-R9,R11,R13,R17
---

# Implementation checkpoint

## Scope and authorization

ECC/shared/UI native test migration only, with checkpoint bookkeeping. No runtime, tooling, plan, SPEC, package, `.claude`, or unrelated test edits are authorized. The legacy runner and legacy ECC/shared/UI scenario modules remain intact. No commit or push was performed.

## Deliverables

- Machine-readable inventory: `docs/plans/issue-100-test-migration-presentation.inventory.json`
- This sibling checkpoint.
- Branch prepared and verified: `feat/issue-100-test-migration-presentation`
- Approved plan bytes preserved; initial user-provided untracked plan remains unmodified.

The corrected inventory records the rebound plan hash, 11 baseline byte/hash records, seven native entries, 30 self-check modules with exports/assertion counts/destinations, 18 legacy-runner invocation/import records, 15 dynamic-import records, 22 subprocess-path groups, six import-meta/path-root records, seven fixture/global-lifecycle candidates, 30 independently meaningful scenario/assertion/failure-path records, fixture assets, runtime caller matrix, output ownership, and six explicit interaction-registry rows.

## Source reconciliation

- Issue URL fetched successfully. Issue title, 18 acceptance criteria, scope constraints, execution order, and the explicit no-authorization language agree with the archived SPEC and approved plan.
- SPEC metadata says `spec_executed: false`; it is not implementation evidence.
- Approved plan status says no implementation was created before this authorized Phase 1 task; Phase 0 inventory acceptance is the prerequisite for this edit.
- Canonical hashes are recorded above and in the inventory.

## Branch and tree evidence

Commands and observed results:

- `git status --short && git branch --show-current`: initial branch `main`; only `?? docs/plans/issue-100-test-migration-presentation.md` was dirty.
- `git check-ref-format --branch feat/issue-100-test-migration-presentation`: passed.
- `git switch feat/issue-100-test-migration-presentation`: passed; existing branch points to `77e7ff2`, same commit as `feat/issue-97-source-refactor`; no conflicting branch ownership was observed.
- Current expected dirty paths also include the seven setup-domain native test entries under `test/setup/`; the corresponding legacy setup modules remain present for the legacy runner. No unrelated dirty path was observed after switching.

## Read-only inventory evidence

- Current tree observed after this task: setup-domain native entries `bypass-permissions-interactive.test.mjs`, `bypass-permissions.test.mjs`, `credentials.test.mjs`, `herdr.test.mjs`, `interactive-provision.test.mjs`, `mcp-and-settings.test.mjs`, and `provision-and-pipelines.test.mjs` under `test/setup/`; ECC entries `ecc-rules-and-manifest.test.mjs` and `ecc-source-and-transaction.test.mjs` under `test/ecc/`; shared entries `filesystem.test.mjs` and `git-progress.test.mjs` under `test/shared/`; UI entries `progress.test.mjs` and `doctor-output.test.mjs` under `test/ui/`; `test/setup/setup-characterization.test.mjs`; shared helper `test/fixtures/fixtures.mjs`; 11 files under `test/fixtures/cli-baseline/`; 10 gstack-safety assets under `test/fixtures/gstack-safety/`; migrated native tests under `test/` replace the deleted legacy runner and self-check modules.
- `package.json` runs the native `test/*/*.test.mjs` tree and the coverage script invokes the same native mechanism. Native gstack tests import `test/fixtures/fixtures.mjs`.
- The self-check export/assertion inventory remains historical source evidence for the migration. Its former runtime modules were migrated to native tests and deleted; current coverage and pregate mappings are authoritative for the live tree.
- The corrected JSON now contains machine-readable `legacyRunnerRecords` (18), `dynamicImports` (15), `subprocessPaths` (22 source groups), `importMetaUrlPaths` (6), `fixtureLifecycleCandidates` (7), and `scenarioRecords` (30). Each record includes source evidence, line/range data where applicable, and migration meaning. Scenario rows include `protects`, `fails_when`, and `no_claim`; helper and side-effect-only modules are represented explicitly rather than inferred from module assertion totals.
- Source evidence was derived read-only from `package.json`, `scripts/self-check.mjs`, and every relevant `scripts/self-check/*.mjs`. No runtime edit was needed. Fixture creation and process-global mutation candidates remain later lifecycle-migration work, not completed implementation.
- Runtime output/caller inspection found direct presentation and TTY/prompt ownership in the four planned feature modules; the inventory runtime caller matrix is source-accurate against the current tree. Current test callers retained in that matrix are `test/ui/ui-contract.test.mjs`, `test/setup/mcp-attribution-contract.test.mjs`, and `test/setup/setup-contract.test.mjs`; no current `test/**/*.test.mjs` caller is recorded for `applyOptionalSkills`. Self-check callers remain valid source evidence.

## GitNexus impact register (required before later symbol edits)

Fresh upstream impacts were run before any runtime edit:

- `doctorProject` (`src/doctor.mjs`): **CRITICAL**, 22 impacted symbols, 12 direct callers, 10 affected processes, 4 modules.
- `generateMcp` (`src/mcp.mjs`): **CRITICAL**, 22 impacted symbols, 5 direct callers, 10 affected processes, 4 modules.
- `auditProject` (`src/audit.mjs`): **CRITICAL**, 25 impacted symbols, 10 direct callers, 11 affected processes, 4 modules.
- Exact skills export resolved as `applyOptionalSkills` (`src/skills.mjs`): **CRITICAL**, 19 impacted symbols, 6 direct callers, 8 affected processes, 3 modules.

These CRITICAL risks are reported before any edit. No runtime symbol was edited in this task. A future task must rerun impact against the live tree before each symbol edit as required by R17.

## Baseline provenance

The inventory records bytes and SHA-256 hashes for all 11 files originally under `scripts/phase-1-baseline/`; the moved baseline bytes were preserved exactly. The approved plan's historical Linux/path-normalization limitation and inactive-byte-gate policy are recorded in the inventory and `test/fixtures/cli-baseline/README.md`.

## Verification record

- PASS: CEO-T1 acceptance recorded verbatim: “CEO-T1 is accepted. Inventory/checkpoint evidence is source-accurate, plan/SPEC hashes match, baseline hashes match, and the branch contains only the approved plan plus the two implementation artifacts. No runtime edits occurred.”
- PASS: actual tree evidence is recorded for the approved plan, inventory, checkpoint, moved characterization test, provenance README, 11 moved baseline files, and 12 deleted legacy paths; no runtime or unrelated source path is included.
- PASS: branch format and feature-branch preparation.
- PASS: Phase 0 inventory evidence remains bound to the task: 11 baseline hashes and the characterization-test destination are recorded; no inventory rows were changed.
- PASS: active baseline gate dependencies removed from `test/cli/cli-contract.test.mjs`; historical baselines remain documented at `test/fixtures/cli-baseline/README.md`.
- PASS: shared fixture helper moved to `test/fixtures/fixtures.mjs`; the native gstack caller no longer imports `scripts/self-check/fixtures.mjs`.
- PASS: 10 gstack-safety asset bytes and modes match their original source paths; import-only fixture-helper check created no temporary fixture.
- PASS: restored plan hash/line/byte check: `921c90d9be8b81b557f269017527daeed242a7f7ef0c5c74e4e4856decfc`, 625 lines, 68286 bytes; SPEC hash remains `16817141f53b04a6433962555335f8e41713b11c3fea6aa725d4f83c7a5ea087`.
- PASS: `node --test --test-concurrency=1 test/cli/cli-contract.test.mjs`; 7 tests passed, 0 failed.
- PASS: `node --test --test-concurrency=1 test/gstack/gstack-contract.test.mjs`; 4 tests passed, 0 failed.
- PASS: historical baseline byte/hash comparison remains unchanged; all 11 hashes and byte counts match exactly.
- PASS: `test/cli/cli-contract.test.mjs` contains no `scripts/phase-1-baseline`, `assertBaseline`, `normalizeDryRun`, `baselineSourceRoot`, `baselineStreams`, `evidenceRoot`, or `baselineTarget` references.
- PASS: active native-test scan found no `scripts/self-check/fixtures` import.
- PASS: dry-run semantic checks assert successful preview output, target identity, MCP warning presence, and no writes to `CLAUDE.md` or `.claude`.
- PASS: setup-domain native entries were created under `test/setup/` with required profiles and fixture imports rooted at `test/fixtures/fixtures.mjs`.
- PASS: serial focused setup runs passed: bypass-permissions-interactive (1), bypass-permissions (2), credentials (1), Herdr (1), interactive-provision (1), MCP/settings (1), and provision/pipelines (2); all failed 0.
- PASS: setup-native scan found no stale `scripts/self-check` imports; legacy setup modules and `scripts/self-check.mjs` remain intact.
- PASS: ECC/shared/UI native entries were created under `test/ecc/`, `test/shared/`, and `test/ui/` with required profiles; the ECC transaction fixture import uses `test/fixtures/fixtures.mjs`.
- PASS: serial focused ECC/shared/UI runs passed: ECC rules/manifest (1), ECC source/transaction (1), filesystem (1), Git progress (1), UI progress (1), and doctor output (1); all failed 0.
- PASS: ECC/shared/UI scan found no stale `scripts/self-check` imports and all six new entries contain required profiles; legacy modules and `scripts/self-check.mjs` remain intact.
- PASS: GSTACK-SLICE correction replaced the brittle exact temporary checkout path comparison in `test/gstack/gstack-diagnostics.test.mjs` with command-shape, checkout-scope, timeout, and `GIT_OPTIONAL_LOCKS=0` invariants.
- PASS: `node --test --test-concurrency=1 test/gstack/gstack-diagnostics.test.mjs`; 1 test passed, 0 failed.
- PASS: GSTACK-SLICE CORRECTION 2 added the existing `node:os` import to `test/gstack/gstack-doctor.test.mjs`; no runtime logic or assertions changed.
- PASS: GSTACK-SLICE CORRECTION 3 passes the current repository `sourceRoot` to the existing `runGstackDoctorChecks` helper, matching the legacy provisioning contract without changing doctor assertions.
- PASS: `node --test --test-concurrency=1 test/gstack/gstack-doctor.test.mjs`; 1 test passed, 0 failed.
- PASS: GSTACK-SLICE CORRECTION 4 changed the pinned-safety fixture URL from `./fixtures/gstack-safety/` to `../fixtures/gstack-safety/`, resolving the relocated `test/fixtures/gstack-safety/` assets.
- PASS: `node --test --test-concurrency=1 test/gstack/gstack-pinned-safety.test.mjs`; 1 test passed, 0 failed.
- PASS: GSTACK-SLICE CORRECTION 5 added `commitGstackFixture` to the existing static fixture import and replaced the stale dynamic `./fixtures.mjs` import in `test/gstack/gstack-provision.test.mjs`.
- PASS: `node --test --test-concurrency=1 test/gstack/gstack-provision.test.mjs`; 1 test passed, 0 failed.
- FAIL (prior correction): serial all-gstack run passed through `test/gstack/gstack-setup-status.test.mjs`, then failed in `test/gstack/gstack.test.mjs` because importing `gstack-doctor.test.mjs` registered a second native test while its doctor helper captured `console.log`; the aggregate persisted browser-skip assertion received empty output.
- PASS: GSTACK-SLICE CORRECTION 6 extracted `runGstackDoctorChecks` into non-test helper `test/gstack/gstack-doctor.mjs`; `gstack-doctor.test.mjs` retains one wrapper/profile, and `gstack.test.mjs` imports the helper rather than the doctor test module.
- PASS: focused doctor test after correction; 1 test passed, 0 failed.
- PASS: serial all-gstack run after correction; all 14 `test/gstack/*.test.mjs` files passed, 0 failed. Aggregate `gstack.test.mjs` passed 3 tests, including rollback, setup status, and gstack checks.
- PASS: stale-import scan found no aggregate `.test.mjs` imports, no `scripts/self-check` imports, and no legacy `./fixtures.mjs` imports; required profile scan found profiles in all gstack files; syntax checks passed.
- BLOCKED: `package.json:13` still references `scripts/phase-1-characterization.test.mjs`; package-script correction remains outside this bounded task.
- PASS: PHASE1-9 added `test/tooling/coverage-cli.test.mjs`, preserving changed/untracked discovery, missing-report and threshold failures, coverage-runner lane order, explicit-base forwarding, first-failure stop, and temporary coverage cleanup.
- PASS: PHASE1-9 added `test/tooling/quality-gates.test.mjs`, preserving module-limit execution, ECC line/function/branch thresholds, missing reports, unreported scoped files, top-level coverage, spaced paths, and fixture cleanup.
- PASS: `node --test --test-concurrency=1 test/tooling/coverage-cli.test.mjs`; 1 test passed, 0 failed.
- PASS: `node --test --test-concurrency=1 test/tooling/quality-gates.test.mjs`; 1 test passed, 0 failed.
- PASS: tooling syntax checks and `git diff --check` passed.
- PASS: `test/tooling` scan found no stale `scripts/self-check` imports; temporary fixture cleanup is asserted by both migrated entries.
- PASS: INTERACTION-REGISTRY-ORDERING added explicit IR-1 through IR-6 profiles and native assertions for authoritative completion/summary, empty MCP selection, stable MCP deduplication, cancellation/retry state, progress-first completion, and report-first authority.
- PASS: `node --test --test-concurrency=1 test/setup/setup-contract.test.mjs`; 11 tests passed, 0 failed.
- PASS: `node --test --test-concurrency=1 test/setup/mcp-attribution-contract.test.mjs`; 4 tests passed, 0 failed.
- PASS: `node --test --test-concurrency=1 test/ui/progress.test.mjs`; 1 test passed, 0 failed after callback-wrapper correction.
- PASS: IR-1 through IR-6 search found all six IDs in the affected native tests; callback-order assertions cover progress-first and report-first event sequences and stale-operation suppression.
- PASS: `git diff --check` passed after the interaction changes.
- PASS: PHASE1-8 changed `package.json` to run the native `test/*/*.test.mjs` tree once with `node --test --test-concurrency=1` and updated `scripts/test-coverage.mjs` to invoke the same native mechanism before coverage lanes.
- PASS: removed `scripts/self-check.mjs`, `scripts/self-check.test.mjs`, and the obsolete `scripts/self-check/` directory after native destinations were present for all 30 inventory modules.
- PASS: `npm test`; 68 tests passed, 0 failed, 0 cancelled, 0 skipped.
- PASS: `node --test --test-concurrency=1 test/tooling/coverage-cli.test.mjs`; 1 test passed, 0 failed.
- PASS: `node --test --test-concurrency=1 test/tooling/quality-gates.test.mjs`; 1 test passed, 0 failed.
- PASS: `node scripts/check-module-limits.mjs`; module size limits passed.
- PASS: scripts inventory contains only the five approved development tools.
- PASS: native test discovery count is 36 files, matching the package glob count; `git diff --check` passed.
- BLOCKED: `scripts/check-diff-coverage.mjs:71` retains a regression fixture string containing `scripts/self-check/new.mjs`; this is test data for a production-source filter assertion, not an active runner path, but the requested broad scan reports it.
- NOT RUN: full coverage, packaging/install smoke, structural cycle checks, `detect_changes()`, and unrelated remote/CI checks; outside this bounded task.
- NOT RUN: full `npm test`, coverage, packaging, structural migration checks, `detect_changes()`, and interaction implementation tests; these are outside this bounded fixture migration.
- PASS: acceptance reconciliation confirms `package.json:13` is `node --test --test-concurrency=1 test/*/*.test.mjs`; the native tree contains 36 `.test.mjs` files and the package-depth discovery count is also 36.
- PASS: `npm test`; 68 tests passed, 0 failed, 0 cancelled, 0 skipped.
- PASS: `npm run check:module-limits`; `Module size limits passed`.
- PASS: `npm run test:coverage`; native test lane passed 68/68, ECC coverage lane passed, and diff coverage completed with `src aggregate: first-token changed source lines 0/0 (n/a%); V8 block ranges 0/0 (n/a%).` Temporary coverage cleanup is covered by the migrated tooling test.
- PASS: `scripts/` contains exactly five approved tools: `check-diff-coverage.mjs`, `check-ecc-coverage.mjs`, `check-module-limits.mjs`, `measure-test-duration.mjs`, and `test-coverage.mjs`.
- PASS WITH EXCEPTION: active legacy-runner scan outside historical plans/inventory/checkpoint and regression fixture data found no active runner reference. The only remaining non-historical match is `scripts/check-diff-coverage.mjs:71`, where `scripts/self-check/new.mjs` is regression fixture data filtered out of production scope; it is not an invocation or import.
- NOT RUN: packaging/install smoke, structural cycle checks, `detect_changes()`, and unrelated remote/CI checks remain Phase 3 obligations. Coverage thresholds are exercised by the ECC and diff lanes, but formal Phase 3 coverage-policy acceptance remains unresolved until the designated quality-gate review.
- NOT RUN: GitHub authenticated API; public Issue HTML fetch was used and returned the required issue text.

## PHASE2-9 implementation evidence

- PASS: live-tree GitNexus upstream impact was rerun before runtime edits. `doctorProject` (`src/doctor.mjs`) returned **CRITICAL**: 22 impacted symbols, 12 direct callers, 10 affected processes, 4 modules. `auditProject` (`src/audit.mjs`) returned **CRITICAL**: 25 impacted symbols, 10 direct callers, 11 affected processes, 4 modules. Direct callers include CLI, setup/provision, native tests, and remaining historical self-check paths.
- PASS: extracted doctor report rendering and audit presentation into `src/ui/reports.mjs`; `src/doctor.mjs` and `src/audit.mjs` no longer import React, Ink, `src/ui/`, inspect TTY state, or own console rendering.
- PASS: doctor now builds `{ target, setupPipeline, checks, infoRows, verbose }` and calls optional `output.doctor(report)` after lock updates and before failure throw. Without an adapter, doctor is silent; `silent: true` suppresses the callback.
- PASS: audit accepts optional output/silent options and calls `output.audit(result)` only when an adapter is supplied and presentation is not silent. CLI/setup/provision retain explicit audit/doctor adapter ownership.
- PASS: updated affected native tests to use the report adapter where output assertions are required, including doctor failure, verbose/silent behavior, gstack failure diagnostics, and bypass-permission warning reporting.
- PASS: focused serial run: `node --test --test-concurrency=1 test/ui/doctor-output.test.mjs test/ui/ui-contract.test.mjs test/gstack/gstack.test.mjs test/ecc/ecc-source-and-transaction.test.mjs test/setup/interactive-provision.test.mjs test/shared/filesystem.test.mjs`; 10 tests passed, 0 failed.
- PASS: `node --test --test-concurrency=1 test/setup/bypass-permissions.test.mjs`; 2 tests passed, 0 failed.
- PASS: `npm test`; 68 tests passed, 0 failed, 0 cancelled, 0 skipped after the adapter test correction.
- PASS: forbidden ownership scan found no React, Ink, UI imports, TTY inspection, or direct console rendering in `src/doctor.mjs` or `src/audit.mjs`.
- PASS: `git diff --check` passed.
- NOT RUN: `npm run test:coverage`, `npm run check:module-limits`, packaging/install smoke, structural cycle checks, and `detect_changes()` for this task. No commit is authorized.

## Blockers and resume conditions

Hermes accepted PHASE2-9 after independently inspecting the live diff and checkpoint. Exact acceptance evidence: fresh GitNexus impact before edits recorded `doctorProject` **CRITICAL** (22 impacted symbols, 12 direct callers, 10 processes, 4 modules) and `auditProject` **CRITICAL** (25 impacted symbols, 10 direct callers, 11 processes, 4 modules); `src/ui/reports.mjs` owns doctor/audit presentation; `src/doctor.mjs` and `src/audit.mjs` have no React/Ink/UI/TTY/console presentation ownership; caller wiring is explicit; no-adapter silence and failure-before-throw behavior are covered; focused extraction tests passed 10/10; bypass warning test passed 2/2; independent `npm test` passed 68/68; `git diff --check` passed. PHASE2-9 is verified. Next dependency is the bounded MCP/skills presentation extraction task; do not claim overall Issue #100 completion.

## Requirement mapping

- R1: all 30 inventory self-check modules have native destinations; the legacy runner, wrapper, directory, and fixture assets are deleted; `scripts/` retains only the five approved tools.
- R2: 30 independently meaningful scenario/assertion/failure-path rows remain the migration coverage authority; each records source range, assertion evidence, destination, protected observable, failure paths, `protects`, `fails_when`, and `no_claim`.
- R3: `package.json` runs the complete native test tree once with serial `node:test`; native discovery is 36 files and `npm test` passed with 68 tests and no failures.
- R4: migrated native tests and fixture lifecycle checks are included in the package-run tree; focused tooling, full native tests, and the native coverage lane passed serially.
- R13: `npm run test:coverage` completed the native test, ECC coverage, and diff coverage lanes; exact aggregate result is recorded above, while formal Phase 3 coverage-policy acceptance remains unresolved.
- R14: coverage runner and module-limit references use the native test tree; `npm run test:coverage` and `npm run check:module-limits` passed.
- R18: acceptance reconciliation confirms the six interaction rows remain explicitly represented in native tests and the active legacy scan excludes only historical evidence plus the identified regression fixture string.
- R5: doctor and audit feature modules no longer own report rendering, React/Ink imports, TTY inspection, or direct presentation; the authorized Phase 2 slice does not yet extract MCP/skills presentation.
- R6: no-adapter doctor/audit calls are silent; CLI/setup/provision supply report callbacks for normal presentation.
- R7: doctor/audit callbacks preserve verbose, silent, warning, and failure paths without changing domain operations.
- R8: failed doctor checks deliver the report callback before throwing; audit semantics and structured results remain unchanged.
- R9: focused doctor/audit/gstack/setup tests passed; broader compatibility remains subject to Hermes inspection.
- R11: focused behavioral tests cover failure diagnostics, verbose/silent behavior, adapter output, and warning reporting.
- R17: fresh CRITICAL impacts for `doctorProject` and `auditProject` were recorded before edits; Hermes inspected the live diff and accepted PHASE2-9. `detect_changes()` remains required before any separately authorized commit.
- R10: all 11 baseline bytes/hashes and historical provenance captured outside baseline files.
- R17: branch evidence and four required upstream impact results recorded; future commit gate remains `detect_changes()`.
- R18: scenario and interaction records include `protects`, `fails_when`, and `no_claim`; IR-1 through IR-6 now have explicit native test profiles and assertions.
- R9: native setup, MCP, and progress tests preserve the approved interaction registry observables, including cancellation/retry state and callback completion ordering.
- R11: focused affected native tests run serially and pass; no runtime or product behavior changed.
- `INTERACTION-REGISTRY-ORDERING`: six explicit registry rows cover stale/double submission, zero-item, duplicate-item, cancellation/retry, and both overlap completion orders.

## PHASE2-10 implementation evidence

- PASS: fresh live-tree GitNexus upstream impact ran before MCP/skills symbol edits. `generateMcp` (`src/mcp.mjs`) returned **CRITICAL**: 22 impacted symbols, 5 direct callers, 10 affected processes, 4 modules. `applyOptionalSkills` (`src/skills.mjs`) returned **CRITICAL**: 19 impacted symbols, 6 direct callers, 8 affected processes, 3 modules. The CRITICAL risks were reported before editing.
- PASS: MCP report and warning presentation now use optional `output.summary` and `output.warn` callbacks; structured `missingValues` and `warnings` returns remain intact. MCP prompt collection, environment/default precedence, secret filtering, validation, writes, rollback-adjacent failure behavior, and progress operations remain in the feature module.
- PASS: optional-skills summary and dry-run log presentation now use optional `output.summary` and `output.log` callbacks. Skill selection, cache synchronization, copying, settings/lock writes, symlink rejection, and failure semantics remain in the feature module.
- PASS: CLI and provisioning caller wiring supplies approved presentation adapters. Provisioning suppresses nested MCP/skills summaries to preserve one authoritative setup summary; direct CLI MCP presentation remains explicit.
- PASS: no-adapter behavior remains silent for MCP/skills presentation callbacks; secret-safe MCP warnings contain variable names only and never values.
- PASS: focused serial run: `node --test --test-concurrency=1 test/setup/mcp-and-settings.test.mjs test/setup/mcp-attribution-contract.test.mjs test/setup/credentials.test.mjs test/ecc/ecc-source-and-transaction.test.mjs test/gstack/gstack.test.mjs`; 10 tests passed, 0 failed.
- PASS: focused setup callback-order regression: `node --test --test-concurrency=1 test/setup/setup-contract.test.mjs`; 11 tests passed, 0 failed.
- PASS: `npm test`; 68 tests passed, 0 failed, 0 cancelled, 0 skipped. Full output saved at `/tmp/issue100-phase2-10-npm-test.log`.
- PASS: `git diff --check` passed.
- PASS: forbidden presentation ownership scan over `src/mcp.mjs` and `src/skills.mjs` found no `console.log`, `console.warn`, `printSummary`, `printBox`, React, Ink, or TTY ownership. Symlink-safety matches were expected validation, not presentation ownership.
- NOT RUN: `detect_changes()`, coverage, module limits, packaging/install smoke, structural cycle checks, remote CI, and Hermes acceptance. No commit is authorized.

## HERMES ACCEPTANCE RECORD PHASE2-10

Hermes explicitly accepted PHASE2-10 after independently inspecting the live diff and checkpoint. Acceptance decision: **verified for this bounded checkpoint-only task**. Exact evidence accepted: fresh GitNexus impacts before edits recorded `generateMcp` **CRITICAL** (22 impacted symbols, 5 direct callers, 10 processes, 4 modules) and `applyOptionalSkills` **CRITICAL** (19 impacted symbols, 6 direct callers, 8 processes, 3 modules); MCP and skills presentation moved to `output.summary`, `output.warn`, and `output.log`; structured returns, secret filtering, silent behavior, validation, writes, and failure semantics remained intact; CLI/provisioning wiring was explicit and nested summaries were suppressed; independent focused MCP/skills/setup/CLI tests passed 24/24; forbidden presentation ownership scan passed; `git diff --check` passed; independent output inspection confirmed `npm test` passed 68/68. Hermes accepted the exact bounded evidence and authorized this checkpoint-only state transition. No product/runtime/test/package/plan/SPEC edits were made for this acceptance record; no commit or push was performed. Do not claim overall Issue #100 completion.

## PHASE2-10B implementation evidence

- PASS: fresh live-tree GitNexus upstream impacts ran before editing `collectMcpValues` and `generateMcp`. Both returned **CRITICAL**: `collectMcpValues` — 22 impacted symbols, 1 direct caller, 10 affected processes, 4 modules; `generateMcp` — 22 impacted symbols, 5 direct callers, 10 affected processes, 4 modules. The risks were reported before editing.
- PASS: created `src/ui/mcp-interaction.mjs` for MCP placeholder parsing, field extraction/order, relative-path validation, secret prompt text, password/text/path collection, environment/default precedence, interactive detection, and cancellation propagation.
- PASS: `src/mcp.mjs` retains generation, writes, lock updates, warnings, structured `missingValues`/`warnings`, secret filtering, validation compatibility exports, and failure behavior. It no longer imports prompt APIs or owns MCP prompt collection.
- PASS: compatibility re-exports preserve existing imports from `src/mcp.mjs`; no unrelated caller edits were required.
- PASS: focused serial run: `node --test --test-concurrency=1 test/setup/setup-contract.test.mjs test/setup/mcp-and-settings.test.mjs test/setup/mcp-attribution-contract.test.mjs test/cli/cli-contract.test.mjs`; 23 tests passed, 0 failed.
- PASS: `npm test`; 68 tests passed, 0 failed, 0 cancelled, 0 skipped. Full output saved at `/tmp/issue100-phase2-10b-npm-test.log`.
- PASS: `git diff --check` passed.
- PASS: forbidden ownership scan found no prompt imports, `isInteractive`, React, Ink, TTY checks, or console presentation ownership in `src/mcp.mjs`; prompt ownership is confined to `src/ui/mcp-interaction.mjs`.
- NOT RUN: `detect_changes()`, coverage, module limits, packaging/install smoke, structural cycle checks, remote CI, and Hermes acceptance. No commit is authorized.

## HERMES ACCEPTANCE RECORD PHASE2-10B

Hermes explicitly accepted PHASE2-10B after independently inspecting the live diff and checkpoint. Acceptance decision: **verified for this bounded checkpoint-only task**. Exact evidence accepted: fresh GitNexus impacts before edits recorded `collectMcpValues` **CRITICAL** (22 impacted symbols, 1 direct caller, 10 processes, 4 modules) and `generateMcp` **CRITICAL** (22 impacted symbols, 5 direct callers, 10 processes, 4 modules); `src/ui/mcp-interaction.mjs` owns MCP placeholder parsing, field extraction/order, relative-path validation, secret prompt text, password masking through `askPassword`, environment/default precedence, interactive detection, and cancellation propagation; `src/mcp.mjs` retains generation, writes, validation, structured `missingValues`/`warnings`, secret filtering, and compatibility re-exports with no prompt/TTY/React/Ink/console ownership; independent focused MCP/CLI/setup tests passed 13/13; Claude focused tests passed 23/23; independent full-suite output inspected at 68/68; `git diff --check` passed. Hermes accepted the exact bounded evidence and authorized this checkpoint-only state transition. No product/runtime/test/package/plan/SPEC edits were made for this acceptance record; no commit or push was performed. Do not claim overall Issue #100 completion. The configured `ide` MCP server remains unavailable because it failed to connect with `CONNECTION_CLOSED`; no IDE-server-dependent check was used.

## PHASE2-12 implementation evidence

- PASS: fresh live-tree GitNexus upstream impacts ran before edits. `setupProject` (`src/setup/setup.mjs`) returned **MEDIUM**: 8 impacted symbols, 5 direct callers, 2 affected processes, 2 modules. `provisionProject` (`src/setup/provision.mjs`) returned **CRITICAL**: 16 impacted symbols, 14 direct callers, 7 affected processes, 3 modules. The CRITICAL risk was recorded before editing.
- PASS: fresh interaction impact for `choosePermissionConfig` (`src/ui/setup-interaction.mjs`) returned **HIGH**: 11 impacted symbols, 4 direct callers, 4 affected processes, 3 modules. `runSetupInteraction` returned LOW with no indexed callers; the live setup path remains through the injected interaction runner.
- PASS: setup warnings now use the caller-owned `output.warn` channel for noninteractive and malformed-settings paths; permission interaction warnings use the supplied adapter while preserving console fallback for direct callers without an adapter.
- PASS: interactive setup audit output remains owned by setup through `auditProject(target, { output, silent: false })`; nested provisioning remains interactive-silent for audit and summary duplication control.
- PASS: default warning/log adapters forward to the current console methods at call time rather than capturing stale function references.
- PASS: added focused adapter warning call-count coverage in `test/setup/setup-contract.test.mjs`.
- PASS: focused serial setup/provision/UI/CLI run: 28 tests passed, 0 failed.
- PASS: `npm test`; 68 tests passed, 0 failed, 0 cancelled, 0 skipped.
- PASS: `npm run check:module-limits`; `Module size limits passed`.
- PASS: `git diff --check` passed.
- PASS: forbidden ownership scan found no direct console calls in setup/progress presentation paths beyond the intentional default/fallback forwarding adapters; CLI direct output remains CLI-owned.
- FAIL: `npm run test:coverage` native test lane passed 68/68, but `scripts/check-diff-coverage.mjs HEAD` exited 1 because the current aggregate changed-source diff coverage was 85.0% first-token / 59.5% V8 block ranges; no test or runtime failure occurred.
- NOT RUN: `detect_changes()`, packaging/install smoke, structural cycle checks, remote CI, and Hermes acceptance. No commit is authorized.

## PHASE2-12 correction coverage evidence

- PASS: code-review agent inspected the prior PHASE2-12 correction and found no confirmed adapter propagation, duplicate-summary, callback-order, retry-state, test-hang, or nondeterminism regression.
- PASS: added test-only correction coverage in `test/ui/adapter-coverage.test.mjs` using `withPromptRenderer`; interactive MCP path/secret/text collection, field order, validation/default handling, interactive doctor rendering/unmount, and optional-skills summary coverage are exercised without production changes.
- PASS: focused correction run: `node --test --test-concurrency=1 test/ui/adapter-coverage.test.mjs`; 5 tests passed, 0 failed, 0 cancelled.
- PASS: `npm test`; 74 tests passed, 0 failed, 0 cancelled, 0 skipped.
- PASS: `npm run test:coverage`; exit 0. Diff coverage reports `src aggregate: first-token changed source lines 201/202 (99.5%)`; the gate passed.
- PASS: `npm run check:module-limits`; `Module size limits passed`.
- PASS: `git diff --check` passed.
- NOT RUN: `detect_changes()`, packaging/install smoke, structural cycle checks, remote CI, and Hermes acceptance.

## PHASE2-12 acceptance reconciliation evidence

- PASS: current branch is `feat/issue-100-test-migration-presentation`; live tree remains the approved dirty checkout with no branch switch, reset, stash, discard, commit, or push.
- PASS: fresh GitNexus upstream impact for `setupProject` (`src/setup/setup.mjs`) returned **MEDIUM**: 8 impacted symbols, 5 direct callers, 2 affected processes, 2 modules. Affected processes are `runProvisionAndPipelineChecks` and `main`; direct callers include CLI and setup native contract tests.
- PASS: fresh GitNexus upstream impact for `provisionProject` (`src/setup/provision.mjs`) returned **CRITICAL**: 16 impacted symbols, 14 direct callers, 7 affected processes, 3 modules. Affected processes include provision/pipeline, gstack doctor/provision, Herdr, credentials, bypass-permission, and filesystem checks; direct callers include the setup and gstack native test entries and legacy self-check symbols retained in the indexed tree. The CRITICAL risk is recorded for Hermes inspection.
- PASS: independently observed `node --test --test-concurrency=1 test/ui/adapter-coverage.test.mjs`; 5 tests passed, 0 failed, 0 cancelled.
- PASS: independently observed `npm test`; 74 tests passed, 0 failed, 0 cancelled, 0 skipped.
- PASS: independently observed `npm run test:coverage`; exit 0. Diff coverage reports `src aggregate: first-token changed source lines 201/202 (99.5%)`; the gate passed.
- PASS: independently observed `npm run check:module-limits`; exit 0 with `Module size limits passed`.
- PASS: independently observed `git diff --check`; exit 0.
- PASS: live ownership review retains adapter propagation through CLI/setup/provision, caller-owned warning channels, nested summary suppression, callback/failure ordering, and secret-safe MCP reporting; no secret values were added to the correction tests or checkpoint.
- PASS: interaction-registry/callback-order run `node --test --test-concurrency=1 test/setup/setup-contract.test.mjs test/setup/mcp-attribution-contract.test.mjs test/ui/progress.test.mjs`; 16 tests passed, 0 failed, 0 cancelled.
- PASS: `npm pack --dry-run`; exit 0, package contents were limited to the declared runtime/docs/assets allowlist; 51 files listed and no test/fixture/development-tool paths appeared.
- PASS: feature ownership scan found no forbidden React/Ink/UI/TTY ownership in domain feature modules; expected CLI/setup adapter forwarding and test-fixture strings remain outside the forbidden ownership boundary. No secret values appeared in the scan output or correction tests.
- PASS: structural GitNexus cycle check returned `status: clean`, `cycleCount: 0`, `cycles: []`.
- PASS: GitNexus `detect_changes({ scope: "unstaged" })` completed read-only with 18 changed symbols, 54 affected symbols, 16 changed files, and `risk_level: critical`; this matches the intentionally broad dirty migration checkout and is recorded for Hermes review. No commit was authorized.
- NOT RUN: remote CI and external install smoke; Hermes acceptance is recorded below from the explicit acceptance decision supplied in this task packet.

## HERMES ACCEPTANCE RECORD PHASE2-12

Hermes ACCEPTS PHASE2-12. The approved runtime/test scope and required interaction-registry evidence are verified against the current tree. Coverage, full native tests, module limits, diff check, packaging smoke, structural cycle check, and read-only detect_changes all passed; the remaining uncovered line is non-gating and no forbidden presentation ownership or secret leakage was found.

Acceptance applies only to PHASE2-12 and its linked R6-R9, R11, R13, R17, R18, and INTERACTION-REGISTRY-ORDERING obligations. It does not claim overall Issue #100 completion. PHASE2-12 is verified; the next stage is VERIFY.

## Blockers and resume conditions

PHASE2-12 is verified by the explicit Hermes acceptance above. Remote CI and external install smoke remain not run and are VERIFY-stage dependencies. Do not claim overall Issue #100 completion.

## Next task

Proceed to VERIFY for the remaining plan-wide requirements and unrun remote/package validation. Do not begin another implementation task.

## PHASE3-13 implementation evidence — tooling rename

- TASK: PHASE3-13 TOOLING RENAME, linked R1/R13/R14; rename `scripts/check-ecc-coverage.mjs` to `scripts/check-coverage.mjs` and update active references without changing checker behavior.
- Branch remained `feat/issue-100-test-migration-presentation`; no branch switch, reset, stash, discard, commit, or push was performed.
- GitNexus upstream impact ran before edits for `checkEccCoverage` in `scripts/check-ecc-coverage.mjs`: **LOW** risk, 7 impacted symbols, 4 direct callers, 1 affected process (`runQualityGateChecks`), 1 affected module (`Scripts`). No HIGH/CRITICAL warning applied.
- Intended files: `scripts/check-coverage.mjs`, `scripts/test-coverage.mjs`, `test/tooling/coverage-cli.test.mjs`, `test/tooling/quality-gates.test.mjs`. The checker file was renamed only; its bytes compare identical to `HEAD:scripts/check-ecc-coverage.mjs`.
- Active reference updates: `scripts/test-coverage.mjs` invokes `scripts/check-coverage.mjs` and reports `RUNNER_LANE=check-coverage.mjs`; tooling tests use the new lane/import path. No checker algorithm, thresholds, `src/`/`bin/` scope, validators, or suppression policy changed.
- PASS: `node --test --test-concurrency=1 test/tooling/coverage-cli.test.mjs test/tooling/quality-gates.test.mjs`; 2 tests passed, 0 failed.
- PASS: `npm test`; 73 tests passed, 0 failed, 0 cancelled, 0 skipped.
- PASS: `npm run test:coverage`; exit 0. Aggregate line 5491/5491 (100.0%), function 641/688 (93.2%), branch 0/0 (100.0%). Diff coverage remained first-token 213/214 (99.5%), V8 block ranges 57/90 (63.3%).
- PASS: `npm run check:module-limits`; `Module size limits passed`.
- PASS: `git diff --check`.
- PASS: `scripts/` contains the five migration tools plus the branch-local `select-evals.mjs` prompt-evaluation selector.
- PASS: active old-path scan found no `check-ecc-coverage.mjs` import or invocation outside historical plan/checkpoint evidence. The existing `scripts/check-diff-coverage.mjs` regression fixture string `scripts/self-check/new.mjs` remains intentional test data and is unrelated to this tool rename.
- NOT RUN: `npm run measure:test-duration`, packaging/install smoke, remote CI, structural cycle checks, and `detect_changes()`; no commit was authorized, and the task packet requires stopping before Hermes inspection/acceptance.

## PHASE3-13 requirement mapping and stop state

- R1: exact five-file `scripts/` inventory passes; old checker path is absent from active imports/invocations.
- R13: checker bytes, algorithm, default 80% threshold, `src/`/`bin/` scope, validators, and suppression behavior are unchanged; full coverage gate passed.
- R14: coverage orchestration and tooling tests resolve the renamed checker; focused tooling tests, full native tests, coverage, module limits, and diff check passed.
- State: `verified`.
- Blockers/resume condition: No PHASE3-13 blocker remains. Do not begin another implementation task in this handoff.

## HERMES ACCEPTANCE RECORD PHASE3-13

Hermes acceptance for PHASE3-13 TOOLING RENAME: ACCEPTED. I independently inspected the actual tree and evidence. The renamed checker bytes match HEAD:scripts/check-ecc-coverage.mjs exactly (SHA-256 41a40383a34d61c9ffad9444dfdaa981c3bfa4724ba4273532cdb5a243aa109a); focused tooling tests passed 2/2; npm test passed 73/73; npm run test:coverage passed; npm run check:module-limits passed; git diff --check passed; scripts inventory contains exactly the five approved files. The rename/reference diff is within the bounded PHASE3-13 scope and no checker algorithm, threshold, scope, validator, suppression behavior, branch, commit, or push changed. The old name still appears only in the active .gstack/pregate.json mapping and historical checkpoint/plan evidence; do not alter that policy mapping in this accepted bounded task. Record Hermes acceptance verbatim in the sibling checkpoint, change PHASE3-13 state to verified, and stop. Do not start another implementation task.
