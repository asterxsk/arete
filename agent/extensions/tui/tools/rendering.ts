// tui/tools/rendering.ts — Shared rendering primitives for per-tool renderers.
//
// Each primitive returns a pi-tui `Component` ({ render(width): string[], invalidate() })
// so it can be composed with `group()` and embedded in the unified tool format used by
// tools/{read,write,edit,bash,ls,grep,find,powershell}.ts and tools/patch-tools.ts.
//
// Mirrors the shape of agent/extensions/archived/compactui/rendering.ts but uses theme
// tokens (toolTitle, muted, toolDiffAdded, toolDiffRemoved, toolDiffContext, border,
// toolSuccessBg, toolErrorBg) so the colors track the active arete theme.

import { type Component, truncateToWidth } from "@earendil-works/pi-tui";

// Dim grey used for the truncation hint, matching the rest of the UI.
export const DIM_GREY = "\x1b[38;2;140;140;140m";

// ── Helpers ─────────────────────────────────────────────────────────────

/** Wrap a lazy render fn in a Component. */
function component(renderFn: (width: number) => string[]): Component {
  return {
    render(width: number): string[] {
      try {
        return renderFn(width);
      } catch (e: any) {
        return [`\x1b[31mError rendering: ${e?.message ?? e}\x1b[39m`];
      }
    },
    invalidate() {},
  };
}

/** Single-line component from a (theme-resolved) ANSI string. */
function line(text: string): Component {
  return component((width: number) => [truncateToWidth(text, width, "...")]);
}

/** No-op component for expanded calls (rely on result rendering). */
function noOp(): Component {
  return {
    render() {
      return [];
    },
    invalidate() {},
  };
}

// ── Tool glow label ─────────────────────────────────────────────────────
//
// Glow label: greyish-white bold tool title line. Used as the collapsed header
// for every tool. `args` (when provided) is appended in a dimmer muted style.

export function glowLabel(theme: any, toolName: string, args?: string): Component {
  const label =
    theme.fg("toolTitle", theme.bold(toolName)) + (args ? theme.fg("muted", " " + args) : "");
  return line(label);
}

// ── Output arrow summary line ───────────────────────────────────────────
//
// `↳ <label>` line in the muted color, e.g. "↳ 5 lines".

export function outputArrowLine(theme: any, label: string, lineCount?: number): Component {
  const summary = lineCount !== undefined ? `${label} (${lineCount})` : label;
  return line(theme.fg("muted", `↳ ${summary}`));
}

// ── Diff line ───────────────────────────────────────────────────────────
//
// Colorizes a single diff line:
//   '+' added   → toolDiffAdded fg + translucent toolSuccessBg bg
//   '-' removed → toolDiffRemoved fg + translucent toolErrorBg bg
//   otherwise   → toolDiffContext fg (context lines)

export function diffLine(theme: any, raw: string): Component {
  return line(colorizeDiffLine(theme, raw));
}

function colorizeDiffLine(theme: any, raw: string): string {
  if (raw.startsWith("+")) {
    return theme.bg("toolSuccessBg", theme.fg("toolDiffAdded", raw));
  }
  if (raw.startsWith("-")) {
    return theme.bg("toolErrorBg", theme.fg("toolDiffRemoved", raw));
  }
  return theme.fg("toolDiffContext", raw);
}

// ── Separator ───────────────────────────────────────────────────────────
//
// Full-width `─` dash line in the border color.

export function separator(theme: any, width: number): Component {
  const w = Math.max(0, width);
  return line(theme.fg("border", "─".repeat(w)));
}

// ── Truncation ──────────────────────────────────────────────────────────
//
// Collapse a list of already-rendered lines to `max` lines, appending a
// '… (K more lines, ctrl+o to expand)' hint line when overflow occurs.

export function truncate(lines: string[], max: number): Component {
  return component((_width: number) => {
    if (lines.length <= max) return lines;
    const shown = lines.slice(0, max);
    const remaining = lines.length - max;
    const hint = `${DIM_GREY}… (${remaining} more lines, ctrl+o to expand)\x1b[39m`;
    return [...shown, hint];
  });
}

// ── Group ───────────────────────────────────────────────────────────────
//
// Vertical stack of components (renders each in sequence). Used by per-tool
// renderers to compose glowLabel + outputArrowLine + separator.

export function group(children: Component[]): Component {
  return component((width: number) => children.flatMap((c) => c.render(width)));
}

