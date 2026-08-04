# Workflow

`repo-pattern` is setup infrastructure only.

After setup, use **ECC** as the workflow layer inside Claude Code.

This document explains the recommended ECC command flow for common development situations. It is intentionally practical: start with the default flow, then choose a deeper workflow only when the task needs more structure.

---

## 1. Default ECC workflow

Use this for most normal coding tasks.

```text
/plan <task>
→ confirm the plan
→ implement or /tdd
→ /build-fix if build/type errors appear
→ /code-review
→ /verify
→ /save-session or /learn-eval
```

### When to use

Use the default flow for:

- small or medium features;
- scoped refactors;
- normal bug fixes;
- changes that touch multiple files;
- tasks where you want a plan before editing.

### Why this is the default

`/plan` is the safest entrypoint because it forces the assistant to restate requirements, inspect relevant code, identify risks, and wait for confirmation before implementation.

Use `/tdd` when the task should be implemented test-first. If the task is simple and already well understood, implementation can happen after `/plan` without a separate PRD flow.

---

## 2. Quick decision guide

| Situation | Recommended workflow |
|---|---|
| Feature is clear and small/medium | `/plan` → implement or `/tdd` → `/code-review` → `/verify` |
| Feature idea is unclear | `/plan-prd` → `/plan` → implement or `/tdd` → `/code-review` → `/verify` |
| Feature is large or multi-phase | `/prp-prd` → `/prp-plan` → `/prp-implement` → `/code-review` |
| Build/type errors are the main issue | `/build-fix` → `/verify` |
| Code was just written | `/code-review` → fix findings → `/verify` |
| Reviewing a PR | `/code-review <pr-number-or-url>` |
| Need current library/API docs | `/docs <library>` → implement/update → `/update-docs` |
| Context is getting large | `/context-budget` → `/checkpoint` |
| Ending a long session | `/save-session` or `/learn-eval` |
| Resuming previous work | `/resume-session` |
| Multi-agent advanced work | `/multi-plan` → `/multi-workflow`, only if the external runtime is available |

---

## 3. Lean PRD workflow

Use this when the feature idea is not clear enough for implementation.

```text
/plan-prd <feature idea>
→ review generated PRD
→ /plan .claude/prds/<name>.prd.md
→ confirm the plan
→ implement or /tdd
→ /code-review
→ /verify
```

### When to use

Use this flow when you need to clarify:

- the user problem;
- success criteria;
- MVP scope;
- non-goals;
- open questions;
- product behavior.

### Rule

`/plan-prd` should capture **what** and **why**.

Implementation decomposition should happen later in `/plan`.

---

## 4. Deep PRP workflow

Use this when the work is large, risky, multi-phase, or needs a self-contained implementation artifact.

```text
/prp-prd <feature idea>
→ /prp-plan .claude/PRPs/prds/<name>.prd.md
→ /prp-implement .claude/PRPs/plans/<name>.plan.md
→ /code-review
→ /verify
→ /prp-pr or normal PR handoff
```

### When to use

Use PRP flow for:

- large feature development;
- cross-cutting architectural work;
- multi-step migrations;
- work that needs explicit codebase pattern discovery;
- tasks that another agent may implement from the plan;
- changes where validation commands and acceptance criteria must be captured before coding.

### Rule

`/prp-plan` should capture enough codebase knowledge that `/prp-implement` can execute without rediscovering the same context repeatedly.

---

## 5. Bug fix workflow

Use this when there is a reproducible bug.

```text
/plan <bug + reproduction>
→ create or identify failing check
→ implement minimal fix
→ /build-fix if build/type errors appear
→ /verify
→ /code-review
```

### Rules

- Prefer reproducing the bug before fixing it.
- Keep the fix surgical.
- Do not refactor unrelated code.
- If the first hypothesis fails, revise the plan instead of stacking random fixes.

---

## 6. Build/type error workflow

Use this when the main problem is a broken build, type-check, lint, or compile step.

```text
/build-fix
→ /verify
→ /code-review
```

### Rules

- Fix one error group at a time.
- Re-run the relevant build/type command after each meaningful fix.
- Stop and reassess if the same error repeats or the fix requires architectural changes.
- Do not perform unrelated cleanup during build repair.

