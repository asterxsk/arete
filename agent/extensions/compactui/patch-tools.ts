/**
 * patch-tools.ts — Unified tool patching with template-based rendering
 *
 * Intercepts tool renderCall/renderResult to apply template-based compact
 * two-line display. Routes each tool to the appropriate template based on
 * its name:
 *
 *   read             → standardTemplate (with batch tracking)
 *   write            → writeTemplate
 *   edit             → editTemplate
 *   bash             → executeTemplate (shell=bash)
 *   powershell/pwsh  → executeTemplate (shell=pwsh)
 *   run_command      → executeTemplate (shell=shell)
 *   subagent         → skip (self-rendered by subagents extension)
 *   questions        → skip (self-rendered, kept as-is)
 *   everything else  → standardTemplate
 *
 * The questions tool is intentionally left unchanged.
 */

import { type Component } from "@earendil-works/pi-tui";
import {
  line, noOp, orange, DIM_GREY, capitalizeToolName,
  standardTemplate, writeTemplate, editTemplate, executeTemplate,
} from "./rendering.js";

// ── Constants ──────────────────────────────────────────────────────────

export const MAX_LINES = 5;
export const KNOWN_TOOLS = new Set([
  "read", "write", "edit", "bash", "grep", "find", "ls",
  "web_search", "web_fetch", "fetch_content", "get_search_content",
  "run_command", "manage_task", "schedule", "subagent", "todo",
  "powershell", "questions", "video_extract", "skill_manage", "plan",
  "memory", "memory_search", "session_search",
]);

export const TRUNCATED_TOOLS = new Set(["bash", "powershell", "run_command"]);

// ── Template Dispatch ──────────────────────────────────────────────────

/**
 * Resolve the appropriate template for a tool based on its name and
 * result/args state. Returns a { renderCall, renderResult } pair.
 */
