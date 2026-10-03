# /gstack-upgrade

This installation is managed by repo-pattern and is project-local. Do not run the upstream upgrade flow, upstream setup or relink commands, or modify global installations. Do not stash, reset, or overwrite user changes.

1. Ask the user whether to upgrade this project's gstack installation. Do not upgrade without their authorization.
2. Run the following command. It stages a fresh checkout, regenerates project-local wrappers, validates all managed artifacts and safety hooks, and retains the previous installation until validation succeeds.

```bash
repo-pattern upgrade-gstack --target {{TARGET}}
```

3. Report success only when the command exits successfully. On failure, report the failure and any partial rollback diagnostics. Never claim restoration unless the command confirms it. Do not fall back to upstream setup, manual deletion, global installation, or destructive Git commands.
4. After a successful upgrade, ask the user to start a new Claude Code session so previously loaded skills and hooks are refreshed.

If repo-pattern is not available on PATH, stop and report that prerequisite. Do not install another package or execute an unverified downloaded command as a fallback.
