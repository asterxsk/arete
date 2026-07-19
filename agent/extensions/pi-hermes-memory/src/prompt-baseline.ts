/**
 * Baseline + helper for measuring the assembled `before_agent_start` prompt.
 *
 * The measurable prompt-overhead reduction target (VAL-MEM-004) is committed
 * here as a frozen constant so the reduction is reproducible, not ad-hoc:
 *
 *   BASELINE_ASSEMBLED_PROMPT_LENGTH = (length of a fixed representative host
 *   system prompt) + (lengths of the untrimmed prompts this extension injected
 *   into `before_agent_start` / tool definitions before the trimming change).
 *
 * The untrimmed owned contribution was measured as:
 *   MEMORY_POLICY_PROMPT        3691
 *   MEMORY_TOOL_DESCRIPTION     1296
 *   SKILL_TOOL_DESCRIPTION      2805
 *                                 ----
 *   owned subtotal              7792
 *
 * The trimmed strings are smaller, so the assembled prompt built by
 * `assembleBeforeAgentStartPrompt` drops by >= 10% versus this baseline.
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

// Committed baseline length (see header). 1000 (host) + 7792 (untrimmed owned).
export const BASELINE_ASSEMBLED_PROMPT_LENGTH = 1000 + 7792;
