# context

## Purpose
Visualizes current context window usage as a colored grid overlay, showing token breakdown by category (system prompt, messages, tools, etc.) with cache stats and optimization suggestions.

## Ownership
- `/context` command implementation
- Context breakdown computation and grid rendering
- Copilot usage bridge (quota fetching and display)

## Local Contracts
- Registers command: `/context` — shows context usage overlay
- Hooks: `session_start` (install copilot bridge), `session_shutdown` (cleanup)
- Exposes `readCopilotUsage()` and `buildCopilotUsageLine()` for other extensions
- Self-registers in `__pi_extension_features` global registry

## Work Guidance
- Categories: system prompt (base/tools/skills/guides/docs), user, assistant text, thinking, per-tool, compaction, custom, images, free
- Grid renders colored squares proportional to token usage
- Warning suggestions appear when usage > 80% or > 95%
- Copilot usage refreshed every 10 minutes via background timer

### copilot-usage.ts
- Support module for GitHub Copilot quota fetching
- Uses injected `authStorage` from `modelRegistry` to read GitHub Copilot credentials
- Exchanges OAuth token for session token via `copilot_internal/v2/token`
- Exposes `CopilotUsageBridge` via `globalThis.__pi_copilot_usage`

## Verification
- Start a session and send a message — run `/context` to see grid
- Verify warning appears when context usage is high
- Verify Copilot quota line shows in session stats

## Child DOX Index
None