// ── Unified tool block ────────────────────────────────────────────────
//
// Composes the unified per-tool format shared by read/write/edit/bash/ls/
// grep/find/powershell:
//
//   <glow tool title (+ dimmed args)>     (collapsed header)
//   ↳ <summary> [(count)]<hint?>          (muted output/summary line)
//   <optional expanded body lines>
//   ───────────── (full-width border separator)
//
// The block is width-aware: the separator is sized to the current render
// width and the body is computed lazily with access to that width, so
// truncation behaves correctly at any terminal size.

export const COLLAPSED_BUDGET = 8;

export interface UnifiedBlockOptions {
  /** Tool name shown as the greyish-white glow title. */
  name: string;
  /** Optional dimmed args appended to the glow title (file path, command, …). */
  argSummary?: string;
  /** Muted summary text shown after the `↳` arrow. */
  summary: string;
  /** Optional count appended to the summary in `(count)` form. */
  count?: number;
  /** Optional expansion/truncation hint appended to the summary line. */
  hint?: string;
  /** Expanded body: lazily rendered with the current width. Omitted when collapsed. */
  body?: (width: number) => string[];
}

export function unifiedBlock(theme: any, opts: UnifiedBlockOptions): Component {
  return component((width: number) => {
    const out: string[] = [];
    out.push(glowLabel(theme, opts.name, opts.argSummary).render(width)[0]);
    let arrow = opts.summary;
    if (opts.count !== undefined) arrow += ` (${opts.count})`;
    if (opts.hint) arrow += opts.hint;
    out.push(outputArrowLine(theme, arrow).render(width)[0]);
    if (opts.body) out.push(...opts.body(width));
    out.push(separator(theme, width).render(width)[0]);
    return out;
  });
}

// ── Number a list of lines (muted 4-wide gutter) ──────────────────────
//
// Used by read/write expanded views to show "  N  content".

export function numberedLines(theme: any, lines: string[], start = 1): string[] {
  return lines.map((line, i) => {
    const num = theme.fg("muted", String(start + i).padStart(4, " "));
    return `${num}  ${theme.fg("toolOutput", line)}`;
  });
}

// ── Diff helpers ──────────────────────────────────────────────────────

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

/** Shorten a path to its last two segments. */
export function shortPath(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return p;
  return parts.slice(-2).join("/");
}

/** Shorten a command/pattern to its first line, max ~40 chars. */
export function shortLine(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const first = s.split("\n")[0] ?? s;
  if (first.length <= 40) return first;
  return first.slice(0, 37) + "...";
}

