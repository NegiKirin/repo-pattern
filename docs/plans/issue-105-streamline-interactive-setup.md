# Implementation Plan: Streamline Interactive Setup

## Status and evidence

- **Draft status:** implementation plan only. CEO and Design reviews are completed and consolidated below; no runtime code, tests, branches, commits, merges, or deployments were changed or run.
- **Issue source:** GitHub issue #105, `Streamline interactive setup: hide initial audit and remove duplicate bypass confirmation`, read with `gh issue view` on 2026-11-24.
- **Canonical specification:** `/home/kirin/Code/my-hobby/repo-pattern/.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/specs/20261124-issue-105-streamline-interactive-setup.md`, read in full. Its requirements match the Issue materially; it repeats the same exact disclosure, safety constraints, test cards, rollback, and out-of-scope boundaries. No material contradiction was found between Issue and archive.
- **Issue/spec provenance:** both state that current behavior was verified by static inspection on 2026-11-24 and that no live terminal run was performed. The plan does not treat those statements as test results.
- **Working tree:** branch `main`; pre-existing unrelated deletions are present:
  - `docs/plans/issue-100-test-migration-presentation.inventory.json`
  - `docs/plans/issue-100-test-migration-presentation.md`
  - `docs/plans/issue-100-test-migration-presentation.md.implementation.md`
  Do not restore, overwrite, or include them in this feature.
- **Verified current implementation:** `setupProject()` calls `auditProject(target, { output, silent: false })` in `src/setup/setup.mjs:172`; `wizardPages()` defines the permission page in `src/ui/setup-wizard.mjs:98`; `choosePermissionConfig()` performs post-wizard confirmation and user-settings writes in `src/ui/setup-interaction.mjs:111-159`; `provisionProject()` independently audits and preserves non-interactive audit output at `src/setup/provision.mjs:238-247`.
- **Impact analysis before planned edits:** GitNexus upstream impact returned LOW for `setupProject` (4 direct callers, 1 affected process), LOW for `choosePermissionConfig` (3 direct callers, 2 affected processes), and LOW for `wizardPages` (2 direct callers, 1 affected process). `auditProject` returned CRITICAL because it is shared by CLI, doctor, provisioning, and tests (10 direct callers, 5 affected processes, 5 modules); therefore the implementation must not alter the audit function globally and must use its existing `silent` option at the interactive caller. No HIGH/CRITICAL symbol is planned for modification.
- **Repository verification:** `package.json:12` runs `node --test --test-concurrency=1 test/*/*.test.mjs`; CI runs `npm test`, module-limit checks, coverage on Node 24, and installed-package smoke. Existing focused commands are listed in the test matrix below.

## 1. Goal and user problem

### Goal

Make interactive `repo-pattern setup` quiet before the wizard and make the wizard's bypass selection the only bypass-consent point, while preserving audit decisions, migration choice, final setup confirmation, safe settings behavior, old-version routing, retries, and existing non-interactive/standalone output.

### Current observed behavior

1. Interactive `setupProject()` audits the target with `silent: false`, so the initial Audit box can show target/state/issues before the wizard.
2. The wizard permission page already has version-sensitive notes, but its current supported-version message is not the exact requested disclosure and does not make the no-overwrite guarantee the single page disclosure.
3. After the wizard, `choosePermissionConfig()` can ask either `Enable bypassPermissions in user settings?` for legacy migration or `Enable bypass permissions in ~/.claude/settings.json?` for a new installation/relevant supported-version path.
4. The same function owns version checks, migration routing, dry-run handling, settings writes, existing-settings refusal, and retry routing. These safety decisions must remain in that function or an equivalent narrow path.
5. Non-interactive setup uses `permissionConfig: { bypass: "deny" }` and provisioning still presents its audit because `interactiveSetup` is false. Standalone `audit` calls `auditProject(..., { silent: true })` and then `printAudit` in `src/cli.mjs:179-182`.

### Proposed behavior

- Interactive setup calls the same audit with `silent: true`; the audit result still drives `LEGACY_VENDOR`, migration, and `--force` guards.
- The supported-version permission page displays exactly:
  `Enabling bypass permissions in ~/.claude/settings.json affects every project. Existing settings will not be overwritten.`
  It retains the legacy migration explanation where applicable and keeps `No` as the default.
- Selecting `Yes` and then accepting `Run setup now?` proceeds to permission processing/provisioning without either redundant bypass confirmation prompt. The selected choice is the consent point; the existing writer still decides whether the settings operation succeeds, is already enabled, or is refused.
- The separate legacy migration decision and final setup confirmation remain.
- Older Claude Code versions retain project-scoped semantics and must not receive the global-scope wording.
- Standalone audit, `setup --yes`, blocking errors, malformed-settings warnings, progress, completion output, and exact already-enabled warning remain unchanged.

### Non-goals

- Do not remove or rewrite the audit subsystem.
- Do not change standalone `repo-pattern audit` or non-interactive `setup --yes` output.
- Do not change settings formats, defaults, policy enforcement, writer protections, migration choice, final confirmation, retry state model, or generated files.
- Do not overwrite or repair existing/malformed user settings.
- Do not add dependencies, frameworks, parallel test infrastructure, or unrelated refactoring.
- Do not claim physical-terminal or real operator-`HOME` validation from simulated-terminal tests.

## 2. Requirement and acceptance-criterion matrix

