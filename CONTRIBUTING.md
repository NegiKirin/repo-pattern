# Contributing

## Repository layout

- `bin/` contains the executable `repo-pattern` entrypoint.
- `src/` contains runtime code, organized by feature and responsibility. `src/ui/reports.mjs` owns doctor/report presentation, and `src/ui/mcp-interaction.mjs` owns interactive MCP configuration prompts and validation.
- `test/` contains native `node:test` contract tests.
- `scripts/` contains development checks and coverage tooling; migrated tests and fixtures live under `test/`.
- `.claude.example/`, `mcp/servers/`, `.repo-pattern.example.json`, and `src/vendor/` contain runtime templates, MCP definitions, example state, and vendored assets.

## Local checks

Install dependencies with the lockfile, then run the full native suite:

```bash
npm ci
npm test
npm run check:module-limits
npm run test:coverage
```

Tests use Node's built-in `node:test` runner. Run one focused contract file when iterating:

```bash
node --test --test-concurrency=1 test/setup/setup-contract.test.mjs
node --test --test-concurrency=1 test/cli/cli-contract.test.mjs
```

`npm test` runs the native contract tests under `test/`. Before changing prompt behavior, run `npm run eval:select` to preview the selected evaluation suites, then run each listed suite with Node's test runner. `npm run check:module-limits` checks source layout and module size limits. `npm run test:coverage` checks all runtime files under `src/` and `bin/`, including files not loaded by tests, with at least 80% function and branch coverage. It also retains changed-line coverage as diagnostic output against the selected base revision. Do not lower thresholds, add coverage suppressions, or regenerate characterization baselines from the refactored implementation.

## Package smoke verification

Verify the published shape with a real tarball, not only `npm pack --dry-run`. Keep pack, install, and fixture directories outside the checkout and remove them in a cleanup trap or `finally` block:

```bash
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir "$root/pack" "$root/install" "$root/target"
npm pack --pack-destination "$root/pack"
archive=$(find "$root/pack" -name '*.tgz' -print -quit)
npm install --prefix "$root/install" --no-save "$archive"
bin="$root/install/node_modules/.bin/repo-pattern"
(cd /tmp && "$bin" --help)
(cd /tmp && "$bin" --version)
(cd /tmp && "$bin" setup --target "$root/target" --setup-pipeline none --yes)
```

Inspect the archive and confirm it contains `bin/repo-pattern.mjs`, `src/`, runtime templates, `mcp/servers/`, and `src/vendor/`, while excluding tests, fixtures, development tooling, internal plans, and CI workflows. The `package.json` `files` allowlist is the source of truth for shipped paths.

## CI and behavioral limits

`.github/workflows/ci.yml` validates pull requests and pushes to `main` on Ubuntu and macOS with Node 20, 22, and 24. `.github/workflows/nodejs-package.yml` reuses that validation for release events before its release-only publish job. Each validation job runs `npm ci`, `npm test`, module checks, Bun setup/version verification, and the installed-package smoke. Linux Node 24 additionally runs whole-runtime coverage. Local validation does not establish remote CI results or macOS runtime parity.

Fixture-backed setup tests are offline and do not prove that live ECC or gstack upstream services are available. The migrated CLI tests assert command semantics, status, safety, and no-write behavior; the files under `test/fixtures/cli-baseline/` are historical evidence only, not active raw-byte gates. Cancellation/retry and rollback/recovery are covered by behavioral tests rather than claims of raw-byte parity.

Do not include credentials in tests, fixtures, logs, or documentation. Restore process-global environment, TTY, and console state after tests, including failure paths.
