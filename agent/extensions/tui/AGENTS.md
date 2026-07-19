# tui

## Purpose

Shared TUI component library for Pi extensions. Provides reusable UI components via a `globalThis.__pi_tui` bridge so sibling extensions avoid duplicating rendering code. Replaces the default editor with a boxed editor with animated sweep during agent turn and spinner suppression.

## Ownership

- `ThinkingComponent` — renders thinking blocks with a `┃ ` prefix line in grey
- `patchThinkingRendering()` — monkey-patches `AssistantMessageComponent.prototype.updateContent` to use `ThinkingComponent` instead of native italic Markdown for thinking blocks. Runs at extension load time in `index.ts`. Falls back gracefully if pi modules are unavailable.
- `BoxedEditor` — extends `CustomEditor` to replace the default editor border with a boxed one: ╭─╮ top, `│ ❯ content... │`, ╰─╯ bottom. White `│` side borders and `╭╮╰╯` corners, grey `❯` prompt, white content text. During agent turn, a red `━` block blinks at the 3rd dash from the left (counting the corner as position 0), toggling every 250ms (60ms tick). On idle, static `╭─╮` with just `❯` (no `↑`). Spinner is suppressed while animation is active.
- `registerBar(pi)` — lifecycle hooks (`session_start`, `before_agent_start`, `agent_end`, `turn_start`, `session_shutdown`) that register `BoxedEditor` via `ctx.ui.setEditorComponent()`, drive the animation interval, and hide/restore the spinner.
- `QuestionsComponent` — interactive multi-choice question dialog (moved from `questions/`)
- `normalizeLabel`, `buildQuestions`, `formatAnswer`, `makeResult`, `formatAnswerSummary` — question utility functions (re-exported for tool integrations). `formatAnswerSummary(questions, result)` builds the post-answer text (header + per-question lines, no UI prefix).
- `memory.ts` — shared memory-tool UI: `renderMemorySearchCall` (bold `memory_search` call line) and `renderMemorySearchResult` (collapsed `X found` / `↳ <first>` / `└ N more, ctrl+o to expand`, expanded full output). Consumed by pi-hermes-memory via the bridge.
- `tools/rendering.ts` — shared Component primitives for per-tool renderers. `glowLabel(theme, toolName, args)` (greyish-white bold toolTitle line, args in muted), `outputArrowLine(theme, label, lineCount)` (`↳` muted summary), `diffLine(theme, raw)` (colorizes `+` via toolDiffAdded + toolSuccessBg, `-` via toolDiffRemoved + toolErrorBg, context via toolDiffContext), `separator(theme, width)` (full-width border-colored `─` line), `truncate(lines, max)` (collapse to N lines + `… (K more lines, ctrl+o to expand)`), `numberedLines(theme, lines, start)` (muted 4-wide gutter for read/write), and `group(children)`/`unifiedBlock(...)` (compose the unified glow + ↳ + separator block). All return pi-tui `Component` objects (`render(width): string[]`, `invalidate()`). Foundation for `tools/{read,write,edit,bash,ls,grep,find,powershell}.ts`.
- `tools/{read,write,edit,bash,ls,grep,find,powershell}.ts` — per-tool render modules. Each exports `NAME`, `renderCall(args, theme, ctx)` and `renderResult(result, {expanded}, theme, ctx)` producing the unified block: collapsed = `glowLabel` + `outputArrowLine` (`↳` muted summary with count) + `separator`; expanded (ctrl+o) = full content (`diffLine` for edit, `numberedLines` for read/write, raw `truncate` for bash/ls/grep/find/powershell with a `ctrl+o` hint when over budget). `renderResult` reads captured output from `details._fullOutput`.
- `tools/execute.ts` — combined `Execute` tool, registered under the aliases `bash`, `pwsh`, `powershell` (all three route to this single implementation; the legacy separate `bash`/`powershell` renderers are superseded). Accepts `{ command: string, shell?: "pwsh" | "bash" }`. Shell resolution: explicit `shell` param overrides the platform default; default is `pwsh` on `win32`, `bash` elsewhere. Selection lives in the pure, injectable helpers `defaultShellFor(platform)` and `selectShell(shell, platform)` for deterministic unit testing. Spawning mirrors existing implementations: pwsh → `powershell.exe -EncodedCommand <utf16le base64>` (mirror of `extensions/powershell/index.ts`); bash → delegates to the host `createBashTool` factory. `renderCall`/`renderResult` use the unified format with a `Execute` glow label and record the chosen `shell` in `details.shell` (shown as `(pwsh)`/`(bash)` in the summary). `registerExecuteTool(pi)` registers all three aliases.
- `tools/register.ts` — `registerToolRenderers(pi)`: re-registers `read/write/edit/ls/grep/find` with the unified per-tool renderers (delegating `execute` to the host `create*Tool` factories) and calls `registerExecuteTool(pi)` so `bash`/`pwsh`/`powershell` route to the combined Execute tool. Results are wrapped to expose `details._fullOutput`. Called from `index.ts` after `registerBar`.