| ID | Source | Expected behavior | Proposed change | Verification / negative case | Status |
|---|---|---|---|---|---|
| AC1 | Issue/Spec §Acceptance 1 | Interactive setup has no initial audit report, but audit decisions remain active | Change only the interactive `auditProject` call in `setupProject()` to `silent: true`; retain returned `audit` and all guards | Incomplete interactive target has no `Audit`, target/state, or missing-file issue output; legacy target still selects migration and `--force` guard still rejects; | Ready for implementation |
| AC2 | Issue/Spec AC2 | Legacy migration requirements and blocking errors remain enforced | Leave audit state, malformed `.claude/settings.json` handling, migration page, and provisioning guards unchanged | Legacy migration yes/no, malformed settings, and blocking-error tests; no audit suppression of actionable warnings/errors | Ready |
| AC3 | Issue/Spec AC3 | Standalone audit and `setup --yes` retain audit output | Do not edit `src/cli.mjs` standalone audit path or non-interactive provisioning presentation | CLI audit output includes Audit; `setup --yes` retains audit; negative: interactive-only silence must not leak to either path | Ready |
| AC4 | Issue/Spec AC4 | Supported versions show global-scope and no-overwrite disclosure before permission confirmation; legacy retains migration explanation | Update permission page `note`/presentation data in `wizardPages()` using existing `claudeCodeVersion` support signal; use exact Issue wording; preserve legacy note | Wizard contract and simulated terminal assert exact disclosure, legacy text, and ordering before selection; negative: old version does not claim global scope | Ready |
| AC5 | Issue/Spec AC5 | Supported new-install and legacy allow flows reach provisioning without either redundant prompt | Remove the post-wizard `confirm()` branches used solely for bypass consent; process the wizard `allow` as accepted consent, then call existing writer | Test confirms `confirm` is not called for bypass consent, writer is called once, and provisioning receives `user` on success/already-enabled; terminal helper no longer supplies extra answers | Ready |
| AC6 | Issue/Spec AC6 | Bypass is opt-in with `No` default; migration and final confirmation remain | Keep permission options ordered `deny`, `allow`, initial `deny`; preserve migration page and `Run setup now?` page | Wizard state/page test; cancellation test; negative: default or final/migration pages do not disappear | Ready |
| AC7 | Issue/Spec AC7 | Decline, cancellation, dry-run, existing/malformed settings, policy restrictions, old versions, and retry routes remain safe | Keep `setUserBypassPermission()` unchanged; retain dry-run early return, old-version mapping, retry fast paths, and result mapping; ensure no writer call when disallowed | Existing settings bytes unchanged; malformed/policy refusal unchanged; dry-run and cancel have zero user writes; retry allow does not prompt again | Ready |
| AC8 | Issue/Spec AC8 | Exact already-enabled warning and routing remain | Keep result warning construction and `alreadyEnabled` mapping; do not alter writer | Assert exact `WARN: Bypass permissions are already enabled in user settings.` and `bypass: "user"` where applicable | Ready |
| AC9 | Issue/Spec AC9 | Behavior and regression tests land together; obsolete second-confirmation assertions become single-consent checks | Modify existing setup contract, bypass routing, and simulated-terminal tests; retain safety assertions and add no parallel infrastructure | Focused tests fail if a second prompt appears, disclosure is absent, audit is rendered, or settings bytes change | Ready |
| AC10 | Issue/Spec AC10 | Each changed/added test documents `protects`, `fails_when`, and `no_claim` | Add/update the required comment immediately above each changed test/group, matching repository convention | Review changed test comments; no placeholder or assertion-only deletion | Ready |

### Material ambiguity and safe interim assumption

The Issue says the wizard's choice is the single consent point but also requires the existing final `Run setup now?` confirmation. The safe interpretation is: `Yes` on the permission page authorizes bypass handling; `Run setup now?` authorizes the overall setup. The final page remains and is not a second bypass-specific consent. The implementation must not remove either page.

### Approved terminal hierarchy — D1

The permission page is an OPERATE-style terminal surface. Preserve this scan order using the existing Ink frame and page primitives:

```text
repo-pattern / Claude Code version
  Allow bypass permissions mode?
  Global-scope + no-overwrite disclosure
  › No                 (default)
    Yes
  ←/→ to choose · Enter to confirm · Esc to cancel
```

For a legacy target, place the existing migration explanation immediately below the title and before the global-scope disclosure; do not add a second bypass confirmation. The final `Run setup now?` page remains a separate overall-setup decision after the permission page. The disclosure must wrap as readable terminal text rather than being hidden, truncated, or replaced by color-only meaning.

The plan does not require a new component, color, icon, animation, or layout system. It reuses `WizardShell`, `Frame`/`SelectPrompt`, existing option order, keyboard help, and cancellation behavior.

### Visible interaction-state contract — D2

| State | User sees | Trust requirement |
|---|---|---|
| Permission page | Title, disclosure, `No` selected, `Yes` alternative, keyboard help | Scope and no-overwrite facts appear before consent; meaning does not depend on color. |
| `No` / decline | Selection completes without a user-settings write; setup continues or final confirmation remains | The opt-out is quiet and reversible; no hidden bypass write occurs. |
| Esc / Ctrl-C | Existing `Setup cancelled.` error path; no user-settings write | Cancellation is visible and safe before provisioning. |
| Writer refusal | Existing warning/error text and preserved project/permission result | A refusal is not presented as successful global enablement. |
| Already enabled | Exact `WARN: Bypass permissions are already enabled in user settings.` warning | Existing state is reported, not overwritten or silently changed. |
| Successful completion | Existing setup progress/completion output after final confirmation | The final confirmation remains the overall action boundary; no extra bypass prompt appears. |

These are presentation contracts for existing states, not new components or result types. Focused tests should assert the visible text where the current seams expose it and retain `no_claim` for physical-terminal rendering.

### User journey storyboard — D3

| Step | User does | User should feel | Plan support |
|---|---|---|---|
| 1 | Enters setup and reaches the wizard without the redundant initial audit report | Oriented, not overwhelmed | Internal audit still runs; its report is hidden only at this interactive caller. |
| 2 | Reads the permission title and supported-version disclosure | Informed about project-wide impact and no-overwrite behavior | Disclosure precedes the options and uses exact required copy. |
| 3 | Accepts the default `No` or deliberately selects `Yes` | In control, with no accidental opt-in | `No` remains first/default; `Yes` is explicit consent and no second bypass prompt follows. |
| 4 | Reviews `Run setup now?` | Clear that this confirms overall setup, not a hidden permission escalation | Final confirmation remains separate and unchanged. |
| 5 | Sees success, refusal, already-enabled warning, or cancellation | Trusts the result | Existing visible outcomes and exact warning remain; no-write paths stay safe. |

The 5-second goal is immediate orientation; the 5-minute goal is a completed setup without repeated consent; the long-term goal is confidence that retries never broaden permission scope.

### Terminal specificity constraints — D4

Treat the wizard as an OPERATE surface: utility copy, one obvious next action, and calm terminal hierarchy. Do not add decorative cards, icons, gradients, animations, generic reassurance, or color-only consent meaning. Do not replace the exact global/no-overwrite disclosure with marketing language. Existing cyan/green/dim styling may continue as orientation and state support, but every meaningful permission fact and outcome must remain readable as text in a non-color terminal.

### What already exists / not in scope — D5

Reuse the existing `WizardShell`, `Frame`, `SelectPrompt`, border treatment, cyan/green/dim text roles, spacing, option order, and keyboard-help conventions. No repository product `DESIGN.md`, new design tokens, visual component, animation, iconography, or layout system is introduced by this plan. The unrelated gstack website `DESIGN.md` is not a governing system for this CLI.

### Terminal accessibility and constrained-width contract — D6

