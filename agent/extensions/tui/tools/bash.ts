// tui/tools/bash.ts — unified rendering for the `bash` tool.

import type { Component } from "@earendil-works/pi-tui";
import { COLLAPSED_BUDGET, truncate, unifiedBlock } from "./rendering.js";

export const NAME = "bash";

export function shortCommand(cmd: string | undefined): string | undefined {
  if (!cmd) return undefined;
  const first = cmd.split("\n")[0] ?? cmd;
  if (first.length <= 40) return first;
  return first.slice(0, 37) + "...";
}

export function renderCall(args: any, theme: any, _ctx: any): Component {
  return unifiedBlock(theme, {
    name: NAME,
    argSummary: shortCommand(args?.command),
    summary: "bash",
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
  const rawLines = full.split("\n").filter((l: string) => l.length > 0 || true);
  const lineCount = rawLines.length;
  const exitCode = details?.exitCode as number | undefined;
  const overBudget = lineCount > COLLAPSED_BUDGET;

  if (!opts.expanded) {
    if (result?.isError) {
      return unifiedBlock(theme, {
        name: NAME,
        argSummary: shortCommand(ctx?.args?.command),
        summary: "failed",
        hint: exitCode !== undefined ? ` (exit ${exitCode})` : undefined,
      });
    }
    const hint = overBudget ? " … (ctrl+o to expand)" : undefined;
    const exitHint =
      exitCode !== undefined && exitCode !== 0 ? ` (exit ${exitCode})${hint ?? ""}` : hint;
    return unifiedBlock(theme, {
      name: NAME,
      argSummary: shortCommand(ctx?.args?.command),
      summary: "ran",
      count: lineCount,
      hint: exitHint,
    });
  }

  return unifiedBlock(theme, {
    name: NAME,
    argSummary: shortCommand(ctx?.args?.command),
    summary: exitCode !== undefined ? `ran (exit ${exitCode})` : "ran",
    count: lineCount,
    body: (width: number) => truncate(rawLines, COLLAPSED_BUDGET + 12).render(width),
  });
}
