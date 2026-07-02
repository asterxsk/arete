# Statusline Extension

## Purpose
Renders a status footer in the TUI showing:
  Line 1: `provider × model $cost` (left) / `↑input ↓output ※ tokens/window` (right)
  Line 2: `~/path` (left) / `branch (worktree) filechanges` (right)
Also provides an Alt+C shortcut to compact context when usage exceeds 90%.

## Ownership
- `index.ts` — status line footer rendering and compact shortcut
- Visual status footer display area
- Git branch/worktree detection via `.git` HEAD parsing
- Token I/O coloring: input = blue, output = purple
- Context usage color thresholds (safe=white, 30%+=orange, 70%+=gold, 90%+=red with ●)

## Local Contracts
- Registers footer via `ctx.ui.setFooter()` during `session_start`
- Registers Alt+C shortcut via `pi.registerShortcut("alt+c", ...)`
- Listens to events: `session_start`, `model_select`, `message_update`, `message_end`, `session_compact`
- Exports: `default` function only
- Depends on `@earendil-works/pi-tui` for `truncateToWidth`, `visibleWidth`
- Reads `__pi_filechanges_counts` from `globalThis` bridge (set by the `filechanges/` extension)
- Detects git branch and worktree by walking up from cwd, reading `.git` HEAD/gitdir files

## Work Guidance
- Line 1 layout: price moves to right of model name; token I/O moved before context
- Token colors: `C.blue` for input (↑), `C.purple` for output (↓)
- Context percentage determines color: safe (<30%) white, warm (30-70%) orange, hot (70-90%) gold, critical (>90%) red with ● indicator
- No gradient bar — just `※ tokens/window` text display
- Git worktree detection: if `.git` is a file containing `gitdir:`, the worktree name is extracted from the linked gitdir path
- File changes count shown after git branch info on line 2
- Throttle timer at 120ms prevents excessive re-renders during streaming

## Verification
- Run `demo()` function (uncomment at bottom) to test helper functions
- Visual check: footer shows in TUI with provider/model/cost/price/tokens/context
- Visual check: git branch + worktree shown on line 2 before file changes
- Test Alt+C: context must be above 90% to trigger compact

## Child DOX Index
None
