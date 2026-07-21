// tui/tools/grep.ts — unified rendering for the `grep` tool.

import type { Component } from "@earendil-works/pi-tui";
import { COLLAPSED_BUDGET, truncate, unifiedBlock } from "./rendering.js";

export const NAME = "grep";

export function shortPattern(p: string | undefined): string | undefined {
  if (!p) return undefined;
  if (p.length <= 40) return p;
  return p.slice(0, 37) + "...";
}

export function renderCall(args: any, theme: any, _ctx: any): Component {
  return unifiedBlock(theme, {
    name: NAME,
    argSummary: shortPattern(args?.pattern ?? args?.Query),
    summary: "grep",
  });
}

export function renderResult(
  result: any,
  opts: { expanded: boolean },
  theme: any,
  ctx: any,
): Component {
  const details = result?.details as Record<string, unknown> | undefined;
  const full = (details?._fullOutput as string) ?? result?.content?.[0]?.text ?? "";
  const rawLines = full.split("\n").filter((l: string) => l.trim());
  const matchCount = rawLines.length;
  const overBudget = matchCount > COLLAPSED_BUDGET;

  if (!opts.expanded) {
    if (result?.isError) {
      return unifiedBlock(theme, {
        name: NAME,
        argSummary: shortPattern(ctx?.args?.pattern ?? ctx?.args?.Query),
        summary: "failed",
      });
    }
    return unifiedBlock(theme, {
      name: NAME,
      argSummary: shortPattern(ctx?.args?.pattern ?? ctx?.args?.Query),
      summary: "matched",
      count: matchCount,
      hint: overBudget ? " … (ctrl+o to expand)" : undefined,
    });
  }

  return unifiedBlock(theme, {
    name: NAME,
    argSummary: shortPattern(ctx?.args?.pattern ?? ctx?.args?.Query),
    summary: "matched",
    count: matchCount,
    body: (width: number) => truncate(rawLines, COLLAPSED_BUDGET + 12).render(width),
  });
}
