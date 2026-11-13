# Architecture

## Module map

```text
bin/repo-pattern.mjs       executable wrapper
src/                       runtime implementation
  cli.mjs                  parsing, dispatch, package-root resolution, exit handling
  setup/                   setup orchestration, provisioning, settings, permissions
  ecc/                     ECC rules, source, manifests, and synchronization
  gstack/                  gstack setup, runtime, upstream, and documents
  ui/                      prompts, wizard, interaction, and progress adapters
  shared/                  filesystem and Git progress primitives
  vendor/                  vendored runtime assets and licenses
  audit.mjs, doctor.mjs,
  cleanup.mjs, mcp.mjs,
  skills.mjs, herdr.mjs,
  project-detect.mjs       runtime feature modules
test/                      native node:test contract tests and fixtures
scripts/                   coverage, module checks, characterization, and self-check tooling
```

The npm package ships `bin/repo-pattern.mjs`, `src/`, the required `.claude.example/` templates, `mcp/servers/`, `.repo-pattern.example.json`, runtime documentation, README, and licenses. The explicit `package.json` `files` allowlist excludes tests, fixtures, development scripts, internal plans, and CI workflows. `src/vendor/` is runtime content and retains its vendored license.

## Dependency direction

`bin/repo-pattern.mjs` only invokes `src/cli.mjs`. The CLI resolves assets from the package source root rather than the caller's current working directory and dispatches feature functions.

Feature modules own execution and receive output or progress adapters where presentation is required. `src/ui/` owns Ink, React, prompts, wizard behavior, TTY decisions, and progress rendering. Setup and provisioning do not import Ink or React, inspect TTY state, ask questions, or create renderers. Provisioning executes resolved selections and owns backup, rollback, recovery, and result boundaries.

`src/shared/` stays below application and feature modules. ECC and gstack are independent feature groups; neither imports the other. Runtime modules may use templates, MCP definitions, and vendored assets through package-root paths. Tests and scripts exercise the runtime but are not runtime dependencies and are not packaged.

## Verification

Run focused native tests while iterating:

```bash
node --test --test-concurrency=1 test/cli/cli-contract.test.mjs
node --test --test-concurrency=1 test/setup/setup-contract.test.mjs
node --test --test-concurrency=1 test/ecc/ecc-contract.test.mjs
node --test --test-concurrency=1 test/gstack/gstack-contract.test.mjs
node --test --test-concurrency=1 test/ui/ui-contract.test.mjs
node --test --test-concurrency=1 test/shared/shared-contract.test.mjs
```

Run the repository gates before submitting:

```bash
npm test
npm run test:coverage
npm run check:module-limits
```

Coverage includes every JavaScript runtime file under `src/` and `bin/`, including unloaded files. The minimum is 80% for lines, functions, and branches. Changed-line coverage remains a separate gate. Do not use ignore pragmas or weaken validators.

Package verification requires a real `npm pack`, installation outside the checkout, execution from a different working directory, help/version checks, fixture-backed offline setup, runtime template/MCP/vendor resolution, and archive inspection. `npm pack --dry-run` alone is insufficient.

## CI and evidence boundaries

`.github/workflows/ci.yml` validates pull requests and pushes to `main` across `ubuntu-latest` and `macos-latest` with Node 20, 22, and 24. `.github/workflows/nodejs-package.yml` reuses that validation for release events before its release-only publish job. The validation uses `npm ci`, exercises Bun 1.4.3, runs tests and module checks, performs installed-package smoke, and runs coverage on Linux Node 24. This repository has not used local commands to claim remote CI execution.

Fixture-backed tests intentionally avoid live ECC/gstack upstream downloads. They verify offline behavior only. Raw parity evidence compares stdout and stderr as separate `Buffer` values under controlled conditions. Linux help, version, invalid-command, and dry-run parity is established; cancellation/retry and rollback/recovery parity is not established because no pre-refactor raw baselines exist. macOS runtime parity is unverified without a macOS execution environment.
