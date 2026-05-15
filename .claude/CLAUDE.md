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

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

<!-- USE MCP START -->
## MCP filesystem

Use the MCP filesystem server for file and directory operations when it is available.
Prefer read-only MCP filesystem tools over shell commands for inspection tasks.
Use destructive MCP filesystem tools only when the change is intentional and scoped to the user's request.

### Read-only tools
- `read_file`
- `read_text_file`
- `read_media_file`
- `read_multiple_files`
- `list_directory`
- `list_directory_with_sizes`
- `directory_tree`
- `search_files`
- `get_file_info`
- `list_allowed_directories`

### Destructive tools
- `write_file`
- `edit_file`
- `create_directory`
- `move_file`

### Usage guidance
- Use `read_text_file` for normal text files.
- Use `read_file` only when needed for broad compatibility with existing MCP workflows.
- Use `read_media_file` for images or audio.
- Use `read_multiple_files` when comparing or reviewing several files at once.
- Use `list_directory`, `list_directory_with_sizes`, or `directory_tree` to inspect structure before editing.
- Use `search_files` to find files by name or glob pattern.
- Use `get_file_info` when metadata matters more than content.
- Use `list_allowed_directories` before accessing unfamiliar paths.
- Prefer `edit_file` over `write_file` when updating an existing file.
- Use `write_file` for new files or full rewrites only.
- Use `create_directory` before writing into a missing folder.
- Use `move_file` for renames or relocations instead of copy-delete patterns.
- Confirm intent before destructive operations that may overwrite or relocate user work.

<!-- USE MCP END -->