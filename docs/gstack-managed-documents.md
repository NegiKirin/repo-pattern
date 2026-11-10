# Managed gstack documents

New `repo-pattern setup` installations use upstream `setup --local` to publish project-local skills. After upstream rendering, repo-pattern normalizes only managed runtime roots in canonical and separately rendered Markdown, preserving upstream section-link relationships and publication ownership. The installer runs against stable final project paths with isolated project-local state and configuration. repo-pattern records installation integrity and retains the previous installation for rollback.

`.repo-pattern/gstack/documents.json` records checkout-relative document filenames with upstream and normalized SHA-256 hashes. Normalization is performed only after ownership preflight and is transaction-protected. `.repo-pattern/gstack/upstream-manifest.json` separately records upstream publication files, symlink targets, and linked content. Setup verifies ownership before repeat setup or upgrade. Modified documents or publication files must be reconciled without discarding user data.

Document discovery traverses only existing local Markdown references, including upstream home-style references. Missing or dynamic references are reported explicitly and are not expanded into a repository-wide search. Templates, runtime code, tests, dependencies, and contributor documents are outside the source document manifest. Doctor validates installation integrity without executing document content. This does not establish which skill-loading route Claude used.

Setup accepts exact previously managed output. User modifications, deletions, and symlink substitutions must be resolved without discarding user data. Do not reset or stash the checkout to bypass ownership checks. Keep a separate copy of any edited files before reconciling them with upstream.

## Rollback and unsupported installations

Setup retains the previous checkout until the staged transaction succeeds and snapshots generated artifacts and state for rollback. If rollback reports a recovery snapshot, preserve that directory and the current installation until recovery is complete.

Legacy synthetic-wrapper installations without an upstream publication manifest remain unsupported. Setup and doctor reject them rather than migrating, rewriting, or deleting them. Upstream-managed installations accept version 2 source-only document manifests and write version 1 dual-hash manifests after normalization; normalized sources are verified and restored before repeat setup or upgrade. Preserve the existing checkout, published skills, settings, and state before arranging a fresh upstream-managed installation. `upgrade-gstack` remains available for installations managed by the current upstream flow.

Direct upstream `./setup`, `bun run build`, and `/gstack-upgrade` can regenerate documents outside repo-pattern's transaction. Use `repo-pattern setup` for managed upgrades. Moving a project does not automatically rebase stored paths.