Preserve the existing keyboard order and visible focus marker; `No` remains the first/default option and `Esc`/Ctrl-C remains cancellation. The exact disclosure and outcome text must remain readable when the terminal is narrow, wrapping instead of being truncated or hidden behind color. Add one simulated-terminal case at 60 columns that asserts the complete disclosure remains present; retain the existing 100-column flow as the normal case. Verify text semantics with the existing simulated TTY/output seams and retain `no_claim` for full screen-reader semantics, physical-terminal rendering, and terminals not exercised by the suite. No new ARIA or terminal accessibility framework is in scope.

### CEO review decision D2 — version-changing retry consent

The outside review identified a scope-expansion hazard: a failed project-scoped `allow` retry can skip the permission page after Claude Code upgrades to user-scope support. The selected disposition is **preserve project allow**. A retry must not silently convert that prior project-scoped choice into user-wide settings. Any path that would write user-scope bypass after the version transition must require a fresh wizard permission choice and the existing final setup confirmation; otherwise retain the project-scoped `allow` result. Add a regression for the version-transition retry and preserve the existing retry semantics for `user`, `preserve`, and `deny`.

The outside review also found that existing direct-routing tables use `confirm: false` as a write guard. Once redundant confirmation is removed, those cases could reach the real user-settings writer. Migrate every supported-version `allow` fixture to an injected writer stub or an isolated temporary `HOME` before running the changed suite; never let the tests touch the operator's settings.

## 3. Architecture and end-to-end data/control flow

### Current flow

```text
CLI main
  -> setupProject()
     -> check Claude version
     -> auditProject(..., silent: false) -> renders initial Audit
     -> detect legacy project bypass
     -> runSetupInteraction()/SetupWizard
        -> permission page stores bypass: deny|allow
        -> final Run setup now? page
     -> choosePermissionConfig()
        -> version/migration/dry-run/retry routing
        -> redundant bypass confirm (supported allow)
        -> setUserBypassPermission()
     -> provisionProject(..., interactiveSetup: true)
```

### Target flow

```text
CLI main
  -> setupProject()
     -> auditProject(..., silent: true) -> structured state only
     -> same legacy/migration/force decisions
     -> SetupWizard
        -> supported-version disclosure + No-default permission choice
        -> separate migration choice where needed
        -> final Run setup now? confirmation
     -> choosePermissionConfig()
        -> preserve version/migration/dry-run/retry/result routing
        -> no bypass-specific confirm
        -> setUserBypassPermission() only when wizard choice and policy permit
     -> provisionProject(..., interactiveSetup: true)
```

### Existing components to reuse

- `auditProject()` structured state and its existing `silent` option (`src/audit.mjs:63-173`).
- `setupProject()` orchestration, legacy detection, retry state, and provision boundary (`src/setup/setup.mjs:136-271`).
- `wizardPages()`, `pruneWizardState()`, `SetupWizard`, and `runSetupWizard()` (`src/ui/setup-wizard.mjs:64-107`, `181-357`).
- `choosePermissionConfig()` and `claudeVersionSupportsUserScope()` for routing (`src/ui/setup-interaction.mjs:111-159`, `src/setup/bypass-permissions.mjs:7-15`).
- `setUserBypassPermission()` unchanged for no-overwrite, parse, policy, secure mode, race, and already-enabled protections (`src/setup/bypass-permissions.mjs:17-67`).
- Existing Node `node:test`, `ink-testing-library`, simulated `PassThrough` TTY, and temporary-`HOME` fixtures.

### Impacted verified files and symbols

- **Verified runtime edits:**
  - `src/setup/setup.mjs:setupProject` — interactive audit call only.
  - `src/ui/setup-wizard.mjs:wizardPages` — permission disclosure text/metadata only.
  - `src/ui/setup-interaction.mjs:choosePermissionConfig` — remove redundant confirmation branches while retaining writer/routing logic.
- **Verified test edits:**
  - `test/setup/setup-contract.test.mjs` — wizard disclosure and interactive audit presentation contracts.
  - `test/setup/bypass-permissions.test.mjs` — direct routing and consent-call expectations.
  - `test/setup/bypass-permissions-interactive.mjs` — terminal driver, prompt list, output assertions, and allow-flow expectations.
- **Potentially inspected but not planned for change:** `src/setup/bypass-permissions.mjs`, `src/setup/provision.mjs`, `src/setup/settings.mjs`, `src/cli.mjs`, and `src/audit.mjs`; modify only if a focused test proves an unavoidable compatibility issue, after impact analysis on the exact symbol.
- **No proposed new files.**

### Direct callers and compatibility boundaries

- `src/cli.mjs:main` calls `setupProject`; CLI command and flags remain unchanged.
- Tests call `setupProject`, `choosePermissionConfig`, and `wizardPages` directly.
- Provisioning still receives the normalized `permissionConfig`; settings transformation remains the existing contract (`src/setup/settings.mjs`).
- `auditProject` is shared and CRITICAL-impact; the plan deliberately avoids editing it. `silent: true` is scoped to the interactive setup caller, while standalone audit and non-interactive provisioning retain presentation.

### Migration and rollback

No settings/schema/data migration exists. Reverting the three runtime changes and corresponding tests restores the old audit presentation and redundant confirmation flow. Reverting code does not undo user settings legitimately created after a prior explicit wizard choice; test homes are temporary and isolated.

## 4. Concrete design decisions and alternatives

| Decision | Selected approach | Evidence / tradeoff |
|---|---|---|
| Interactive audit suppression | Pass `silent: true` at `setupProject()` only | Existing audit API already supports silence; avoids CRITICAL shared-function change and preserves standalone/non-interactive output. |
| Consent ownership | Wizard `allow` is bypass consent; final setup confirmation remains global setup consent | Explicit Issue wording; removes only duplicate bypass prompts and keeps cancellation safety boundary. |
| Disclosure placement | Permission page `note`/text generated from supported-version state | Existing declarative page model already carries `note`; no new UI component or state. |
| Old-version copy | Keep old-version prompt without global user-settings claim | Issue explicitly forbids implying project-scoped bypass is global; `claudeVersionSupportsUserScope()` is existing source of truth. |
| Writer behavior | Keep `setUserBypassPermission()` unchanged | Issue explicitly requires no weakening; existing tests cover malformed, policy-disabled, existing, race, modes, and exact result messages. |
| Tests | Update existing native and simulated-terminal tests; isolate every supported-version allow fixture from operator `HOME` | Issue explicitly directs reuse and no new framework; current suite is serial because process globals/TTY are exercised; removing confirmation makes writer injection or temporary-`HOME` isolation mandatory. |

### Rejected alternatives

