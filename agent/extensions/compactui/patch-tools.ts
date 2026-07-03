/**
 * patch-tools.ts — Tool patching logic for compact rendering
 *
 * Intercepts tool renderCall/renderResult to apply compact two-line
 * display with orange name, args truncation, and expandable output.
 * Includes special-case handlers for todo, questions, powershell,
 * run_command, web_search, web_fetch, manage_task, and schedule.
 */

import * as path from "path";
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
  line, noOp, orange, compactCall, compactSummary, compactFailed,
  expandedBox, DIM_GREY, capitalizeToolName,
} from "./rendering.js";

// ── Constants ──────────────────────────────────────────────────────────

export const MAX_LINES = 5;
export const TRUNCATED_TOOLS = new Set(["bash", "powershell", "run_command"]);
export const KNOWN_TOOLS = new Set([
  "read", "write", "edit", "bash", "grep", "find", "ls",
  "web_search", "web_fetch", "fetch_content", "get_search_content",
  "run_command", "manage_task", "schedule", "subagent", "todo",
  "powershell", "questions", "video_extract", "skill_manage", "plan",
  "memory", "memory_search", "session_search",
]);

// ── CustomBlock (fallback component) ───────────────────────────────────

class CustomBlock {
  width: number;
  height: number;
  lines: string[];
  constructor(lines: string[]) {
    this.lines = lines;
    this.width = 0;
    this.height = lines.length;
  }
  invalidate() {}
  handleInput() {}
  render(width: number) {
    return this.lines.map((l: string) => truncateToWidth(l, width));
  }
}

// ── patchTool ──────────────────────────────────────────────────────────

