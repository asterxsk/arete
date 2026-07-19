/**
 * Baseline + helper for measuring the assembled `before_agent_start` prompt.
 *
 * The measurable prompt-overhead reduction target (VAL-MEM-004) is committed
 * here as a frozen constant so the reduction is reproducible, not ad-hoc.
 *
 * `before_agent_start` only injects two things:
 *   1. a fixed representative host system prompt (SAMPLE_HOST_SYSTEM_PROMPT)
 *   2. the memory policy prompt (MEMORY_POLICY_PROMPT) — via policy-only mode,
 *      or the sectioned fenced block via legacy-inject mode.
 *
 * It does NOT inject the tool/event descriptions (MEMORY_TOOL_DESCRIPTION,
 * SKILL_TOOL_DESCRIPTION); those live in tool definitions, never in the
 * `before_agent_start` prompt. So they must be excluded from the baseline.
 *
 * Baseline ownership breakdown (pre-trim lengths):
 *   SAMPLE_HOST_SYSTEM_PROMPT   1000
 *   MEMORY_POLICY_PROMPT        3299   (pre-trim; see note below)
 *                                 ----
 *   baseline total              4299
 *
 * Note: MEMORY_POLICY_PROMPT was subsequently tightened to cut system-prompt
 * overhead; the trimmed version is the live value and the assembled prompt is
 * measured against this 4299 baseline. The reduction is therefore the
 * fully-trimmed policy vs the fat baseline, and must stay >= 10%.
 */

// Fixed, representative slice of the host-assembled system prompt. It is kept
// constant so the reduction percentage is deterministic across machines.
export const SAMPLE_HOST_SYSTEM_PROMPT = [
  "You are Pi, a powerful coding agent.",
  "You operate inside a terminal with filesystem, shell, and editor access.",
  "Follow the user's instructions carefully and prefer minimal, correct changes.",
  "Use tools when they reduce risk or effort; verify outcomes before claiming success.",
  "Respect project conventions found in the repository and any loaded extension guidance.",
  "Communicate concisely and avoid em-dashes in user-facing prose.",
  "When a task is ambiguous, gather context from files and tooling before acting.",
  "Persist durable facts through the memory tools instead of repeating work.",
  "Report progress as you go and surface blockers early rather than guessing.",
  "Prefer explicit, testable steps and keep side effects small and reversible.",
]
  .join(" ")
  .padEnd(1000, " ");

// Committed baseline length (see header). 1000 (host) + 3299 (pre-trim policy).
// Tool/event descriptions are excluded because they are never injected at
// `before_agent_start`.
export const BASELINE_ASSEMBLED_PROMPT_LENGTH = 1000 + 3299;