- **Suppress audit globally:** rejected because it would change standalone audit, doctor/provision callers, and a CRITICAL-impact shared symbol.
- **Remove the wizard bypass choice:** rejected because informed opt-in, No default, and the disclosure are explicit requirements.
- **Keep a hidden confirmation in the routing function:** rejected because it violates the single-consent requirement and would leave terminal flows waiting for a removed prompt.
- **Change the settings writer to merge existing files:** rejected because it weakens the no-overwrite safety contract.
- **Add a new prompt/test framework:** rejected by the implementation boundary and unnecessary with current helpers.

### Premise/feasibility challenge

The change is feasible with a small diff because the audit already has a silent option and the wizard already stores bypass selection separately from provisioning. The risky premise is that removing both confirmation branches cannot affect legacy result mapping: implementation must preserve the current `user`/`preserve`/`deny` outcomes for writer success, already-enabled, failure, migration decline, dry-run, old versions, and retry. Focused tests must prove that mapping rather than merely proving the prompts disappeared.

## 5. Ordered implementation tasks

### Phase 0 — baseline and safety gate

1. Reconfirm the pre-existing `git status` and inspect the exact target files before editing; keep the three issue-100 deletions untouched.
   - **Exit:** only requested issue-105 paths are eligible for the implementation diff.
   - **Accepts:** AC1–AC10 safety boundary.
2. Before modifying each runtime symbol, rerun upstream GitNexus impact for `setupProject`, `wizardPages`, and `choosePermissionConfig`; report any HIGH/CRITICAL result before editing. Do not edit `auditProject`; if investigation requires it, run impact and stop on a HIGH/CRITICAL warning.
   - **Exit:** impact evidence is current and direct callers/processes are recorded.
   - **Accepts:** Issue implementation boundary; AC1, AC4, AC5.
3. Preserve D2's version-changing retry decision: if a failed project-scoped `allow` retry crosses into Claude Code user-scope support, do not silently write user settings. Route the retry through a fresh permission choice when user-scope migration is intended; otherwise preserve project-scoped `allow`.
   - **Exit:** retry behavior cannot expand permission scope without fresh wizard consent; a regression covers the old-version-to-supported-version transition.
   - **Accepts:** AC7 and D2.
4. Before running changed direct-routing cases, replace every supported-version `allow` fixture's `confirm: false` write guard with an injected writer stub or isolated temporary `HOME`; verify no test touches the operator's user settings.
   - **Exit:** changed tests remain deterministic and no-write safety is independently asserted.
   - **Accepts:** AC7, AC9–AC10.

### Phase 1 — runtime behavior

5. Change `src/setup/setup.mjs:setupProject` interactive audit invocation from presentation-enabled to silent while preserving the returned audit object and legacy/force decisions.
   - **Exit:** interactive initial audit is not rendered; audit state still controls migration and blocking guards; non-interactive path is unchanged.
   - **Accepts:** AC1–AC3.
6. Update `src/ui/setup-wizard.mjs:wizardPages` permission-page disclosure for supported versions to the exact required global/no-overwrite text, retain legacy migration explanation, and keep old-version copy version-appropriate. Preserve option ordering and `initialValue` behavior.
   - **Exit:** page data and rendered page expose disclosure before `Yes`/`No`, default is `No`, and final/migration pages remain.
   - **Accepts:** AC4, AC6.
7. Update `src/ui/setup-interaction.mjs:choosePermissionConfig` so the wizard's supported-version `allow` selection proceeds directly to `setUserBypassPermission({ accepted: true })` without either bypass-specific `confirm()` branch. Preserve dry-run, migration choice, old-version, retry, result mapping, warning, and writer invocation behavior.
   - **Exit:** no bypass confirmation prompt is reachable after the wizard; decline/cancel/dry-run/policy/existing/malformed/retry behavior remains represented by tests.
   - **Accepts:** AC5–AC8.

### Phase 2 — regression tests

8. Update `test/setup/setup-contract.test.mjs` contract comments/assertions for the exact permission disclosure, supported/legacy/old-version page semantics, and interactive audit silence while keeping migration and final-confirmation coverage.
   - **Exit:** tests assert behavior, not merely deletion of old strings; each changed test/group includes `protects`, `fails_when`, and `no_claim`.
   - **Accepts:** AC1–AC4, AC6, AC9–AC10.
9. Update `test/setup/bypass-permissions.test.mjs` direct routing checks: supported allow has zero confirmation calls and one writer call; legacy allow has the same single consent path; existing-enabled/failure/decline/dry-run/policy/malformed/old-version/retry cases retain expected outcomes and no-write guarantees.
   - **Exit:** obsolete `confirmCalls === 1` expectation is replaced with a single-consent assertion; safety assertions remain.
   - **Accepts:** AC5–AC10.
10. Update `test/setup/bypass-permissions-interactive.mjs` to stop driving removed prompts, assert exact disclosure and absence of both redundant prompt labels, assert absent initial audit output, retain expected generated settings and exact already-enabled warning where applicable, and preserve timeout/cancellation/failure checks.
   - **Exit:** both new-install and legacy simulated-terminal allow families finish without extra input and still verify filesystem outcomes.
   - **Accepts:** AC1, AC4–AC10.

### Phase 3 — verification and scope gate

11. Run focused setup tests first; inspect `git diff --` for each changed file and confirm only issue-105 behavior/test changes are present.
   - **Exit:** focused tests pass or exact failure is recorded; no unrelated diff.
   - **Accepts:** AC1–AC10.
12. Run the repository verification commands listed below, including full tests, module limits, coverage, and package smoke only if implementation is authorized to execute them. Report actual exit status/output; do not claim physical-terminal, macOS, or remote-CI validation.
   - **Exit:** all required local gates pass, or plan is marked incomplete with the blocker.
   - **Accepts:** AC1–AC10.
13. Before any separately authorized commit, run GitNexus `detect_changes({scope: "all"})` and confirm affected symbols/processes/files are limited to expected setup/wizard/permission paths and tests. This draft does not authorize a commit.
   - **Exit:** scope report reviewed; unexpected changes block commit.
   - **Accepts:** safety/compatibility gate.

## 6. Test matrix

