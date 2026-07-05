# artifacts

## Purpose
Provides artifact authoring, rendering, validation, and review management for the Pi agent: saving standalone HTML/Markdown files, authoring project bundles in a workspace store, and previewing on a localhost server. Browsing is accessible via a fullscreen terminal viewer (`/artifacts`) and a web gallery (`/viewer`).

## Ownership
- `create_artifact` tool: writes/updates legacy artifact files under `<project-cwd>/artifacts/`, hidden from the chat transcript
- `scaffold_artifact` tool: creates an artifact bundle (manifest + entry + assets) in `~/.pi/artifacts/<id>/`
- `render_artifact` tool: validates, normalizes (Prettier, markdownlint, HTMLHint, KaTeX), and previews a bundle on the localhost server
- `list_artifacts` tool: lists bundles in the store, newest first
- `delete_artifact` tool: deletes a bundle from the store
- `check_artifact` tool: scans an artifact file for review comments and returns only the commented lines and comments in clean markdown format to save tokens
- `/artifacts` command: fullscreen interactive terminal list picker and markdown reader
- `/viewer` command: opens web gallery with search, stack/status filtering, session scoping, and SSE live reload
- `/viewer-mode` command: set how viewer opens (app window, browser, or off)
- `/viewer-auto` command: toggle auto-open on render
- Preview server (`server.ts`): localhost HTTP server with CSP, path-traversal guard, and SSE
- Rich markdown rendering (`markdown.ts`): markdown-it with task lists, GitHub alerts, KaTeX math
- HTML rendering (`html.ts`): Pico CSS shell, Chart.js chart-spec hydration, live-reload injection
- Runtime assets (`runtime/`): viewer-live.js (SSE), chart-hydrate.js (CSP-clean Chart.js), icons.svg
- Manifest & store (`types.ts`, `manifest.ts`, `store.ts`, `session.ts`, `slug.ts`): typed bundle manifests, session-scoped storage, slug generation
- Viewer config (`viewer-config.ts`): persisted viewer mode and auto-open preference
- Viewer launcher (`viewer-launcher.ts`): Chromium app-window or browser fallback
- Validation (`validation/markdown.ts`, `validation/html.ts`): Prettier, markdownlint, KaTeX, HTMLHint, CSP/capability checks
- Legacy modules still owned: `storage.ts`, `open-browser.ts`, `list-view.ts`, `md-reader.ts`, `list-helpers.ts`, `md-helpers.ts`

## Local Contracts
- **Legacy tool**: `create_artifact({ name, type: "html"|"md", content })` — writes `artifacts/<sanitized-name>.<type>` relative to `ctx.cwd`
- **New store tools**: `scaffold_artifact({ type, title })` → `render_artifact({ id })` → `list_artifacts({})` / `delete_artifact({ id })` / `check_artifact({ id })`
- **Legacy command**: `/artifacts` — terminal list picker (prioritizing the `md` tab if it has at least 1 item), opening `.html` files in the default browser and `.md` files in a standalone fullscreen viewer.
- **TUI Viewer Navigation**: Arrow keys or `j`/`k` to move selection cursor, `PgUp`/`PgDn` to scroll, `g` to top, `G` to bottom.
- **TUI Commenting (`c` key)**: Opens an inline input box at the bottom of the viewport (with `Enter` to save, `Shift+Enter` or `Alt+Enter` to insert newlines, and `Esc` to cancel). Inserts comments formatted as markdown blockquotes under the selected line.
- **TUI Review Submission (`s` key)**: Prompts to submit review, then sends a background notification to the agent to trigger re-checking via the `check_artifact` tool.
- **WSL Host Browser opening**: Converts absolute WSL Linux paths to Windows UNC format (`wslpath -w`) and executes the Windows host browser shell to open files seamlessly.
- **Notifications**: Successful/failed browser launch and comment notifications automatically auto-dismiss and clear after 5 seconds.

## Work Guidance
- `create_artifact`'s tool call/result are intentionally invisible in chat. Confirmation goes through `ctx.ui.notify()` instead.
- The markdown reader is a standalone custom component (not an overlay).
- The chromium app-window uses an isolated temporary profile dir, cleaned up on viewer close or session shutdown.
- All relative imports use explicit `.ts` extensions (not `.js`) so `node --test` can run the test files directly without a transpiler.
- Never use TypeScript constructor parameter-property shorthand.

## Verification
- Run `node --test /home/asterxsk/.pi/agent/extensions/artifacts/tests/*.test.ts`
- Run `/artifacts` — confirm listing works, tabs can be switched, and `md` tab is selected first if populated.
- View a markdown file, use `c` to insert a multiline comment, check that it writes to the file and renders dynamically.
- Press `s` to submit review, verify it prompts and sends a notification, then closes the viewer.
- Run `check_artifact` with the artifact ID, verify it scans and returns only the commented lines.

## Child DOX Index
None