## Local Contracts

- **Bridge**: Exports via `globalThis.__pi_tui` — other extensions `getTui()` at runtime rather than importing TypeScript modules
- **Extension load order**: `tui` must load before `questions` (and any other extension that consumes the bridge)
- **BoxedEditor**: Extends `CustomEditor` from `@earendil-works/pi-coding-agent`, created with default `paddingX=0`. The base `Editor.render()` with `paddingX=0` draws NO side borders — only full-width `─` top/bottom lines with centered text (leading space reserved for cursor). `BoxedEditor.render(width)` calls `super.render(width-2)` then wraps output: top `─`→`╭─╮`, each middle text line gets `│` rails with `❯` injected on line 1 (preserving base ANSI: cursor reverse-video, text color), bottom `─`→`╰─╯`. Autocomplete lines (after bottom border) are left untouched.
- **Animation lifecycle**: Interval runs at 60ms; a fixed red `━` block blinks at dash index 2 (`BLINK_POS`), toggled every `BLINK_TICKS` ticks (~250ms). `ctx.ui.setWorkingIndicator({ frames: [] })` hides the default spinner during animation. Restored on `agent_end`.

## Work Guidance

- Keep individual components in their own files (thinking.ts, bar.ts, questions.ts, patch-thinking.ts)
- The `index.ts` aggregator builds the `__pi_tui` bridge and calls `registerBar(pi)` and `patchThinkingRendering()`
- New components should register on the bridge and add a re-export in `index.ts`
- Memory UI (`renderMemorySearchCall`, `renderMemorySearchResult`) lives in `memory.ts` and is exposed on the bridge; the pi-hermes-memory extension calls it via `getTui()` rather than owning the rendering.
- `patchThinkingRendering()` uses static ESM imports (same as `bar.ts`) to access `AssistantMessageComponent`, `Markdown`, `Text`, `Spacer` from pi-coding-agent/pi-tui root exports. `require()` must NOT be used (ESM-only, throws ERR_REQUIRE_ESM and silently disables the patch). Subpath imports into pi-coding-agent internals (e.g. `.../theme/theme.js`) are blocked by its `exports` map and fail to load. Debounced via `__thinkingPatched` flag.
- `ThinkingComponent` renders with a `┃ ` pipe prefix on every line (grey, italic, monotone). Markdown is rendered with `paddingX=0` and the pipe is prepended as part of the prefix so lines align flush against the pipe (no double-indent). `outputPad` spaces are added before the pipe to match sibling text indentation.

## Verification

- Ensure `__pi_tui` bridge is available after tui extension loads
- Questions extension should function identically as before the refactor
- Thinking blocks should show `┃ ` prefix on each line
- Editor should show boxed border with `↑❯` when idle, `━` sweep and `❯` during agent turn
- Default spinner should not appear during agent turn

## Child DOX Index

None
