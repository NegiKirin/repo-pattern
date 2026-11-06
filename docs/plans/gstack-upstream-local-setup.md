# Upstream local gstack setup

## PRD

Run upstream `setup --local` for repo-pattern's gstack and both pipelines. Preserve project-local installation, user changes, and rollback. Do not enable team mode or modify the operator's global installation. Upstream's deprecated local mode remains an explicit product requirement.

## Architecture

Upstream owns skill publication, renders, links, registry and runtime bootstrap. repo-pattern owns checkout selection, transaction snapshots, integrity records and validation. All installations use upstream publication; synthetic wrappers and legacy migration are removed.

## System design

Prepare a candidate checkout with the existing resolver lease. Run the installer against stable final project paths because upstream renders embed absolute paths and installation identity. Snapshot affected artifacts and state before installer mutation; retain the old checkout until validation succeeds. Roll back artifacts, state and checkout on failure. Isolate installer HOME, Claude/Codex config, state, browser cache and temporary files within the project. Disable OS font installation, team mode and harness autodetection.

## Technical notes

Reject unsupported legacy records without modifying their files. Upstream-owned output needs manifest-aware integrity and containment checks, including legitimate project-local symlinks. Source document records use version 2 with one identity hash and never rewrite source bytes. Unknown or edited files block replacement rather than being discarded. Installer success alone is insufficient: missing publication, escaping links, stale staging references and invalid runtimes must fail validation.

## Tasks

- [x] Inspect actual upstream local-install contract and GitNexus impact.
- [x] Add and run failing installer invocation regression.
- [x] Implement upstream-owned local installation and rollback.
- [x] Test repeat setup, failure rollback, ownership conflicts and local links.
- [x] Integrate tests and update setup documentation.
- [x] Run focused/full checks, coverage and code review.

## Verification

The regression must fail without upstream invocation and pass without rewriting upstream publication. No tests may mutate the live gstack installation or operator global settings. Record failures and unverified real-upstream behavior explicitly.

After legacy removal, focused upstream invocation, no-write dry-run, unsupported-state rejection, snapshot-creation failure, repeat setup, integrity and lifecycle CLI regressions passed. Module size, syntax, whitespace and package dry-run checks pass. `npm run test:coverage` passes after replacing obsolete wrapper assertions and the diagnostics version 1 fixture: changed production source lines 270/276 (97.8%), V8 block ranges 80/98 (81.6%); ECC scoped lines 100.0% and functions 98.6%. V8 block ranges are not syntactic branch coverage. General, JavaScript and security reviews have no remaining concrete blockers. Tests use isolated upstream fixtures; the live upstream installer and paid evals have not been run.
