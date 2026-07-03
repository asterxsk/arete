# compactui

## Purpose
Re-registers built-in tools with compact visual rendering (single-line calls, expandable results) and truncates large tool outputs for LLM context efficiency.

## Ownership
- Tool rendering: `renderCall` and `renderResult` for all built-in tools
- Output truncation for bash/powershell/run_command (5-line limit)
- Message spacing: one uniform blank line above every message/tool render output; no other custom gaps

## Local Contracts
- Patches tools: `read`, `write`, `edit`, `bash`, `ls`, `grep`, `find` (via explicit re-registration in `index.ts`)
- Special cases in generic patcher (`patch-tools.ts`): `questions`, `pwsh/powershell`, `run_command`, `web_search`, `web_fetch/fetch_content`, `manage_task`, `schedule`
- Hidden tools: `todo`, `grep`, `find`, `ls` are completely suppressed from rendering and spacing (no visual output, no blank lines)
- All other tools (`subagent`, `memory`, `memory_search`, `session_search`, `video_extract`, `skill_manage`, `plan`, etc.) use the generic fallback in `patchTool()`
- Sets `__pi_betterui_enabled` global flag for other extensions
- Exposes `__pi_patchTool` globally as fallback for fresh pi objects
- Hooks: `tool_call` (unknown tool detection), `tool_result` (output truncation)
- `KNOWN_TOOLS` set tracks all registered Pi tools: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`, `web_search`, `web_fetch`, `fetch_content`, `get_search_content`, `run_command`, `manage_task`, `schedule`, `subagent`, `todo`, `powershell`, `questions`, `video_extract`, `skill_manage`, `plan`, `memory`, `memory_search`, `session_search`
- Auto-hide notifications: `ctx.ui.notify()` is patched to automatically clear after 3 seconds (only in TUI mode)

## Work Guidance
- Hidden tools: `HIDDEN_TOOLS` set (currently `todo`) — components for these tools are skipped entirely in `chatContainer.addChild`, preventing both rendering and spacing. The `ToolExecutionComponent.render` also returns `[]` for hidden tools as a fallback
- Uniform spacing: every non-blank component added to `chatContainer` gets exactly one blank line above it; this is enforced by a persistent `chatContainer.addChild` wrapper installed on the first `addMessageToChat` call. The wrapper holds back any explicit Spacer/empty-line component (so explicit pi spacers are reused instead of doubled) and otherwise injects a fresh `Spacer(1)` only when the container already has content. This covers all addChild code paths: `addMessageToChat` (user/assistant/tool/bash/custom), `message_start` (streaming `AssistantMessageComponent`), `message_update` (tool components), toggle-thinking rebuild, `showStatus`, error messages
- Leading-blank stripping: `ToolExecutionComponent`, `BashExecutionComponent`, and `CustomMessageComponent` each internally added a `Spacer(1)` as their first child (or a leading `""` in render output), doubling the blank line above them after the proactive spacer was installed. Their `render` methods are now patched to strip any leading blank lines so the proactive `chatContainer.addChild` spacer remains the single source of inter-message spacing
- Thinking-block spacing: when the first content of an assistant message is a thinking block, no internal separator is added inside `contentContainer` before the `ThinkingBlock`. The proactive chatContainer spacer is already the 1-line gap from the previous chat line. Subsequent thinking blocks (after text or another thinking block) still get a `line("")` separator inside `contentContainer`
- Auto-hide notifications: in TUI mode, `ctx.ui.notify()` is patched to automatically clear after 3 seconds. Each new notification resets the timeout, so rapid notifications won't flicker. Only non-empty messages trigger the auto-hide timer

- Zero-gap spinner-to-widget: `InteractiveMode.prototype.renderWidgetContainer` is patched to pass `leadingSpacer=false` so aboveEditor widgets (todos, etc.) sit flush against the spinner with no blank line between them
- One-line gap above spinner: relies on the Loader's natural `["", ...text]` render output (NOT overridden) so the spinner gets exactly 1 blank line above it from the chat edge while keeping the spinner-to-todos gap at 0
- Collapsed view shows two lines:
  1. `tool [args] (ctrl+o to expand)` — orange tool name, truncated args
  2. `⎿ summary (N lines)` — dimmed summary with line/task count (or `⎿ failed tool call` on error)
- Unknown tool errors render as `toolName tool not found` with orange tool name and error-colored text (via `_isUnknownTool` flag)
- Summary texts by tool:
  - `read`: "read tool output"
  - `write`: "file written"
  - `edit`: "Added N lines, removed M lines" (parsed from diff)
  - `bash`, `pwsh`, `run_command`, `ls`, `grep`, `find`: "read terminal output"
  - `web_search`: "read search results"
  - `web_fetch`/`fetch_content`: "read web page"
  - `manage_task`: "checked tasks"
  - `schedule`: "scheduled tasks"
- Expanded result shows up to 50 lines with duration footer
- Edit tool renders diff with +/- color coding
- Truncation applies to tools in `TRUNCATED_TOOLS` set when output > 5 lines
- Patches both instance and prototype `registerTool` to catch all extensions

## Verification
- Run any tool (bash, read, etc.) — verify compact two-line display
- Press ctrl+o — verify expanded view with output
- Run bash with >5 lines output — verify truncation message
- Verify thinking blocks render with proper styling
- Verify notifications auto-hide after 3 seconds (e.g., run `/todos` when no todos exist)

- Verify one blank line above every chat message and every tool output
- Trigger an assistant message that runs a tool (e.g. `bash ls`) and verify exactly 1 blank line separates the assistant message from the tool execution box, and 1 blank line separates the tool execution from the next message
- Trigger an assistant response that begins with a thinking block (e.g. ask a question that requires reasoning) and confirm there is exactly **one** blank line between the previous chat line and the first line of the thinking block — not two
- Verify the gap line is not indented by the status-dot patch
- Trigger the agent spinner (run any tool, e.g. `bash ls`) and confirm: (a) exactly **one** blank line between the last chat line and the spinner line, (b) **no** blank line between the spinner and the todo overlay (or other aboveEditor widget) — 1-line gap above spinner, 0-line gap below
- After an assistant message streams in, verify there is exactly one blank line between the previous content (chat/tool/streaming end) and the new assistant message — for both the freshly-streamed case and the rebuilt-after-toggle-thinking case

## File Structure
- `index.ts` — Main entry: imports modules, wires event hooks, re-registers read/write/edit/bash/ls/grep/find tools
- `rendering.ts` — Shared rendering primitives: `line`, `spacer`, `noOp`, `orange`, `compactCall`, `compactSummary`, `compactFailed`, `expandedBox`, `diffExpandedBox`, `wrapWithPrefix`, `wrapDiffLine`, `splitAnsiPrefix`, `colorizeDiffLine`, `captureResult`
- `patch-tools.ts` — Tool patching: `patchTool` function, `KNOWN_TOOLS`, `TRUNCATED_TOOLS`, special-case handlers for questions/powershell/run_command/web_search/web_fetch/manage_task/schedule, generic fallback for all other tools
- `assistant-footer.ts` — `initAssistantFooter`: appends "✻ Worked for Xs" to assistant messages
- `prompt-ui.ts` — `initPromptUi`: patches UserMessageComponent with dark background and ❯ prefix
- `tool-status-dot.ts` — `initToolStatusDot`: animated blinking status dot for running tools

## Child DOX Index
None