function resolveTemplate(tool: any): { renderCall?: (args: any, theme: any, context: any) => Component; renderResult?: (result: any, opts: any, theme: any, context: any) => Component } | null {
  const name = tool.name;

  // ── Tools with their own rendering (skip) ─────────────────────────
  if (name === "subagent") return null;
  if (name === "todo") return null; // hidden
  if (name === "questions" || name === "ask_question" || name === "ask_questions" || name === "question") return null;

  // ── Read (standard template, with path-based label) ─────────────────
  if (name === "read") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(orange(theme, "Read") + ` ${args.path ?? args.file ?? "?"}`);
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n");
        const filePath = context.args.path ?? context.args.file ?? "?";
        return standardTemplate("read", filePath, lines, opts.expanded, theme, {
          count: lines.length,
          unit: "line",
          isError: result.isError,
        });
      },
    };
  }

  // ── Write ─────────────────────────────────────────────────────────
  if (name === "write") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(orange(theme, "Write") + ` ${args.path ?? args.file ?? "?"}`);
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const contentStr = context.args.content || "";
        const lines = contentStr.split("\n");
        return writeTemplate(context.args.path ?? "?", lines, opts.expanded, theme);
      },
    };
  }

  // ── Edit ──────────────────────────────────────────────────────────
  if (name === "edit") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(orange(theme, "Update") + ` ${args.path ?? args.file ?? "?"}`);
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const diff = (result.details as any)?.diff as string | undefined;
        const diffLines = diff?.split("\n") || [];
        return editTemplate(context.args.path ?? "?", diffLines, opts.expanded, theme);
      },
    };
  }

  // ── Bash (execute template, shell = bash) ────────────────────────
  if (name === "bash") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        const cmd = args.command ?? "?";
        const truncated = cmd.split("\n")[0] || cmd;
        const maxDisplay = 50;
        const display = truncated.length > maxDisplay ? truncated.slice(0, maxDisplay - 3) + "..." : truncated;
        return line(orange(theme, "execute") + ` \x1b[38;2;90;180;250m{bash}\x1b[39m ${display}`);
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

  // ── Powershell / Pwsh (execute template, shell = pwsh) ──────────
  if (name === "powershell" || name === "pwsh") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        const cmd = args.command ?? "?";
        const truncated = cmd.split("\n")[0] || cmd;
        const maxDisplay = 50;
        const display = truncated.length > maxDisplay ? truncated.slice(0, maxDisplay - 3) + "..." : truncated;
        return line(orange(theme, "execute") + ` \x1b[38;2;90;180;250m{pwsh}\x1b[39m ${display}`);
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

  // ── Run Command (execute template, shell = shell) ────────────────
  if (name === "run_command") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(orange(theme, "execute") + ` \x1b[38;2;90;180;250m{shell}\x1b[39m ${(args.CommandLine ?? "?").split("\n")[0]}`);
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

  // ── Manage Task (standard template) ────────────────────────────────
  if (name === "manage_task") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(orange(theme, "Tasks") + ` ${args.Action} ${args.TaskId ?? ""}`.trim());
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n").filter((l: string) => l.trim());
        return standardTemplate("manage_task", `${context.args.Action} ${context.args.TaskId ?? ""}`.trim(), lines, opts.expanded, theme, {
          count: lines.length,
          unit: "line",
          isError: result.isError,
        });
      },
    };
  }

  // ── Schedule (standard template) ─────────────────────────────────
  if (name === "schedule") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(orange(theme, "Schedule") + ` ${args.DurationSeconds || args.CronExpression || "?"}`);
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

  // ── Web Search (standard template) ────────────────────────────────
  if (name === "web_search") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(orange(theme, "WebSearch") + ` "${(args.query ?? "").slice(0, 50)}"`);
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n").filter((l: string) => l.trim());
        return standardTemplate("web_search", context.args.query ?? "", lines, opts.expanded, theme, {
          count: lines.length,
          unit: "result",
          isError: result.isError,
        });
      },
    };
  }

  // ── Web Fetch (standard template) ────────────────────────────────
  if (name === "web_fetch" || name === "fetch_content" || name === "get_search_content") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(orange(theme, "WebFetch") + ` ${(args.url ?? "").slice(0, 60)}`);
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

  // ── Memory (standard template) ──────────────────────────────────
  if (name === "memory") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        const action = args.action ?? "?";
        const target = args.target ?? "";
        const label = args.content?.slice(0, 60) ?? args.old_text?.slice(0, 60) ?? "";
        return line(orange(theme, "Memory") + ` ${action}${target ? " (" + target + ")" : ""}${label ? " \u2192 " + label : ""}`);
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

  // ── Memory Search (standard template) ────────────────────────────
  if (name === "memory_search") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(orange(theme, "MemorySearch") + ` "${(args.query ?? "").slice(0, 50)}"`);
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
        const lines = full.split("\n").filter((l: string) => l.trim());
        return standardTemplate("memory_search", context.args.query ?? "", lines, opts.expanded, theme, {
          count: lines.length,
          unit: "result",
          isError: result.isError,
        });
      },
    };
  }

  // ── Session Search (standard template) ──────────────────────────
  if (name === "session_search") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(orange(theme, "SessionSearch") + ` "${(args.query ?? args.markdown ?? "").slice(0, 50)}"`);
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

  // ── Skill Manage (standard template) ─────────────────────────────
  if (name === "skill_manage") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(orange(theme, "SkillManage") + ` ${args.action ?? "?"}`);
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

  // ── Video Extract (standard template) ───────────────────────────
  if (name === "video_extract") {
    return {
      renderCall(args: any, theme: any, context: any) {
        if (context.expanded) return noOp();
        return line(orange(theme, "VideoExtract") + ` ${(args.url ?? "").slice(0, 60)}`);
      },
      renderResult(result: any, opts: any, theme: any, context: any) {
        const details = result.details as any;
        const title = details?.title || "(no title)";
        const totalChars = details?.totalChars || 0;
        const imgCount = details?.imageCount || 0;
        const lines = [`${title} (${totalChars} chars)`];
        if (imgCount > 0) lines.push(`${imgCount} image${imgCount !== 1 ? "s" : ""}`);
        return standardTemplate("video_extract", context.args.url ?? "", lines, opts.expanded, theme, {
          count: lines.length,
          unit: "item",
          isError: result.isError,
        });
      },
    };
  }

  // ── Generic Fallback ─────────────────────────────────────────────
  return {
    renderCall(args: any, theme: any, context: any) {
      if (context.expanded) return noOp();
      const argsLine = Object.values(args || {}).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(" ");
      return line(orange(theme, capitalizeToolName(name)) + ` ${argsLine.slice(0, 60)}`);
    },
    renderResult(result: any, opts: any, theme: any, context: any) {
      if ((result.details as any)?._isUnknownTool) {
        return line(orange(theme, capitalizeToolName(name)) + " tool not found");
      }
      const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
      const lines = full.split("\n").filter((l: string) => l.trim());
      return standardTemplate(name, "", lines, opts.expanded, theme, {
        count: lines.length,
        unit: "line",
        isError: result.isError,
      });
    },
  };
}

// ── patchTool ──────────────────────────────────────────────────────────

export function patchTool(tool: any): void {
  const EXCLUDED_TOOLS = new Set(["subagent"]);
  if (EXCLUDED_TOOLS.has(tool.name)) return;

  // Skip tools that already have custom rendering from their own extensions
  if (tool.renderShell === "self" && tool.renderResult && !tool.__compactui_patched) return;

  const template = resolveTemplate(tool);
  if (!template) return;

  if (tool.__compactui_patched) return;
  tool.__compactui_patched = true;
  tool.renderShell = "self";
  tool.renderCall = template.renderCall;
  tool.renderResult = template.renderResult;
}
