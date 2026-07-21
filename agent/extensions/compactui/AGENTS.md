# compactui

## Purpose
Re-registers built-in tools with template-based compact visual rendering (template-based collapsed/expanded displays) and truncates large tool outputs for LLM context efficiency.

## Ownership
- Tool rendering: template dispatch via `patchTool()` in `patch-tools.ts`
- Output truncation for bash/powershell/run_command (5-line limit)
- Message spacing: one uniform blank line above every message/tool render output; no other custom gaps

## Local Contracts
- All tools use centralized template dispatch in `patch-tools.ts` — no explicit re-registrations
- Templates: `standardTemplate` (most tools), `writeTemplate`, `editTemplate`, `executeTemplate` (bash/pwsh/shell), `readBatchTemplate`, `subagentTemplate` (in `rendering.ts`)
- Tools with their own rendering (skipped): `subagent` (Complex `CompactToolBox` in subagents extension), `questions` (kept as-is per user request)
- Hidden tools: `todo`, `grep`, `find`, `ls` are completely suppressed from rendering and spacing (no visual output, no blank lines)
- Sets `__pi_betterui_enabled` global flag for other extensions
- Exposes `__pi_patchTool` globally as fallback for fresh pi objects
- Hooks: `tool_call` (unknown tool detection), `tool_result` (output truncation)
- `KNOWN_TOOLS` set tracks all registered Pi tools
- Auto-hide notifications: `ctx.ui.notify()` is patched to automatically clear after 3 seconds (only in TUI mode)

## Work Guidance
- Hidden tools: `HIDDEN_TOOLS` set (currently `todo`, `grep`, `find`, `ls`) — components for these tools are skipped entirely
- Uniform spacing: every non-blank component added to `chatContainer` gets exactly one blank line above it
- Template collapsed view format:
  - Standard: `toolname N unit` (orange) `↳ first line` (dim)
  - Execute: `execute {bash} cmd` (orange) `↳ first 5 output lines` (white)
  - Write: `write path` (orange) `↳ N lines` `1 content line` `...`
  - Edit: `edit path` (orange) `↳ Added N, removed M` `+/- colored diff lines`
- Expanded view shows up to 40 lines with duration footer
- Edit tool renders diff with +/- color coding
- Truncation applies to tools in `TRUNCATED_TOOLS` set when output > 5 lines
- Patches both instance and prototype `registerTool` to catch all extensions

## File Structure
- `index.ts` — Main entry: imports modules, wires event hooks, generic patcher (no explicit tool re-registrations)
- `rendering.ts` — Template factories: `standardTemplate`, `writeTemplate`, `editTemplate`, `executeTemplate`, `readBatchTemplate`, `subagentTemplate`
- `patch-tools.ts` — Template dispatch: `patchTool` function, routes each tool name to the appropriate template
- `assistant-footer.ts` — `initAssistantFooter`: appends "✻ Worked for Xs" to assistant messages
- `prompt-ui.ts` — `initPromptUi`: patches UserMessageComponent with dark background and ❯ prefix
- `tool-status-dot.ts` — `initToolStatusDot`: animated blinking status dot for running tools