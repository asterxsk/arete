// tui/tools/edit.ts — unified rendering for the `edit` tool.
//
// Collapsed: glow title + ↳ "edited" summary (added/removed counts).
// Expanded: full diff with + lines in toolDiffAdded + toolSuccessBg and
//           - lines in toolDiffRemoved + toolErrorBg (translucent backgrounds).

import type { Component } from "@earendil-works/pi-tui";
import { COLLAPSED_BUDGET, diffLine, unifiedBlock } from "./rendering.js";
import { shortPath } from "./read.js";

export const NAME = "edit";

export function renderCall(args: any, theme: any, _ctx: any): Component {
  return unifiedBlock(theme, {
    name: NAME,
    argSummary: shortPath(args?.path),
    summary: "edit",
  });
}

/** Count added/removed lines from a unified diff (excluding hunk headers). */
export function countDiff(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const dl of diff.split("\n")) {
    if (dl.startsWith("+") && !dl.startsWith("+++")) added++;
    if (dl.startsWith("-") && !dl.startsWith("---")) removed++;
  }
  return { added, removed };
}

export function renderResult(
  result: any,
  opts: { expanded: boolean },
  theme: any,
  ctx: any,
): Component {
  const details = result?.details as Record<string, unknown> | undefined;
  const diff = (details?.diff as string | undefined) ?? "";
  const diffLines = diff ? diff.split("\n") : [];
  const { added, removed } = countDiff(diff);

  if (!opts.expanded) {
    if (result?.isError) {
      return unifiedBlock(theme, {
        name: NAME,
        argSummary: shortPath(ctx?.args?.path),
        summary: "failed",
      });
    }
    let summary = "edited";
    const parts: string[] = [];
    if (added > 0) parts.push(`${added} added`);
    if (removed > 0) parts.push(`${removed} removed`);
    if (parts.length) summary = parts.join(", ");
    const overBudget = diffLines.length > COLLAPSED_BUDGET;
    return unifiedBlock(theme, {
      name: NAME,
      argSummary: shortPath(ctx?.args?.path),
      summary,
      hint: overBudget ? " … (ctrl+o to expand)" : undefined,
    });
  }

  // Expanded: full diff, colorized line by line.
  return unifiedBlock(theme, {
    name: NAME,
    argSummary: shortPath(ctx?.args?.path),
    summary: added > 0 || removed > 0 ? `${added} added, ${removed} removed` : "no changes",
    body: (width: number) => diffLines.map((l) => diffLine(theme, l).render(width)[0]),
  });
}
