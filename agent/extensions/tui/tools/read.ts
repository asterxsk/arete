// tui/tools/read.ts — unified rendering for the `read` tool.
//
// Renders the result in the shared format (glowLabel + ↳ arrow + separator).
// Execution is delegated to createReadTool from @earendil-works/pi-coding-agent;
// registerToolRenderers (tools/register.ts) wires the renderer together with
// the original execute so runtime behavior is preserved.

import type { Component } from "@earendil-works/pi-tui";
import { COLLAPSED_BUDGET, numberedLines, unifiedBlock } from "./rendering.js";

export const NAME = "read";

/** Shorten an absolute/relative path to its last two segments for display. */
export function shortPath(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return p;
  return parts.slice(-2).join("/");
}

export function renderCall(args: any, theme: any, _ctx: any): Component {
  const path = shortPath(args?.path ?? args?.file_path ?? args?.file);
  return unifiedBlock(theme, {
    name: NAME,
    argSummary: path,
    summary: "read",
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
  const rawLines = full.split("\n");
  const lineCount = rawLines.length;
  const overBudget = lineCount > COLLAPSED_BUDGET;

  if (!opts.expanded) {
    if (result?.isError) {
      return unifiedBlock(theme, {
        name: NAME,
        argSummary: shortPath(ctx?.args?.path ?? ctx?.args?.file_path ?? ctx?.args?.file),
        summary: "failed",
      });
    }
    return unifiedBlock(theme, {
      name: NAME,
      argSummary: shortPath(ctx?.args?.path ?? ctx?.args?.file_path ?? ctx?.args?.file),
      summary: "read file",
      count: lineCount,
      hint: overBudget ? " … (ctrl+o to expand)" : undefined,
    });
  }

  // Expanded: numbered file content.
  const offset = (ctx?.args?.offset as number | undefined) ?? 1;
  return unifiedBlock(theme, {
    name: NAME,
    argSummary: shortPath(ctx?.args?.path ?? ctx?.args?.file_path ?? ctx?.args?.file),
    summary: "read file",
    count: lineCount,
    body: () => numberedLines(theme, rawLines, offset),
  });
}
