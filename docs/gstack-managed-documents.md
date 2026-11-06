# Managed gstack documents

New `repo-pattern setup` installations use upstream `setup --local` to publish project-local skills. Upstream owns document rendering and skill links; repo-pattern does not rewrite the resulting sections or create a competing copy. The installer runs against stable final project paths with isolated project-local state and configuration. repo-pattern records installation integrity and retains the previous installation for rollback.

`.repo-pattern/gstack/documents.json` uses version 2 and records checkout-relative document filenames with a single SHA-256 hash per file. Recording and verification never rewrite source documents. `.repo-pattern/gstack/upstream-manifest.json` separately records upstream publication files, symlink targets, and linked content. Setup verifies ownership before repeat setup or upgrade. Modified documents or publication files must be reconciled without discarding user data.

Document discovery traverses only existing local Markdown references, including upstream home-style references. Missing or dynamic references are reported explicitly and are not expanded into a repository-wide search. Templates, runtime code, tests, dependencies, and contributor documents are outside the source document manifest. Doctor validates installation integrity without executing document content. This does not establish which skill-loading route Claude used.

Setup accepts exact previously managed output. User modifications, deletions, and symlink substitutions must be resolved without discarding user data. Do not reset or stash the checkout to bypass ownership checks. Keep a separate copy of any edited files before reconciling them with upstream.

## Rollback and unsupported installations

Setup retains the previous checkout until the staged transaction succeeds and snapshots generated artifacts and state for rollback. If rollback reports a recovery snapshot, preserve that directory and the current installation until recovery is complete.

Legacy synthetic-wrapper installations and version 1 document manifests are unsupported. Setup and doctor reject them rather than migrating, rewriting, or deleting them. Preserve the existing checkout, published skills, settings, and state before arranging a fresh upstream-managed installation. `upgrade-gstack` remains available for installations managed by the current upstream flow.

Direct upstream `./setup`, `bun run build`, and `/gstack-upgrade` can regenerate documents outside repo-pattern's transaction. Use `repo-pattern setup` for managed upgrades. Moving a project does not automatically rebase stored paths.
