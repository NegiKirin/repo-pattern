# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

<!-- BaseRules:start -->
## 5. Safe File Editing

- Before editing an existing file, read its current contents from disk.
- Use `Edit` for partial changes to existing files.
- Use `Write` without a prior `Read` only when creating a new file that does not exist.
- Before overwriting an existing file with `Write`, read it first and preserve unrelated content.
- Never use shell redirection, `sed -i`, `perl -i`, or another command to bypass the Read/Edit workflow.
- Make the smallest possible change. Do not reformat or clean up unrelated content.
- If the target contains unexpected content or user changes, stop and ask before editing.
- Never overwrite, delete, rename, or replace files unless explicitly requested.
- Never revert user changes with `git checkout`, `git restore`, `git reset`, or `git clean` unless explicitly requested.
- Before editing a Git-tracked file, inspect its working-tree state when it may contain uncommitted changes.
- After every edit, inspect `git diff -- <file>` and confirm that it contains only the requested changes.
- If the diff is unexpected, stop and report it instead of making further edits.
<!-- BaseRules:end -->