| Layer | Existing command/fixture | Behavioral checks and negative cases | Acceptance IDs |
|---|---|---|---|
| Wizard unit/contract | `node --test --test-concurrency=1 test/setup/setup-contract.test.mjs` | Supported version shows exact disclosure and no-overwrite text; legacy adds migration explanation; old version remains project-scoped; permission options are `No`, `Yes` with `No` selected; migration and final confirmation pages remain | AC4, AC6, AC9, AC10 |
| Interactive audit contract | Same setup contract suite, using existing injected `interactionRunner`/output seams | Interactive incomplete target does not call/render initial audit presentation while returned audit still drives legacy/migration and `--force` behavior; standalone/noninteractive paths are not changed | AC1–AC3, AC9, AC10 |
| Permission routing unit | `node --test --test-concurrency=1 test/setup/bypass-permissions.test.mjs` | Supported new-install allow: no bypass `confirm`, one writer call; supported legacy allow: no bypass `confirm`, one writer call; writer success/already-enabled/failure map to existing outcomes; legacy migration decline preserves project bypass | AC5, AC7, AC8 |
| Safety/routing regression | Same bypass suite | `No`, migration cancellation, setup cancellation before provisioning, `dryRun`, existing/malformed settings, policy disable, old Claude version, retry `allow/user/preserve/deny`, and failure results preserve bytes and outcomes; exact warning retained | AC2, AC6–AC8 |
| Simulated terminal integration | `node --test --test-concurrency=1 test/setup/bypass-permissions.test.mjs` (invokes `bypass-permissions-interactive.mjs`) | New-install and legacy allow flows finish without answering either removed confirmation; disclosure is visible before choice; initial Audit text is absent; final setup confirmation remains; expected project/user settings and already-enabled warning are asserted | AC1, AC4–AC10 |
| Existing writer contract | Existing assertions in bypass suite; no writer code change planned | New user file uses existing secure modes; existing file is not overwritten; malformed root/permissions and policy-disabled settings refuse; race/error paths remain; no real `HOME` is used | AC7–AC10 |
| Standalone/noninteractive regression | `npm test`; CI-equivalent package smoke if authorized | `repo-pattern audit` still prints Audit; `setup --yes` retains noninteractive audit/output and never edits user settings; interactive-only silence does not affect provision's noninteractive `auditProject` call | AC2–AC3, AC7 |
| Full repository | `npm test` | All native tests pass serially (`--test-concurrency=1`) with no global TTY/HOME leakage | AC1–AC10 |
| Static/scope checks | `npm run check:module-limits`; `git diff --check`; GitNexus `detect_changes` before commit | No new dependency/framework; no writer change or unrelated symbol/file changes; test metadata present | AC9–AC10 |
| Coverage/CI | `npm run test:coverage -- "origin/${GITHUB_BASE_REF:-main}"` where base ref exists; CI matrix is `.github/workflows/ci.yml:18-19` | Changed routing and wizard branches are covered; no threshold or CI matrix change; local result is reported only if command runs | AC9–AC10 |
| Package smoke | Existing CI shape: `npm pack`, install temporary tarball, run `setup --setup-pipeline none --yes` outside checkout | Runtime package remains installable; no development files added; noninteractive audit/output contract remains | AC3, AC7 |

### Verified commands to use during implementation

```bash
node --test --test-concurrency=1 test/setup/setup-contract.test.mjs
node --test --test-concurrency=1 test/setup/bypass-permissions.test.mjs
node --test --test-concurrency=1 test/setup/interactive-provision.test.mjs
npm test
npm run check:module-limits
npm run test:coverage -- "origin/${GITHUB_BASE_REF:-main}"
```

`npm run test:coverage` is not listed as a baseline result. The plan records it as a required verification command only. The CI workflow skips `npm test` on Node 24 but runs coverage there; do not alter that matrix.

## 7. Failure-mode and risk register

| Risk | Severity | Detection | Mitigation | Recovery/rollback |
|---|---|---|---|---|
| Audit is silenced globally and standalone/`--yes` output disappears | Critical | CLI audit and noninteractive setup assertions; diff review for `src/audit.mjs`/`src/cli.mjs` | Change only `setupProject()` interactive call; do not edit `auditProject` | Revert caller change and tests; preserve shared audit code |
| Legacy migration decision is lost when audit is silent | High | Legacy fixture still reaches migration page and `--force` guard; audit state assertion | Keep audit result and state branches intact | Restore caller wiring before changing presentation |
| A hidden second bypass prompt remains | High | Spy on `confirm`; terminal helper prompt-label absence; timeout if input is awaited | Remove both bypass-specific confirmation branches, not final confirmation | Revert routing edit and revise branch-by-branch |
| Wizard `Yes` writes before final setup confirmation | Critical | Cancel at final page; inspect user settings and project files | Wizard stores state only; writer remains after final confirmation in `setupProject` | Restore state/provision ordering; remove any premature writer call |
| Bypass becomes enabled by default | Critical | Page default/state assertions and `No` terminal path; user-settings no-write check | Keep `deny` first and initial; preserve `selectedBypass` behavior | Revert option/default change |
| Existing or malformed settings are overwritten | Critical | Existing bytes, malformed JSON, permissions-type, policy-disabled, race tests | Keep `setUserBypassPermission` unchanged and call it only after accepted choice | Revert any writer change; do not repair user files |
| Legacy decline or writer failure loses project bypass intent | High | Legacy decline/failure expects `preserve` and warning | Preserve result mapping and exact ineffective warning | Restore old fallback branch and rerun migration tests |
| Old Claude versions receive global warning or user-scope route | High | `2.1.256` prompt/output and `allow` result assertions | Branch disclosure and routing on existing version helper | Revert wording/routing and retain project-scoped copy |
| Retry allow reopens a prompt or changes user/preserve/deny semantics | High | Retry matrix and lock-derived state tests | Preserve retry fast paths before normal permission logic | Restore retry branch ordering |
| Exact already-enabled warning changes | Medium | String assertion for `WARN: Bypass permissions are already enabled in user settings.` | Do not rewrite warning composition | Restore warning literal and mapping |
| Simulated terminal hangs after prompt removal | High | 15-second helper timeout and no-extra-prompt assertions | Remove consent labels/answers from driver while retaining final confirmation response | Reconcile driver with actual page order; do not increase timeout to hide a hang |
| Test passes by deleting obsolete assertions only | High | `protects/fails_when/no_claim` review; filesystem and call-count assertions | Replace with single-consent, disclosure, no-audit, and no-write behavior | Restore missing regression assertion before accepting |
| Pre-existing issue-100 deletions are touched | Medium | `git diff --name-status` and path-specific diff | Keep unrelated deletions outside edit set | Stop and report; do not restore/revert user changes |

## 8. Open questions and safe interim assumptions