/** Shorten a url or long text arg. */
export function shortUrl(s: string | undefined, max = 60): string | undefined {
  if (!s) return undefined;
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

// ── Template Factories ─────────────────────────────────────────────────
//
// Each factory returns a { renderCall, renderResult } pair consumed by
// resolveTemplate(). Follows the same pattern as the archived compactui
// templates but using the tui rendering primitives (unifiedBlock, etc.)

/**
 * standardTemplate — for read, ls, grep, find, web_search, web_fetch,
 * memory, memory_search, session_search, manage_task, schedule,
 * skill_manage, plan, video_extract, and unknown tools.
 *
 * Collapsed: toolname N unit
 *           ↳ first line of detail
 * Expanded: shows all detail lines
 */
export function standardTemplate(
  name: string,
  argSummary: string | undefined,
  lines: string[],
  expanded: boolean,
  theme: any,
  options?: { count?: number; unit?: string; isError?: boolean },
): Component {
  const count = options?.count ?? lines.length;
  const isError = options?.isError;
  const unit = options?.unit ?? "line";
  const filtered = lines.filter((l: string) => l.trim());
  const displayLines = filtered.length > 0 ? filtered : ["(no output)"];
  const overBudget = displayLines.length > COLLAPSED_BUDGET;

  if (!expanded) {
    if (isError) {
      return unifiedBlock(theme, {
        name: name.charAt(0).toUpperCase() + name.slice(1),
        argSummary,
        summary: "failed",
      });
    }
    const hint = overBudget ? " … (ctrl+o to expand)" : undefined;
    return unifiedBlock(theme, {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      argSummary,
      summary: unit,
      count,
      hint,
    });
  }

  return unifiedBlock(theme, {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    argSummary,
    summary: unit,
    count,
    body: (width: number) => truncate(displayLines, COLLAPSED_BUDGET + 12).render(width),
  });
}

/**
 * writeTemplate — for write tool.
 * Collapsed: write path → ↳ N lines → numbered lines preview
 * Expanded: full content with line numbers
 */
export function writeTemplate(
  path: string | undefined,
  lines: string[],
  expanded: boolean,
  theme: any,
): Component {
  const lineCount = lines.length;
  const overBudget = lineCount > COLLAPSED_BUDGET;

  if (!expanded) {
    return unifiedBlock(theme, {
      name: "Write",
      argSummary: shortPath(path),
      summary: "wrote",
      count: lineCount,
      hint: overBudget ? " … (ctrl+o to expand)" : undefined,
    });
  }

  return unifiedBlock(theme, {
    name: "Write",
    argSummary: shortPath(path),
    summary: "wrote",
    count: lineCount,
    body: () => numberedLines(theme, lines, 1),
  });
}

/**
 * editTemplate — for edit tool.
 * Collapsed: edit path → ↳ Added N, removed M → +/- diff preview
 * Expanded: full diff with green/red background coloring
 */
export function editTemplate(
  path: string | undefined,
  diffLines: string[],
  expanded: boolean,
  theme: any,
): Component {
  const { added, removed } = countDiff(diffLines.join("\n"));
  const overBudget = diffLines.length > COLLAPSED_BUDGET;

  if (!expanded) {
    let summary = "edited";
    const parts: string[] = [];
    if (added > 0) parts.push(`${added} added`);
    if (removed > 0) parts.push(`${removed} removed`);
    if (parts.length) summary = parts.join(", ");
    return unifiedBlock(theme, {
      name: "Update",
      argSummary: shortPath(path),
      summary,
      hint: overBudget ? " … (ctrl+o to expand)" : undefined,
    });
  }

  return unifiedBlock(theme, {
    name: "Update",
    argSummary: shortPath(path),
    summary: added > 0 || removed > 0 ? `${added} added, ${removed} removed` : "no changes",
    body: (width: number) => diffLines.map((l) => diffLine(theme, l).render(width)[0]),
  });
}

/**
 * executeTemplate — for bash, pwsh/powershell, run_command.
 * Collapsed: execute {bash} cmd → ↳ first output lines
 * Expanded: full output with duration footer
 */
export function executeTemplate(
  shell: string,
  cmd: string,
  lines: string[],
  expanded: boolean,
  result: any,
  theme: any,
  options?: { durationS?: number },
): Component {
  const lineCount = lines.length;
  const exitCode = (result?.details as any)?.exitCode as number | undefined;
  const isError = result?.isError;
  const overBudget = lineCount > COLLAPSED_BUDGET;
  const durationS = options?.durationS ?? -1;

  if (!expanded) {
    if (isError) {
      const hint = exitCode !== undefined ? ` (exit ${exitCode})` : "";
      return unifiedBlock(theme, {
        name: "Execute",
        argSummary: shortLine(cmd),
        summary: "failed",
        hint,
      });
    }
    const hint = (overBudget ? " … (ctrl+o to expand)" : "") + `{${shell}}`;
    const exitHint = exitCode !== undefined && exitCode !== 0 ? ` (exit ${exitCode})${hint}` : hint;
    return unifiedBlock(theme, {
      name: "Execute",
      argSummary: shortLine(cmd),
      summary: "ran",
      count: lineCount,
      hint: exitHint || " ",
    });
  }

  return unifiedBlock(theme, {
    name: "Execute",
    argSummary: shortLine(cmd),
    summary: (exitCode !== undefined ? `ran (exit ${exitCode})` : "ran") + ` {${shell}}`,
    count: lineCount,
    body: (width: number) => truncate(lines, COLLAPSED_BUDGET + 12).render(width),
  });
}

/**
 * readBatchTemplate — for batched read calls (multiple files read in
 * the same tool-use block). Groups multiple file reads under one header.
 *
 * Collapsed: read N files → ↳ path1, ↳ path2, ...
 * Expanded: full content per file
 */
export function readBatchTemplate(
  entries: { path: string; lines: string[] }[],
  expanded: boolean,
  theme: any,
): Component {
  const count = entries.length;

  if (!expanded) {
    return unifiedBlock(theme, {
      name: "Read",
      argSummary: `${count} files`,
      summary: "read",
    });
  }

  const body: string[] = [];
  for (const entry of entries) {
    if (body.length > 0) body.push("");
    body.push(theme.fg("toolTitle", theme.bold(`── ${entry.path} ──`)));
    body.push(...numberedLines(theme, entry.lines));
  }

  return unifiedBlock(theme, {
    name: "Read",
    argSummary: `${count} files`,
    summary: "read",
    body: () => body,
  });
}

// ── Batch read tracking ───────────────────────────────────────────────

/**
 * global batch buffer — keyed by assistant message index, collects read
 * results so they can be rendered as a group in readBatchTemplate.
 */
export const readBatchBuffer = new Map<number, { path: string; lines: string[] }[]>();

// ── Template Dispatch ─────────────────────────────────────────────────

/**
 * Resolve the appropriate template for a tool based on its name.
 * Returns a { renderCall, renderResult } pair, or null to skip (unknown tool).
 */
export function resolveTemplate(tool: any): {
  renderCall?: (args: any, theme: any, context: any) => Component;
  renderResult?: (result: any, opts: any, theme: any, context: any) => Component;
} | null {
  const name = tool.name;

  // Tools with their own rendering (skip)
  if (name === "subagent") return null;
  if (name === "todo") return null; // hidden
  if (
    name === "questions" ||
    name === "ask_question" ||
    name === "ask_questions" ||
    name === "question"
  )
    return null;

  // ── Read (with batch tracking) ──────────────────────────────────
  if (name === "read") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(
          theme.fg("toolTitle", theme.bold("Read")) + ` ${args.path ?? args.file ?? "?"}`,
        );
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n");
        const filePath = context.args.path ?? context.args.file ?? "?";
        return standardTemplate("read", shortPath(filePath), lines, opts.expanded, theme, {
          count: lines.length,
          unit: "line",
          isError: result.isError,
        });
      },
    };
  }

  // ── Write ───────────────────────────────────────────────────────
  if (name === "write") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(
          theme.fg("toolTitle", theme.bold("Write")) + ` ${args.path ?? args.file ?? "?"}`,
        );
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const contentStr = context.args.content || "";
        const lines = contentStr.split("\n");
        return writeTemplate(context.args.path ?? "?", lines, opts.expanded, theme);
      },
    };
  }

  // ── Edit ────────────────────────────────────────────────────────
  if (name === "edit") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(
          theme.fg("toolTitle", theme.bold("Update")) + ` ${args.path ?? args.file ?? "?"}`,
        );
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const diff = (result.details as any)?.diff as string | undefined;
        const diffLines = diff?.split("\n") || [];
        return editTemplate(context.args.path ?? "?", diffLines, opts.expanded, theme);
      },
    };
  }

  // ── Bash (execute template, shell = bash) ──────────────────────
  if (name === "bash") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        const cmd = args.command ?? "?";
        return line(theme.fg("toolTitle", theme.bold("Execute")) + ` {bash} ${shortLine(cmd)}`);
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const details = result.details as Record<string, unknown> | undefined;
        const full = (details?._fullOutput as string) || result.content?.[0]?.text || "";
        const lines = full.split("\n");
        const cmd = context.args.command ?? "";
        return executeTemplate("bash", cmd, lines, opts.expanded, result, theme, {
          durationS: (details?._durationS as number) ?? -1,
        });
      },
    };
  }

  // ── Powershell / Pwsh (execute template) ───────────────────────
  if (name === "powershell" || name === "pwsh") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        const cmd = args.command ?? "?";
        return line(theme.fg("toolTitle", theme.bold("Execute")) + ` {pwsh} ${shortLine(cmd)}`);
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const details = result.details as Record<string, unknown> | undefined;
        const full = (details?._fullOutput as string) || result.content?.[0]?.text || "";
        const lines = full.split("\n");
        const cmd = context.args.command ?? "";
        return executeTemplate("pwsh", cmd, lines, opts.expanded, result, theme, {
          durationS: (details?._durationS as number) ?? -1,
        });
      },
    };
  }

  // ── Run Command (execute template, shell = shell) ──────────────
  if (name === "run_command") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(
          theme.fg("toolTitle", theme.bold("Execute")) +
            ` {shell} ${shortLine(args.CommandLine ?? "?")}`,
        );
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const details = result.details as Record<string, unknown> | undefined;
        const full = (details?._fullOutput as string) || result.content?.[0]?.text || "";
        const lines = full.split("\n");
        const cmd = context.args.CommandLine ?? "";
        return executeTemplate("shell", cmd, lines, opts.expanded, result, theme, {
          durationS: (details?._durationS as number) ?? -1,
        });
      },
    };
  }

  // ── Manage Task (standard template) ────────────────────────────
  if (name === "manage_task") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(
          theme.fg("toolTitle", theme.bold("Tasks")) +
            ` ${args.Action} ${args.TaskId ?? ""}`.trim(),
        );
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n").filter((l: string) => l.trim());
        return standardTemplate(
          "manage_task",
          `${context.args.Action} ${context.args.TaskId ?? ""}`.trim(),
          lines,
          opts.expanded,
          theme,
          {
            count: lines.length,
            unit: "line",
            isError: result.isError,
          },
        );
      },
    };
  }

  // ── Schedule (standard template) ──────────────────────────────
  if (name === "schedule") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(
          theme.fg("toolTitle", theme.bold("Schedule")) +
            ` ${args.DurationSeconds || args.CronExpression || "?"}`,
        );
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n").filter((l: string) => l.trim());
        return standardTemplate("schedule", "", lines, opts.expanded, theme, {
          count: lines.length,
          unit: "task",
          isError: result.isError,
        });
      },
    };
  }

  // ── Web Search (standard template) ────────────────────────────
  if (name === "web_search") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(
          theme.fg("toolTitle", theme.bold("WebSearch")) + ` "${(args.query ?? "").slice(0, 50)}"`,
        );
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n").filter((l: string) => l.trim());
        return standardTemplate(
          "web_search",
          context.args.query ?? "",
          lines,
          opts.expanded,
          theme,
          {
            count: lines.length,
            unit: "result",
            isError: result.isError,
          },
        );
      },
    };
  }

  // ── Web Fetch (standard template) ─────────────────────────────
  if (name === "web_fetch" || name === "fetch_content" || name === "get_search_content") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(theme.fg("toolTitle", theme.bold("WebFetch")) + ` ${shortUrl(args.url ?? "")}`);
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n").filter((l: string) => l.trim());
        return standardTemplate("web_fetch", context.args.url ?? "", lines, opts.expanded, theme, {
          count: lines.length,
          unit: "line",
          isError: result.isError,
        });
      },
    };
  }

  // ── Memory (standard template) ────────────────────────────────
  if (name === "memory") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        const action = args.action ?? "?";
        const target = args.target ?? "";
        const label = args.content?.slice(0, 60) ?? args.old_text?.slice(0, 60) ?? "";
        return line(
          theme.fg("toolTitle", theme.bold("Memory")) +
            ` ${action}${target ? " (" + target + ")" : ""}${label ? " \u2192 " + label : ""}`,
        );
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n").filter((l: string) => l.trim());
        return standardTemplate("memory", "", lines, opts.expanded, theme, {
          count: lines.length,
          unit: "entry",
          isError: result.isError,
        });
      },
    };
  }

  // ── Memory Search (standard template) ─────────────────────────
  if (name === "memory_search") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(
          theme.fg("toolTitle", theme.bold("MemorySearch")) +
            ` "${(args.query ?? "").slice(0, 50)}"`,
        );
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n").filter((l: string) => l.trim());
        return standardTemplate(
          "memory_search",
          context.args.query ?? "",
          lines,
          opts.expanded,
          theme,
          {
            count: lines.length,
            unit: "result",
            isError: result.isError,
          },
        );
      },
    };
  }

  // ── Session Search (standard template) ────────────────────────
  if (name === "session_search") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(
          theme.fg("toolTitle", theme.bold("SessionSearch")) +
            ` "${(args.query ?? args.markdown ?? "").slice(0, 50)}"`,
        );
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n").filter((l: string) => l.trim());
        return standardTemplate("session_search", "", lines, opts.expanded, theme, {
          count: lines.length,
          unit: "result",
          isError: result.isError,
        });
      },
    };
  }

  // ── Skill Manage (standard template) ──────────────────────────
  if (name === "skill_manage") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(theme.fg("toolTitle", theme.bold("SkillManage")) + ` ${args.action ?? "?"}`);
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n").filter((l: string) => l.trim());
        return standardTemplate("skill_manage", "", lines, opts.expanded, theme, {
          count: lines.length,
          unit: "entry",
          isError: result.isError,
        });
      },
    };
  }

  // ── Plan (standard template) ──────────────────────────────────
  if (name === "plan") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(
          theme.fg("toolTitle", theme.bold("Plan")) + ` ${args.action ?? args.requirement ?? "?"}`,
        );
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n").filter((l: string) => l.trim());
        return standardTemplate("plan", "", lines, opts.expanded, theme, {
          count: lines.length,
          unit: "step",
          isError: result.isError,
        });
      },
    };
  }

  // ── Video Extract (standard template) ─────────────────────────
  if (name === "video_extract") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(
          theme.fg("toolTitle", theme.bold("VideoExtract")) + ` ${shortUrl(args.url ?? "")}`,
        );
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const details = result.details as any;
        const title = details?.title || "(no title)";
        const totalChars = details?.totalChars || 0;
        const imgCount = details?.imageCount || 0;
        const lines = [`${title} (${totalChars} chars)`];
        if (imgCount > 0) lines.push(`${imgCount} image${imgCount !== 1 ? "s" : ""}`);
        return standardTemplate(
          "video_extract",
          context.args.url ?? "",
          lines,
          opts.expanded,
          theme,
          {
            count: lines.length,
            unit: "item",
            isError: result.isError,
          },
        );
      },
    };
  }

  // ── Subagent (template) ───────────────────────────────────────
  if (name === "subagent") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        const agentType = args.subagent_type ?? args.type ?? "worker";
        return line(theme.fg("toolTitle", theme.bold("Subagent")) + ` ${agentType}`);
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const details = result.details as any;
        const lines: string[] = [];
        const status = details?.status ?? "done";
        const agents = details?.subagents ?? [];
        if (Array.isArray(agents)) {
          const working = agents.filter(
            (a: any) => a.status === "working" || a.status === "in_progress",
          ).length;
          const done = agents.filter(
            (a: any) => a.status === "completed" || a.status === "done",
          ).length;
          const total = agents.length;
          lines.push(`${status} (${working} working, ${done}/${total} done)`);
          if (opts.expanded && agents.length > 0) {
            for (const agent of agents) {
              const aName = agent.name ?? agent.subagent_type ?? "agent";
              const aStatus = agent.status ?? "unknown";
              const toolsUsed = agent.toolCalls ?? agent.tool_calls ?? 0;
              const duration = agent.durationS ?? agent.duration ?? 0;
              lines.push(
                theme.fg("muted", `  ${aName}: ${aStatus} (${toolsUsed} tools, ${duration}s)`),
              );
            }
          }
        } else {
          lines.push(status);
        }
        return standardTemplate("subagent", "", lines, opts.expanded, theme, {
          count: lines.length,
          unit: "agent",
          isError: result.isError,
        });
      },
    };
  }

  // ── Generic Fallback ──────────────────────────────────────────
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, " ");
  return {
    renderCall(args: any, theme: any, context: any) {
      if (context.expanded) return noOp();
      const argsLine = Object.values(args || {})
        .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))
        .join(" ");
      return line(theme.fg("toolTitle", theme.bold(capitalized)) + ` ${argsLine.slice(0, 60)}`);
    },
    renderResult(result: any, opts: any, theme: any, context: any) {
      if ((result.details as any)?._isUnknownTool) {
        return line(theme.fg("toolTitle", theme.bold(capitalized)) + " tool not found");
      }
      const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
      const lines = full.split("\n").filter((l: string) => l.trim());
      return standardTemplate(capitalized, "", lines, opts.expanded, theme, {
        count: lines.length,
        unit: "line",
        isError: result.isError,
      });
    },
  };
}

export { line, noOp };

// ── patchTool ─────────────────────────────────────────────────────────

/**
 * Apply a template-based renderCall/renderResult to a tool object.
 * Skips tools in EXCLUDED_TOOLS and tools that already have their own rendering.
 */
export function patchTool(tool: any): void {
  const EXCLUDED_TOOLS = new Set(["subagent"]);
  if (EXCLUDED_TOOLS.has(tool.name)) return;

  // Skip tools that already have custom rendering from their own extensions
  if (tool.renderShell === "self" && tool.renderResult && !tool.__tui_patched) return;

  const template = resolveTemplate(tool);
  if (!template) return;

  if (tool.__tui_patched) return;
  tool.__tui_patched = true;
  tool.renderShell = "self";
  tool.renderCall = template.renderCall;
  tool.renderResult = template.renderResult;
}