export function patchTool(tool: any): void {
  const EXCLUDED_TOOLS = new Set(["bash", "ls", "grep", "find", "subagent"]);
  if (EXCLUDED_TOOLS.has(tool.name)) return;
  
  // Skip tools that already have custom rendering from their own extensions
  // (e.g., subagent with CompactToolBox, powershell with its own renderer)
  if (tool.renderShell === "self" && tool.renderResult && !tool.__compactui_patched) return;

  // ── Path Stripping Helper ─────────────────────────────────────────────
  const PATH_PREFIX = path.join(process.env.HOME || "~", ".pi", "agent") + "/";
  function stripPath(path: string): string {
    if (path && path.startsWith(PATH_PREFIX)) {
      return path.slice(PATH_PREFIX.length);
    }
    return path;
  }

  // ── Read / Write / Edit (path stripping) ──────────────────────────────
  if (tool.name === "read" || tool.name === "write" || tool.name === "edit") {
    if (tool.__compactui_patched) return;
    tool.__compactui_patched = true;
    tool.renderShell = "self";
    tool.renderCall = (args: any, theme: any, context: any) => {
      if (context.expanded) return noOp();
      const filePath = args.path || args.file || "?";
      return line(orange(theme, capitalizeToolName(tool.name)) + "(" + stripPath(filePath) + ")");
    };
    tool.renderResult = (result: any, opts: any, theme: any, context: any) => {
      if (result.isError) return compactFailed(theme);
      if (!opts.expanded) return noOp();
      // For expanded view, show the full path
      const filePath = context.args.path || context.args.file || "?";
      const full = (result.details as any)?._fullOutput || result.content?.[0]?.text || "";
      const lines = full.split("\n");
      return expandedBox(theme, tool.name, filePath, lines, 40);
    };
    return;
  }

  // ── Ask Question ───────────────────────────────────────────────────────
  if (tool.name === "ask_question" || tool.name === "ask_questions" || tool.name === "questions" || tool.name === "question") {
    if (tool.__compactui_patched) return;
    tool.__compactui_patched = true;
    tool.renderShell = "self";
    tool.renderCall = (args: any, theme: any, context: any) => {
      if (context.expanded) return noOp();
      let count = 1;
      if (args && Array.isArray(args.questions)) count = args.questions.length;
      return line(orange(theme, capitalizeToolName(tool.name)) + "(asking " + count + ` question${count === 1 ? '' : 's'}` + ")");
    };
    tool.renderResult = (result: any, opts: any, theme: any, context: any) => {
      if (result.isError) return compactFailed(theme);
      
      const details = result.details as any;
      const questions = details?.questions || [];
      const answers = details?.answers || [];
      const cancelled = details?.cancelled || false;
      
      if (!opts.expanded) {
        if (cancelled) {
          return line(DIM_GREY + `\u23bf cancelled` + "\x1b[39m");
        }
        const count = answers.length;
        return line(DIM_GREY + `\u23bf answered ${count} question${count === 1 ? '' : 's'}` + "\x1b[39m");
      } else {
        const res: string[] = [];
        const bullet = '\u25cf ';
        res.push("  " + bullet + 'User answered ' + capitalizeToolName(tool.name) + ':');
        
        // Build question-answer pairs
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          const answer = answers[i];
          const questionText = q.prompt || q.label || '?';
          let answerText = 'no answer';
          if (answer) {
            if (answer.source === 'custom') {
              answerText = answer.value || 'custom';
            } else if (answer.label) {
              answerText = answer.label;
            } else if (typeof answer.optionIndex === 'number') {
              answerText = String(answer.optionIndex + 1);
            }
          }
          const prefix = i === 0 ? "\u23bf " : "   "; // ⎿ (2 cols) + 1 space, subsequent 3 spaces
          const lineText = `${questionText} \u2192 ${answerText}`;
          res.push("  " + DIM_GREY + prefix + "\x1b[39m" + "\u00b7 " + lineText);
        }
        
        return new CustomBlock(res) as any;
      }
    };
    return;
  }

  // ── Pwsh / Powershell ──────────────────────────────────────────────────
  if (tool.name === "powershell" || tool.name === "pwsh") {
    if (tool.__compactui_patched) return;
    tool.__compactui_patched = true;
    tool.renderShell = "self";
    tool.renderCall = (args: any, theme: any, context: any) => {
      if (context.expanded) return noOp();
      return compactCall("powershell", args.command ?? "?", theme);
    };
    tool.renderResult = (result: any, opts: any, theme: any, context: any) => {
      const details = result.details as Record<string, unknown> | undefined;
      const full = (details?._fullOutput as string) || result.content?.[0]?.text || "";
      const lines = full.split("\n");
      if (!opts.expanded) {
        if (result.isError) return compactFailed(theme);
        return compactSummary(theme, "Output", lines.length, "line", full);
      }

      return expandedBox(theme, "powershell", context.args.command ?? "", lines, 40);
    };
    return;
  }

  // ── Run Command ─────────────────────────────────────────────────────────
  if (tool.name === "run_command") {
    if (tool.__compactui_patched) return;
    tool.__compactui_patched = true;
    tool.renderShell = "self";
    tool.renderCall = (args: any, theme: any, context: any) => {
      if (context.expanded) return noOp();
      return compactCall("run_command", args.CommandLine as string || "?", theme);
    };
    tool.renderResult = (result: any, opts: any, theme: any, context: any) => {
      const details = result.details as Record<string, unknown> | undefined;
      const full = (details?._fullOutput as string) || result.content?.[0]?.text || "";
      const lines = full.split("\n");
      if (!opts.expanded) {
        if (result.isError) return compactFailed(theme);
        return compactSummary(theme, "Output", lines.length, "line", full);
      }
      return expandedBox(theme, "run_command", context.args.CommandLine ?? "", lines, 40);
    };
    return;
  }

  // ── Web Search ─────────────────────────────────────────────────────────
  if (tool.name === "web_search") {
    if (tool.__compactui_patched) return;
    tool.__compactui_patched = true;
    tool.renderShell = "self";
    tool.renderCall = (args: any, theme: any, context: any) => {
      if (context.expanded) return noOp();
      return compactCall("web_search", (args.query as string) || "?", theme);
    };
    tool.renderResult = (result: any, opts: any, theme: any, context: any) => {
      const details = result.details as Record<string, unknown> | undefined;
      const full = (details?._fullOutput as string) || result.content?.[0]?.text || "";
      const lines = full.split("\n");
      if (!opts.expanded) {
        if (result.isError) return compactFailed(theme);
        return compactSummary(theme, "Found", lines.length, "result", full);
      }
      return expandedBox(theme, "web_search", context.args.query ?? "", lines, 40);
    };
    return;
  }

  // ── Web Fetch / Fetch Content ──────────────────────────────────────────
  if (tool.name === "web_fetch" || tool.name === "fetch_content") {
    if (tool.__compactui_patched) return;
    tool.__compactui_patched = true;
    tool.renderShell = "self";
    tool.renderCall = (args: any, theme: any, context: any) => {
      if (context.expanded) return noOp();
      return compactCall(tool.name, (args.url as string) || "?", theme);
    };
    tool.renderResult = (result: any, opts: any, theme: any, context: any) => {
      const details = result.details as Record<string, unknown> | undefined;
      const full = (details?._fullOutput as string) || result.content?.[0]?.text || "";
      const lines = full.split("\n");
      if (!opts.expanded) {
        if (result.isError) return compactFailed(theme);
        return compactSummary(theme, "Fetched", lines.length, "line", full);
      }
      return expandedBox(theme, tool.name, context.args.url ?? "", lines, 40);
    };
    return;
  }

  // ── Manage Task ────────────────────────────────────────────────────────
  if (tool.name === "manage_task") {
    if (tool.__compactui_patched) return;
    tool.__compactui_patched = true;
    tool.renderShell = "self";
    tool.renderCall = (args: any, theme: any, context: any) => {
      if (context.expanded) return noOp();
      return compactCall("manage_task", `${args.Action} ${args.TaskId || ""}`.trim(), theme);
    };
    tool.renderResult = (result: any, opts: any, theme: any, context: any) => {
      const details = result.details as Record<string, unknown> | undefined;
      const full = (details?._fullOutput as string) || result.content?.[0]?.text || "";
      if (!opts.expanded) {
        if (result.isError) return compactFailed(theme);
        const taskCount = full.includes("TaskId") || full.includes("task") ? 1 : 0;
        return compactSummary(theme, "Checked", taskCount, "task", full);
      }
      const lines = full.split("\n");
      return expandedBox(theme, "manage_task", `${context.args.Action} ${context.args.TaskId || ""}`.trim(), lines, 40);
    };
    return;
  }

  // ── Schedule ───────────────────────────────────────────────────────────
  if (tool.name === "schedule") {
    if (tool.__compactui_patched) return;
    tool.__compactui_patched = true;
    tool.renderShell = "self";
    tool.renderCall = (args: any, theme: any, context: any) => {
      if (context.expanded) return noOp();
      let argsLine = "";
      if (args.DurationSeconds) argsLine = `${args.DurationSeconds}s "${args.Prompt}"`;
      else if (args.CronExpression) argsLine = `cron "${args.CronExpression}" "${args.Prompt}"`;
      return compactCall("schedule", argsLine, theme);
    };
    tool.renderResult = (result: any, opts: any, theme: any, context: any) => {
      const details = result.details as Record<string, unknown> | undefined;
      const full = (details?._fullOutput as string) || result.content?.[0]?.text || "";
      if (!opts.expanded) {
        if (result.isError) return compactFailed(theme);
        const taskCount = full.includes("timerId") || full.includes("cronId") || full.includes("scheduled") ? 1 : 0;
        return compactSummary(theme, "Scheduled", taskCount, "task", full);
      }
      const lines = full.split("\n");
      let argsLine = "";
      if (context.args.DurationSeconds) argsLine = `${context.args.DurationSeconds}s "${context.args.Prompt}"`;
      else if (context.args.CronExpression) argsLine = `cron "${context.args.CronExpression}" "${context.args.Prompt}"`;
      return expandedBox(theme, "schedule", argsLine, lines, 40);
    };
    return;
  }

  // ── Generic Fallback ───────────────────────────────────────────────────
  if (tool.__compactui_patched) return;
  tool.__compactui_patched = true;
  tool.renderShell = "self";

  tool.renderCall = (args: any, theme: any, context: any) => {
    if (context.expanded) return noOp();
    const argsLine = Object.values(args || {}).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(" ");
    return compactCall(tool.name, argsLine, theme);
  };

  tool.renderResult = (result: any, opts: any, theme: any, context: any) => {
    if ((result.details as any)?._isUnknownTool) {
      const toolName = tool.name || (context.args as any)?.name || "unknown";
      return line(orange(theme, capitalizeToolName(toolName)) + " " + theme.fg("error", "tool not found"));
    }

    const argsLine = Object.values(context.args || {}).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(" ");
    const content = result.content?.[0];
    const text = content?.type === "text" ? content.text : "";
    const lines = text.split("\n").filter((l: string) => l.trim());

    if (!opts.expanded) {
      if (result.isError) return compactFailed(theme);
      
      // Detect memory operations and show appropriate summary
      let summary = "output";
      let unit = "line";
      if (tool.name === "memory") {
        const action = (context.args as any)?.action || "";
        const target = (context.args as any)?.target || "";
        if (action === "add") {
          summary = "Added";
          unit = target === "memory" ? "memory" : "entry";
        } else if (action === "replace") {
          summary = "Edited";
          unit = target === "memory" ? "memory" : "entry";
        } else if (action === "remove") {
          summary = "Removed";
          unit = target === "memory" ? "memory" : "entry";
        }
      }
      
      return compactSummary(theme, summary, lines.length, unit, text);
    }

    return expandedBox(theme, tool.name, argsLine, lines, 40);
  };
}