- **No unresolved requirement conflict:** Issue and archive agree on scope and exact disclosure. The only interpretation point is resolved above: final setup confirmation remains a separate overall-setup confirmation, not a second bypass consent.
- **Current test helper path assertion:** `test/setup/bypass-permissions-interactive.mjs:139` references `.repo-pattern/setup-status.json`, while inspected setup code writes `.repo-pattern/.repo-pattern.lock.json` through `writeSetupStatus()`. This is an existing test/fixture detail not required by Issue #105. Verify it during focused test execution; do not alter it unless a failing test proves it is part of the requested regression.
- **Static versus live evidence:** no test command was run for this draft, so current pass/fail status, rendered terminal behavior, and exact output are implementation-time checks.
- **Cross-platform:** simulated TTY runs on this Linux environment. They do not establish physical terminal behavior, macOS behavior, or a real operator home; preserve the `no_claim` metadata.

## 9. Review applicability

**UI scope is established and the applicable Design review is complete.** The Issue/Spec changes terminal wizard copy, permission-page disclosure, prompt count, selection flow, and simulated-terminal behavior. This is existing terminal UI/UX scope even though it is not a visual redesign. Do not record `no_ui_scope`. No review-covered scope or architecture changed after the CEO/Design reviews; `scopeChangedAfterReview=false`.

## 10. Implementation-ready checklist

- [ ] Preserve the three pre-existing issue-100 deletions and confirm no other working-tree changes are yours.
- [ ] Rerun impact on each runtime symbol immediately before editing; warn before any HIGH/CRITICAL result.
- [ ] Silence only the interactive setup audit call; retain audit result and all blocking decisions.
- [ ] Use the exact supported-version disclosure and preserve old-version copy.
- [ ] Keep No as default and retain legacy migration plus final setup confirmation.
- [ ] Remove only the two bypass-specific confirmations; keep writer safety and result mapping.
- [ ] Assert no writer call on decline, cancellation, dry-run, policy refusal, malformed/existing settings, and failed paths as appropriate.
- [ ] Preserve exact already-enabled warning.
- [ ] Update existing tests with `protects`, `fails_when`, `no_claim` comments; do not delete coverage without replacement behavior.
- [ ] Run focused tests, inspect path-specific diffs, then run full local verification and report actual results.
- [ ] Run `detect_changes()` before any separately authorized commit; no commit is authorized by this plan.

## Final draft assessment

- **Exact absolute implementation plan path:** `/home/kirin/Code/my-hobby/repo-pattern/docs/plans/issue-105-streamline-interactive-setup.md`
- **Requirements coverage:** all 10 acceptance criteria are mapped to stable matrix rows, runtime/test tasks, negative cases, and verification commands. Explicit safety, compatibility, no-overwrite, warning, rollback, test metadata, and out-of-scope requirements are recorded.
- **Known uncertainties:** no implementation test results exist yet; the existing setup-status path assertion should be verified during focused execution; simulated TTY coverage cannot claim physical-terminal or real-`HOME` behavior. No requirement ambiguity remains unresolved.
- **Review readiness:** CEO review completed in HOLD SCOPE and Design review completed at 9/10. The plan includes D2's retry-consent decision, test-HOME isolation, D1–D7 design decisions, and T1–T4 implementation tasks. No source or test implementation was performed. Engineering review remains historical/not run in this consolidation and is not converted into a required gate by this record.

## CEO REVIEW NOTES

### Current scope and governing decisions

- **D1 — HOLD SCOPE:** user-selected. Preserve the Issue/SPEC boundary; no adjacent setup redesign, new infrastructure, dependencies, or scope cuts.
- **D2 — Preserve project allow on version-changing retry:** user-selected after independent challenge. A retry must not silently convert a prior project-scoped `allow` into user-wide settings. A fresh permission choice is required for any user-scope migration; otherwise retain project-scoped `allow`.
- **Outside voice:** Codex review completed with `VERDICT: FINDINGS`; both findings were analyzed and D2 plus test isolation were applied to this plan. No clean-review credit.

### Section 1 — Architecture Review

**OK.** Existing boundaries are correct: `setupProject` owns interactive orchestration, `wizardPages` owns disclosure, `choosePermissionConfig` owns routing, and `setUserBypassPermission` remains the safety boundary. The shared `auditProject` function stays untouched despite CRITICAL blast radius. The one required architecture correction is the D2 retry branch: `retryChoice=retry` with a prior project-scoped `allow` must return project-scoped `allow` rather than enter the new user-writer path.

```text
CLI -> setupProject -> audit(silent at interactive caller)
                    -> SetupWizard(permission disclosure + final confirm)
                    -> choosePermissionConfig
                       -> retry allow: project allow (no scope expansion)
                       -> fresh supported allow: existing safe writer
                    -> provisionProject(interactive)
                       -> audit(silent internally)
                       -> project/user settings boundaries
```

Data paths: selected `deny` remains in memory and reaches project settings; fresh supported `allow` reaches the existing writer; legacy migration failure reaches `preserve`; audit state remains an internal decision input while presentation is suppressed. Nil/empty selections retain existing defaults; writer and provisioning errors remain visible. No new persistent data model, endpoint, background job, or scale concern exists. Rollback is a caller/routing revert and does not undo legitimate user settings already created.

### Section 2 — Error and Rescue Map

**OK with D2 correction.** Existing errors remain visible: malformed project settings warn and stop before the wizard; legacy/force conflicts throw; malformed/existing/policy-disabled user settings return writer failure results and preserve existing routing; setup cancellation stops before provisioning; terminal-driver timeout fails the test rather than increasing its timeout. No new catch-all is proposed. The plan now requires tests for the version-transition retry and for every changed writer call to use an injected stub or isolated `HOME`.

### Section 3 — Security and Threat Model

**OK after amendment.** The only sensitive mutation is user-scope settings. The plan keeps the no-overwrite, malformed-file, policy-disabled, atomic-write, and secure-mode protections in `setUserBypassPermission`. D2 closes the consent-confusion threat where old project consent could be reinterpreted as global consent. Test isolation closes the accidental operator-`HOME` write threat. No dependency, endpoint, secret, or new input surface is added.

### Section 4 — Data Flow and Interaction Edge Cases

**WARNING resolved.** The important asynchronous/user-flow edge is final confirmation: wizard selection stores state only; the writer runs after `Run setup now?`. Removed prompts must not leave the simulated driver waiting. Retry states are ordered before normal permission routing; `allow` is now explicitly treated as project-scoped during retry, while `user`, `preserve`, and `deny` retain their existing fast paths. Double input is bounded by the existing wizard controller; cancellation and dry-run remain no-write paths.

```text
permission page -> selected value -> final setup confirm
  deny/empty -> project deny -> provision
  fresh supported allow -> writer -> user scope or preserved failure result
  retry project allow -> project allow -> provision; never writer
  cancel/dry-run/error -> no user write -> visible result
```

