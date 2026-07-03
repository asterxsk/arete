# header

## Purpose
Renders an ASCII-art banner header with the Arete branding on the left and an info panel (version, provider, model, working directory) on the right, displayed at the top of the TUI. Also provides the `/feedback` command for creating GitHub issues.

## Ownership
- ASCII banner art generation and orange colorization
- Info panel state (provider, model, cwd)
- Side-by-side composition via `composeSideBySide()`
- Global feature registry self-registration (registers `/update` and `/feedback` commands)
- Header lifecycle (session_start, model_select events)
- Feedback module (`feedback.ts`) — `/feedback` command for GitHub issue creation

## Local Contracts
- **Exports**: `buildBannerArtLines()` — returns raw banner line array
- **ExtensionAPI hooks**: `session_start` (sets header), `model_select` (refreshes model info)
- **Dependencies**: `@earendil-works/pi-tui` (`truncateToWidth`, `visibleWidth`)
- **State**: `infoProvider`, `infoModel`, `requestHeaderRender` module-level variables
- **UI contract**: `ctx.ui.setHeader(renderFactory)` — must return `{ render, invalidate }` component
- **Commands**: `/update` — updates to the latest Arete from GitHub. Detects whether `~/.pi/` is a git clone (fast path: `git pull`) or was installed via install script (fallback: clone temp → `cp -a`/robocopy → cleanup, with preemptive stale-temp cleanup). Also restores `node_modules` for extensions that need them.
- **Commands**: `/feedback <text>` — creates a GitHub issue on `asterxsk/arete` via `gh` CLI. Validates input (minimum 5 words, 30 characters). Shows success/error/too-short notifications. Module in `feedback.ts`.

## Work Guidance
- Banner art is 5 lines; keep aspect ratio stable when modifying
- Color is hardcoded orange (255,165,0); theme-independent
- `renderHeader` closure captures TUI reference for `requestRender()` calls
- Model name is stripped of provider prefix before display
- Version string is hardcoded in `buildInfoPanel()` — update on release

## Verification
- Start a session and verify the banner appears at top
- Switch models and confirm info panel updates without full re-render
- Check terminal width edge cases (narrow terminals truncate gracefully)
- Run `/feedback short` and confirm "Please describe your issue further." notification
- Run `/feedback This is a test feedback message for the feedback module command` and confirm issue creation

## Child DOX Index
None