---

## 7. Code review workflow

Use this after implementation, before final handoff.

### Local review

```text
/code-review
→ fix HIGH/CRITICAL findings
→ /verify
```

### PR review

```text
/code-review <pr-number-or-url>
→ fix requested changes
→ /verify
→ PR handoff
```

### Review focus

Review should check:

- correctness;
- security;
- maintainability;
- hidden edge cases;
- unnecessary complexity;
- test coverage;
- consistency with existing project patterns.

---

## 8. Verification workflow

Use verification after implementation, build fixes, review fixes, and before handoff.

```text
/verify
```

If `/verify` is not available or not suitable, run the project’s explicit checks manually:

```text
build
lint
type-check
test
format check
integration/e2e checks when relevant
```

### Important distinction

`/quality-gate` should not be treated as a full replacement for verification. It is useful as a quality/formatting gate, but full verification should still include the project’s actual build, test, lint, and type-check commands.

---

## 9. Docs and research workflow

Use this when the task depends on current library, framework, API, or platform behavior.

```text
/docs <library-or-api>
→ implement or update docs
→ /update-docs if project docs changed
→ /code-review if code changed
→ /verify if code changed
```

### Rules

- Use current docs before making assumptions about APIs.
- Prefer Context7/MCP documentation lookup when available.
- Do not rely on outdated memory for fast-changing libraries.

---

## 10. Session and context workflow

Use this for long-running work.

### Before context gets too large

```text
/context-budget
→ /checkpoint
```

### End of session

```text
/save-session
```

or:

```text
/learn-eval
```

### Resume

```text
/resume-session
```

### Rules

- Save important decisions before compacting or ending a session.
- Use checkpoints before risky changes.
- Use `/learn-eval` when a session produced reusable lessons or project patterns.

---

## 11. Advanced multi-agent workflow

Use only when the required runtime is available.

```text
/multi-plan <task>
→ /multi-workflow <task>
→ /multi-execute or specialized multi-agent command
→ /code-review
→ /verify
```

### When to use

Use this only for:

- large tasks that benefit from parallel planning/execution;
- backend/frontend split work;
- research + implementation split work;
- tasks where external multi-agent runtime is installed and configured.

### Rule

Do not make multi-agent workflow the default. It is an advanced path, not the normal path.

---

## 12. Recommended command sequence by task type

### A. Small feature

```text
/plan <feature>
→ confirm
→ implement
→ /code-review
→ /verify
```

### B. Test-first feature

```text
/plan <feature>
→ confirm
→ /tdd
→ /code-review
→ /verify
```

### C. Product idea

```text
/plan-prd <idea>
→ /plan .claude/prds/<name>.prd.md
→ confirm
→ /tdd or implement
→ /code-review
→ /verify
```

### D. Large feature

```text
/prp-prd <idea>
→ /prp-plan .claude/PRPs/prds/<name>.prd.md
→ /prp-implement .claude/PRPs/plans/<name>.plan.md
→ /code-review
→ /verify
```

### E. Bug fix

```text
/plan <bug + reproduction>
→ implement minimal fix
→ /build-fix if needed
→ /verify
→ /code-review
```

### F. Build broken

```text
/build-fix
→ /verify
→ /code-review
```

### G. Review-only

```text
/code-review
→ fix findings
→ /verify
```

### H. Documentation/library research

```text
/docs <library>
→ implement/update docs
→ /update-docs
→ /verify if code changed
```

---

## 13. Project policy for repo-pattern initialized projects

A project initialized by `repo-pattern` should stay minimal.

Do not add local Claude runtime surfaces by default:

```text
.claude/skills/
.claude/commands/
.claude/hooks/
.claude/scripts/
.claude/rules/
```

ECC should provide the workflow surface through plugin-managed runtime.

`repo-pattern` provides:

```text
minimal Claude settings
generated .mcp.json and local Graphify code graph
MCP profiles with Graphify
ECC setup flow
audit/migrate/cleanup/doctor tools
```

---

## 14. Practical default

When unsure, use this:

```text
/plan <task>
→ confirm
→ implement or /tdd
→ /code-review
→ /verify
```

Use a deeper PRD/PRP workflow only when the task requires it.