### Section 5 — Code Quality Review

**OK.** The smallest change remains caller-level audit silencing, declarative disclosure text, removal of two redundant confirmations, and focused test updates. No abstraction or dependency is warranted. The only required code-path clarification is to keep retry `allow` before the normal supported-version writer branch.

### Section 6 — Test Review

**WARNING resolved.** Existing coverage is broad and maps each AC to a behavioral assertion. The plan now explicitly adds: (1) old-version project `allow` followed by supported-version retry, proving no user settings write; and (2) writer stubs or temporary `HOME` for every supported-version direct-routing `allow` fixture. The hostile QA test is an extra prompt or accidental global write; the chaos case is malformed/policy-disabled/existing settings during a consented allow. No physical-terminal, real operator-`HOME`, or remote-CI claim is made.

### Section 7 — Performance Review

**No issues found.** The change removes a presentation and prompt, adds no query, process, allocation, retry loop, network call, or persistent structure. Existing audit work still runs because decisions must remain intact.

### Section 8 — Observability and Debuggability Review

**No new observability required.** This is a local CLI/TUI flow with existing warnings, errors, progress, and exact already-enabled warning. Adding metrics or dashboards would be unrelated scope. The plan preserves visible failure messages and test timeout diagnostics.

### Section 9 — Deployment and Rollout Review

**No issues found.** No migration, feature flag, staged rollout, or compatibility deployment is required. Package smoke, full tests, module limits, coverage, and diff scope checks remain in the verification matrix. Rollback is a small code revert; legitimate user settings are intentionally not removed by rollback.

### Section 10 — Long-Term Trajectory Review

**OK.** Reusing the existing silent-audit, wizard, routing, writer, and test seams keeps the change obvious and reversible. D2 prevents a future permission-scope regression. The plan does not introduce platform debt, a second consent model, or a new state format.

### Section 11 — Design and UX Review

**UI scope applies.** This is terminal UI: the user sees the permission page, disclosure, prompt count, and final confirmation. The intended order is audit decisions without initial report, migration/retry choice when applicable, configuration pages, permission disclosure, final setup confirmation, then provisioning. Supported versions show global impact and no-overwrite text; old versions avoid global wording; legacy versions retain migration explanation. Keyboard navigation, existing `No` default, cancellation, and simulated-terminal coverage remain. Accessibility is limited to the existing Ink terminal controls; no new visual component or responsive surface is introduced. Consider `/plan-design-review` before implementation for a deeper terminal interaction review.

### Temporal interrogation

- **Hour 1:** rerun status, inspect files, refresh GitNexus impact, and confirm D2/test isolation before edits.
- **Hours 2–3:** implement the three narrow runtime changes, including retry-`allow` preservation, then update focused assertions.
- **Hours 4–5:** run simulated terminal, routing, provisioning, and full native tests; inspect diffs and no-write behavior.
- **Hour 6+:** run module limits, coverage, package smoke where available, and `detect_changes` before any separately authorized commit. Record actual failures rather than widening timeouts or claiming unrun environments.

### Reality rows

REALITY: premise-table pass direct cause and boundaries are evidenced in the plan's verified-current-implementation table docs/plans/issue-105-streamline-interactive-setup.md:8-15
REALITY: already-done pass base branch checked and no matching implementation landed in the base log docs/plans/issue-105-streamline-interactive-setup.md:5-15
REALITY: surface-check pass setup and audit command surfaces were verified with `--help` package.json:9-20
REALITY: binding-decisions pass branch decisions were searched and D1/D2 are recorded above docs/plans/issue-105-streamline-interactive-setup.md:71-75
REALITY: numbers pass effort is explicitly marked planning estimate, not measured docs/plans/issue-105-streamline-interactive-setup.md:113-115
REALITY: deferred-asks pass Issue/SPEC out-of-scope items and implementation-time checks are recorded docs/plans/issue-105-streamline-interactive-setup.md:45-50
REALITY: pr-count pass one PR is the configured default and no split is proposed docs/plans/issue-105-streamline-interactive-setup.md:308-309

## Design Review Completion Summary

```text
+====================================================================+
|         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
+====================================================================+
| System Audit         | No repo product DESIGN.md; terminal UI scope |
| Step 0               | 7/10 initial; trust and consent focus       |
| Pass 1  (Info Arch)  | 7/10 → 10/10 after D1                     |
| Pass 2  (States)     | 7/10 → 10/10 after D2                     |
| Pass 3  (Journey)    | 7/10 → 10/10 after D3                     |
| Pass 4  (AI Slop)    | 9/10 → 10/10 after D4                     |
| Pass 5  (Design Sys) | 7/10 → 10/10 after D5                     |
| Pass 6  (Responsive) | 5/10 → 9/10 after D6                     |
| Pass 7  (Decisions)  | 1 resolved, 0 deferred                    |
+--------------------------------------------------------------------+
| NOT in scope         | 6 items: web styling, new components, motion,  |
|                      | tokens, ARIA framework, full screen-reader QA |
| What already exists  | Ink WizardShell, Frame, SelectPrompt, styles, |
|                      | option order, keyboard help, cancellation     |
| TODOS.md updates     | 0 deferred                                   |
| Approved Mockups     | 0 generated, 0 approved; API key unavailable |
| Decisions made       | D1–D7 added to plan                           |
| Decisions deferred   | 0                                             |
| Overall design score | 5/10 → 9/10                                  |
+====================================================================+
```

### NOT in scope

- Web, mobile, or browser responsive layouts; this is an existing terminal wizard.
- New visual components, tokens, animation, iconography, or a design-system rewrite.
- Full screen-reader/ARIA validation beyond the existing Ink and text-output seams.
- Physical-terminal, macOS, or unexercised terminal emulator validation.
- Changing the settings writer, permission policy, or audit architecture.
- Broad redesign of unrelated terminal reports or prompts.

### What already exists

- `WizardShell`, `Frame`, `SelectPrompt`, existing border/colors/spacing, option ordering, keyboard help, and cancellation behavior.
- Existing audit `silent` option, writer protections, exact warnings, temporary-`HOME` helper, and serial `node:test` setup.
- No repo product `DESIGN.md`; the unrelated gstack website design system is not applied to this CLI.

### Approved decisions and implementation tasks

- D1: explicit permission-page hierarchy and legacy disclosure order.
- D2: visible interaction-state contract.
- D3: informed-control journey storyboard.
- D4: utility-only terminal specificity constraints.
- D5: reuse boundary and no new design vocabulary.
- D6: keyboard, non-color, narrow-width, and honest accessibility boundary.
- D7: 60-column full-disclosure check.
- T1–T4 are recorded in the design-review task artifact and must be incorporated into the implementation/test tasks; no separate TODOS.md items remain.

