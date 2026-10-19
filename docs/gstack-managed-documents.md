# Managed gstack documents

`repo-pattern setup` normalizes installed checkout skill documents after the runtime build. The versioned `.repo-pattern/gstack/documents.json` manifest records checkout-relative filenames and SHA-256 hashes of upstream and normalized bytes. Generated wrappers and checkout documents target the final project installation, not staging directories.

Only existing local Markdown references are traversed. Missing or dynamic references are reported explicitly and are not expanded into a repository-wide search. Templates, runtime code, tests, dependencies, and contributor documents are not managed. Doctor checks document integrity and global path references without executing document content. This does not establish which skill-loading route Claude used.

Setup accepts exact previously managed output. User modifications, deletions, and symlink substitutions must be resolved without discarding user data. Do not reset or stash the checkout to bypass ownership checks. Keep a separate copy of any edited files before reconciling them with upstream.

## Rollback and older versions

Setup retains the previous checkout until the staged transaction succeeds and snapshots generated artifacts and state for rollback. If rollback reports a recovery snapshot, preserve that directory and the current installation until recovery is complete.

Older repo-pattern versions may reject the normalized checkout as locally modified. Transparent downgrade support is not provided. Before changing versions, preserve a complete copy of `.claude/skills/gstack`, generated skill wrappers/assets, `.claude/settings.json`, and `.repo-pattern/gstack` outside the installation being replaced. To recover an older installation, restore its matching checkout, generated artifacts, and state together from that preserved backup; never discard current checkout changes to force a downgrade. Without a matching older backup, retain the current installation and use a version that understands managed documents.

Direct upstream `./setup`, `bun run build`, and `/gstack-upgrade` can regenerate documents outside repo-pattern's transaction. Use `repo-pattern setup` for managed upgrades. Moving a project does not automatically rebase stored paths.
