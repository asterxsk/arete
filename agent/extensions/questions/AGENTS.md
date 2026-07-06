# questions

## Purpose
Registers a `questions` tool for asking the user structured multi-choice questions with optional ASCII sketches and a custom-answer fallback, rendered as an interactive TUI dialog.

## Ownership
- `questions` tool registration and execution
- Interactive TUI component (`QuestionsComponent`) with tabbed multi-question support
- Question schema validation (TypeBox)
- Answer collection (preset options + free-text custom answers)
- Compact result rendering for betterUI

## Local Contracts
- **Tool**: `questions` — accepts `{ questions: Question[] }`, returns answers
- **Question schema**: `id`, `label` (tab), `prompt`, `sketch` (optional ASCII), `options` (optional, up to 10), `isMultiSelect` (optional boolean)
- **Answer schema**: `questionId`, `value`, `label`, `source` ("option" | "custom") (returns multiple answers if isMultiSelect=true)
- **Result schema**: `QuestionsResult` with `questions`, `answers`, `cancelled`, `submitted`
- **TUI component**: `QuestionsComponent` — tabs (Tab/←→), options (↑↓), Enter to select (or Done to advance), Esc to cancel
- **Checkboxes**: Space/Enter toggles options if `isMultiSelect`, unchecked is `□`, checked is `■`
- **Custom answer**: Appended as last option ("Type your own answer")

## Work Guidance
- Question IDs must be unique per call — validated at runtime
- Tab labels are auto-normalized to 1-2 words, max 16 chars
- Multi-question mode adds a "submit" tab for review before final submit
- Single-question mode auto-submits on selection
- `renderShell: "self"` — tool manages its own shell rendering
- Sketch lines have `[` and `]` stripped for display
- **Spinner suppression**: Before entering `ctx.ui.custom()`, the spinner's `setWorkingMessage` is replaced with a no-op to prevent its 120ms ticks from clashing with the custom component's terminal rendering. Restored in `finally` block.

## Verification
- Call the tool with a single question, verify option selection works
- Call with multiple questions, verify tab navigation and review screen
- Test custom answer input via "Type your own answer"
- Verify cancel (Esc) returns `cancelled: true`
- Check compact rendering in betterUI mode

## Child DOX Index
None
