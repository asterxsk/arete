import {
  MEMORY_POLICY_PROMPT,
  MEMORY_POLICY_PROMPT_COMPACT,
  MEMORY_USE_GUIDANCE,
} from "./constants.js";
import { SAMPLE_HOST_SYSTEM_PROMPT } from "./prompt-baseline.js";
import type { MemoryConfig } from "./types.js";
import type { MemoryStore } from "./store/memory-store.js";

type MemoryPolicyConfig = Pick<MemoryConfig, "memoryPolicyStyle" | "memoryPolicyCustomText">;

export function resolveMemoryPolicyPrompt(config: MemoryPolicyConfig): string {
  const style = config.memoryPolicyStyle ?? "full";

  switch (style) {
    case "compact":
      return MEMORY_POLICY_PROMPT_COMPACT;
    case "custom":
      return config.memoryPolicyCustomText && config.memoryPolicyCustomText.trim().length > 0
        ? config.memoryPolicyCustomText
        : MEMORY_POLICY_PROMPT_COMPACT;
    case "none":
      return "";
    case "full":
    default:
      return MEMORY_POLICY_PROMPT;
  }
}

/**
 * Build a clearly sectioned, fenced memory block for injection after
 * `before_agent_start`.
 *
 * Subsections are surfaced by what the stores actually contain plus the
 * failure-injection config flags. Each section is independently omitted when it
 * has no content, so an empty memory store yields an empty string (no injection).
 */
export function buildMemoryContextBlock(
  config: Pick<
    MemoryConfig,
    "failureInjectionEnabled" | "failureInjectionMaxAgeDays" | "failureInjectionMaxEntries"
  >,
  store: MemoryStore,
  projectStore: MemoryStore | null,
  projectName: string,
): string {
  const sections: string[] = [];

  const userEntries = store.getUserEntries();
  if (userEntries.length > 0) {
    sections.push(
      renderSection("User", "who the user is, preferences, communication style", userEntries),
    );
  }

  const globalEntries = store.getMemoryEntries();
  if (globalEntries.length > 0) {
    sections.push(
      renderSection(
        "Global",
        "durable notes, environment facts, lessons (shared across projects)",
        globalEntries,
      ),
    );
  }

  if (projectStore) {
    const projectEntries = projectStore.getMemoryEntries();
    if (projectEntries.length > 0) {
      sections.push(
        renderSection(
          "Project",
          `repo-specific conventions and workflows (${projectName})`,
          projectEntries,
        ),
      );
    }
  }

  if (config.failureInjectionEnabled !== false) {
    const maxAgeDays = config.failureInjectionMaxAgeDays ?? 7;
    const maxEntries = config.failureInjectionMaxEntries ?? 5;
    const failures = store.getFailureEntries(maxAgeDays).slice(0, maxEntries);
    if (failures.length > 0) {
      sections.push(
        renderSection("Recent Failures", "lessons and corrections from prior work", failures),
      );
    }
  }

  if (sections.length === 0) return "";

  const inner = [
    "## Memory Context",
    MEMORY_USE_GUIDANCE,
    "",
    ...sections,
    "",
    "═══ END MEMORY ═══",
  ].join("\n");

  return `<memory-context>\n${inner}\n</memory-context>`;
}

function renderSection(title: string, blurb: string, entries: string[]): string {
  return `### ${title}\n${blurb}\n\n${entries.map((e) => "• " + e).join("\n")}`;
}

export async function buildPromptContext(
  config: Pick<
    MemoryConfig,
    | "memoryMode"
    | "memoryPolicyStyle"
    | "memoryPolicyCustomText"
    | "failureInjectionEnabled"
    | "failureInjectionMaxAgeDays"
    | "failureInjectionMaxEntries"
  >,
  store: MemoryStore,
  projectStore: MemoryStore | null,
  projectName: string,
): Promise<string> {
  // policy-only mode keeps the runtime memory policy prompt untouched.
  if (config.memoryMode === "policy-only") {
    return resolveMemoryPolicyPrompt(config);
  }

  // legacy-inject (and any non-policy mode) emits the sectioned fenced block.
  return buildMemoryContextBlock(config, store, projectStore, projectName);
}

/**
 * Assemble the full `before_agent_start` prompt: the host-provided system
 * prompt plus the memory block this extension contributes. Pass a fixed host
 * prompt in tests so the char-count reduction vs
 * `BASELINE_ASSEMBLED_PROMPT_LENGTH` is deterministic.
 */
export async function assembleBeforeAgentStartPrompt(
  config: Parameters<typeof buildPromptContext>[0],
  store: MemoryStore,
  projectStore: MemoryStore | null,
  projectName: string,
  hostSystemPrompt: string = SAMPLE_HOST_SYSTEM_PROMPT,
): Promise<string> {
  const memorySection = await buildPromptContext(config, store, projectStore, projectName);
  return [hostSystemPrompt, memorySection].filter((s) => s && s.length > 0).join("\n\n");
}
