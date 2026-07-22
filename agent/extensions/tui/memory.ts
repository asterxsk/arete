// tui/memory.ts — shared memory-related TUI rendering for the pi-hermes-memory tools.
// Exposes render functions consumed by the pi-hermes-memory extension via the
// globalThis.__pi_tui bridge, so memory UI lives in one place.

import { Text } from "@earendil-works/pi-tui";

interface MemorySearchRenderArgs {
  query?: string;
}

interface MemorySearchRenderResult {
  details?: Record<string, unknown>;
  content: Array<{ type: string; text?: string }>;
}

/**
 * Call line for the memory_search tool: a single bold "memory_search" header.
 */
export function renderMemorySearchCall(
  _args: MemorySearchRenderArgs,
  theme: any,
  _context: any,
): Text {
  const text = new Text("", 0, 0);
  text.setText(theme.fg("toolTitle", theme.bold("memory_search")));
  return text;
}

/**
 * Result rendering for the memory_search tool.
 *
 * Collapsed view:
 *   memory_search 4 found
 *    ↳ "<first memory>"
 *    └ 3 more, ctrl+o to expand
 * Expanded view shows the full output captured in details._fullOutput.
 */
export function renderMemorySearchResult(
  result: MemorySearchRenderResult,
  options: { expanded?: boolean },
  theme: any,
  context: { isError?: boolean },
): Text {
  const details = (result.details ?? {}) as Record<string, unknown>;
  const full = (details._fullOutput as string) || firstText(result) || "";
  const text = new Text("", 0, 0);

  if (context.isError) {
    text.setText(theme.fg("error", full || "memory_search failed"));
    return text;
  }

  let body = full;
  if (!options.expanded) {
    const lines = full.split("\n").filter((l) => l.trim());
    const count = (details.count as number) ?? lines.length;
    const first = lines[0] ?? "done";
    body =
      theme.fg("muted", `${count} found`) +
      (count > 0 ? `\n ${theme.fg("muted", `↳ ${first}`)}` : "") +
      (count > 1 ? `\n ${theme.fg("muted", `└ ${count - 1} more, ctrl+o to expand`)}` : "");
  }

  text.setText(theme.fg("toolTitle", theme.bold("memory_search ")) + body);
  return text;
}

function firstText(result: MemorySearchRenderResult): string {
  for (const c of result.content) {
    if (c.type === "text" && typeof c.text === "string") return c.text;
  }
  return "";
}
