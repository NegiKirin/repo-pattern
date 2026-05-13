# OpenSpec template guide

Use this guide when turning a repository into an OpenSpec-ready project.

## Goal

Keep `openspec/config.yaml` short and decision-oriented.
Do not turn it into full documentation.
Put only the information that helps proposal, spec, design, and task generation stay aligned with the repository.

## How to fill `openspec/config.yaml`

### `context`

Use `context` to describe stable project facts:

- what the project is
- what stack it uses
- where the main source code lives
- where tests live
- the main architectural boundaries
- important safety constraints

Good examples:

- runtime and framework
- main source folder
- test folder
- public API boundary
- worker or queue boundary
- rules for secrets or destructive actions

Avoid:

- recent task history
- temporary implementation details
- long background explanations
- speculative future architecture

### `rules.proposal`

Use this section to constrain change proposals.

Include things like:

- change classification
- required non-goals
- affected components that must be named explicitly

### `rules.specs`

Use this section to shape spec quality.

Include things like:

- golden-path scenarios
- important edge cases
- partial-failure cases
- required fields in responses or errors
- validation and confirmation requirements for sensitive actions

### `rules.design`

Use this section to protect the architecture.

Include things like:

- where changes should live
- which boundaries must stay intact
- when abstraction is acceptable
- how important failure modes should be represented

### `rules.tasks`

Use this section to keep implementation work practical.

Include things like:

- small verifiable steps
- required test commands
- limits on unnecessary config or docs changes

## Recommended workflow

### Explore a change

```text
/openspec-explore
```

Use this when the request is still fuzzy and you need to clarify requirements, constraints, or tradeoffs.

### Propose a change

```text
/openspec-propose
```

Use this when the repo needs a formal proposal with structured artifacts before implementation.

### Implement from a change

```text
/openspec-apply-change
```

Use this when proposal, design, and tasks are already defined and you want to execute the work.

### Archive a completed change

```text
/openspec-archive-change
```

Use this when the implementation is done and the change record should be finalized.

## Template maintenance rules

- Keep `openspec/config.yaml` generic enough to reuse across similar repos.
- Replace all placeholder values like `<...>` with real project data when initializing a new repository.
- Remove lines that do not apply.
- Prefer short, explicit wording over broad policy language.
- Update the file when the architecture or safety model changes materially.

## Suggested initialization steps for a new repo

1. Copy the template repo.
2. Edit `openspec/config.yaml`.
3. Update `.mcp.json` for the MCP servers you actually use.
4. Review `skills-lock.json` only if you intend to change skill sources.
5. Run `/openspec-explore` or `/openspec-propose` for the first non-trivial change.
