// tui/tools/ls.ts — unified rendering for the `ls` tool.

import type { Component } from "@earendil-works/pi-tui";
import { COLLAPSED_BUDGET, truncate, unifiedBlock } from "./rendering.js";

export const NAME = "ls";

export function renderCall(args: any, theme: any, _ctx: any): Component {
  return unifiedBlock(theme, {
    name: NAME,
    argSummary: args?.path ?? args?.DirectoryPath ?? ".",
    summary: "ls",
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
  const entryCount = rawLines.length;
  const overBudget = entryCount > COLLAPSED_BUDGET;

  if (!opts.expanded) {
    if (result?.isError) {
      return unifiedBlock(theme, {
        name: NAME,
        argSummary: ctx?.args?.path ?? ctx?.args?.DirectoryPath ?? ".",
        summary: "failed",
      });
    }
    return unifiedBlock(theme, {
      name: NAME,
      argSummary: ctx?.args?.path ?? ctx?.args?.DirectoryPath ?? ".",
      summary: "listed",
      count: entryCount,
      hint: overBudget ? " … (ctrl+o to expand)" : undefined,
    });
  }

  return unifiedBlock(theme, {
    name: NAME,
    argSummary: ctx?.args?.path ?? ctx?.args?.DirectoryPath ?? ".",
    summary: "listed",
    count: entryCount,
    body: (width: number) => truncate(rawLines, COLLAPSED_BUDGET + 12).render(width),
  });
}