### Unresolved Decisions

None. Mockup generation was attempted and saved zero images because the design binary reported no image API key; no visual approval is claimed. Implementation remains separately unauthorized.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~30m / CC: ~5min)** — Permission page hierarchy — Preserve explicit consent hierarchy and exact disclosure
  - Surfaced by: Pass 1 — title, disclosure, No-default options, and keyboard-help order.
  - Files: `src/ui/setup-wizard.mjs`, `test/setup/setup-contract.test.mjs`, `test/setup/bypass-permissions-interactive.mjs`
  - Verify: focused wizard and simulated-terminal tests assert order and exact disclosure.
- [ ] **T2 (P1, human: ~45m / CC: ~10min)** — Terminal interaction states — Assert visible no-write, refusal, warning, cancellation, and success states
  - Surfaced by: Pass 2 — visible-state contract for consent-sensitive outcomes.
  - Files: `test/setup/setup-contract.test.mjs`, `test/setup/bypass-permissions.test.mjs`, `test/setup/bypass-permissions-interactive.mjs`
  - Verify: focused setup/bypass tests assert no writes, refusal, exact warning, cancellation, and success.
- [ ] **T3 (P1, human: ~30m / CC: ~5min)** — Consent journey — Keep single bypass consent distinct from final setup confirmation
  - Surfaced by: Pass 3 — informed-control journey and no duplicate bypass prompt.
  - Files: `src/ui/setup-interaction.mjs`, `test/setup/bypass-permissions.test.mjs`, `test/setup/bypass-permissions-interactive.mjs`
  - Verify: no bypass-specific `confirm` call occurs after wizard selection; final `Run setup now?` remains.
- [ ] **T4 (P2, human: ~45m / CC: ~10min)** — Constrained terminal output — Verify full disclosure at 60 columns without color dependence
  - Surfaced by: Pass 6/7 — narrow wrapping and complete disclosure text.
  - Files: `test/setup/bypass-permissions-interactive.mjs`
  - Verify: simulated output at 60 columns contains the complete exact disclosure and no removed prompt.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | Complete | mode: HOLD SCOPE, 0 critical gaps |
| Outside Review | Codex via CEO review | Independent 2nd opinion | 1 | Findings addressed | 2 findings, 2/2 applied |
| Eng Review | `/autoplan` | Historical architecture & tests record | 0 | Not run | Preserved historical section; not a fresh gate in this consolidation |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | Complete | score: 5/10 → 9/10, 7 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | Not run | Not requested |

**OUTSIDE COVERAGE:** Codex, CEO-review phase, completed with findings; both findings were applied. Design mockup generation was attempted but unavailable because the design binary reported no image API key; no visual-review completion is inferred.

**CROSS-MODEL:** Native design review and completed Codex review exist; overlap is limited to the recorded CEO findings and the design review's trust/consent focus. No clean external verdict is claimed.

**VERDICT:** CEO + DESIGN CLEAR — plan consolidated and ready for implementation handoff; no source/test implementation or commit is authorized by this request.

NO UNRESOLVED DECISIONS

<!-- KFLOW_REVIEW_COMPLETION_BEGIN -->
```json
{
  "issueUrl": "https://github.com/NegiKirin/repo-pattern/issues/105",
  "specArchivePath": "/home/kirin/Code/my-hobby/repo-pattern/.repo-pattern-runtime/state-root/projects/NegiKirin-repo-pattern/specs/20261124-issue-105-streamline-interactive-setup.md",
  "reviews": {
    "ceo": {
      "status": "completed",
      "outcome": "HOLD SCOPE; UI scope confirmed; Codex VERDICT FINDINGS with two findings addressed; no unresolved decisions; no implementation or tests run",
      "evidence": "Saved plan CEO REVIEW NOTES and GSTACK REVIEW REPORT; native CEO review logged as completed with native+codex on 2026-11-24, with Codex outside_status completed."
    },
    "design": {
      "status": "completed",
      "outcome": "initial 5/10, final 9/10; seven decisions added; no unresolved decisions",
      "evidence": "Saved plan Design Review Completion Summary and GSTACK REVIEW REPORT; native design review logged completed with decisions_made=7. Mockup generation saved zero images because the design binary reported no image API key; outside design voices were skipped by user choice."
    }
  },
  "findings": [
    {
      "id": "CEO-D2-retry-scope",
      "severity": "high",
      "disposition": "implementation_verification",
      "task": "Add and pass the old-version project-scoped allow to supported-version retry regression; preserve project-scoped allow and require fresh wizard consent for any user-scope migration.",
      "evidence": "Saved plan CEO REVIEW NOTES, Section 1 Architecture Review, Section 4 Data Flow, and Phase 0 task 3; Codex finding addressed by the user-selected D2 decision."
    },
    {
      "id": "CEO-D2-test-home-isolation",
      "severity": "high",
      "disposition": "implementation_verification",
      "task": "Replace every supported-version allow fixture's confirm:false write guard with an injected writer stub or isolated temporary HOME and assert the operator HOME is untouched.",
      "evidence": "Saved plan status/evidence, CEO review Section 3 Security, Section 6 Test Review, and Phase 0 task 4; Codex finding addressed in the plan."
    },
    {
      "id": "DESIGN-terminal-hierarchy-and-states",
      "severity": "informational",
      "disposition": "implementation_verification",
      "task": "Implement and test the approved D1-D7 terminal hierarchy, visible states, consent journey, utility-only constraints, existing UI reuse, keyboard/non-color behavior, and 60-column complete disclosure.",
      "evidence": "Saved plan Design Review Completion Summary, approved decisions D1-D7, and implementation tasks T1-T4; design review logged completed at 5/10 to 9/10."
    }
  ],
  "unresolvedMaterialDecisions": [],
  "implementationConditions": [
    "Before editing, rerun GitNexus impact for setupProject, wizardPages, and choosePermissionConfig; warn and stop before any HIGH/CRITICAL result.",
    "Implement the runtime and test tasks in the saved plan, including retry-scope preservation and supported allow fixture isolation.",
    "Run focused setup/bypass tests, full repository verification, path-specific diff inspection, and report actual results; do not claim physical-terminal or real operator HOME validation.",
    "Run GitNexus detect_changes before any separately authorized commit; no commit, merge, or deployment is authorized here."
  ],
  "scopeChangedAfterReview": false
}
```
<!-- KFLOW_REVIEW_COMPLETION_END -->
