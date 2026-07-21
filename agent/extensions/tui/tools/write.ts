// tui/tools/write.ts — unified rendering for the `write` tool.

import type { Component } from "@earendil-works/pi-tui";
import { COLLAPSED_BUDGET, numberedLines, unifiedBlock } from "./rendering.js";
import { shortPath } from "./read.js";

export const NAME = "write";

export function renderCall(args: any, theme: any, _ctx: any): Component {
  return unifiedBlock(theme, {
    name: NAME,
    argSummary: shortPath(args?.path),
    summary: "write",
  });
}

export function renderResult(
  result: any,
  opts: { expanded: boolean },
  theme: any,
  ctx: any,
): Component {
  // The content that was written lives on the tool args, not the result.
  const contentStr = ctx?.args?.content ?? "";
  const rawLines = contentStr.split("\n");
  const lineCount = rawLines.length;
  const overBudget = lineCount > COLLAPSED_BUDGET;

  if (!opts.expanded) {
    if (result?.isError) {
      return unifiedBlock(theme, {
        name: NAME,
        argSummary: shortPath(ctx?.args?.path),
        summary: "failed",
      });
    }
    return unifiedBlock(theme, {
      name: NAME,
      argSummary: shortPath(ctx?.args?.path),
      summary: "wrote",
      count: lineCount,
      hint: overBudget ? " … (ctrl+o to expand)" : undefined,
    });
  }

  return unifiedBlock(theme, {
    name: NAME,
    argSummary: shortPath(ctx?.args?.path),
    summary: "wrote",
    count: lineCount,
    body: () => numberedLines(theme, rawLines, 1),
  });
}
