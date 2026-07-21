/**
 * rendering.ts — Unified tool rendering templates for compactui
 *
 * Template-based rendering system replacing per-tool renderCall/renderResult.
 * All tools use one of these templates:
 *
 * standardTemplate — read, memory, web_search, tasks, timers, session_search, etc.
 *   collapsed: toolname N unit
 *   detail ↳ first line of detail
 *   expanded: shows all detail lines with ↳ prefix
 *
 * writeTemplate — write tool
 *   collapsed: write path
 *             ↳ N lines
 *             1 content line
 *             2 content line
 *             ... N more lines ctrl+o to expand
 *   expanded: full content with line numbers
 *
 * editTemplate — edit tool
 *   collapsed: edit path
 *             ↳ Added N, removed M
 *             colored +/- diff lines
 *   expanded: full diff with +/- coloring
 *
 * executeTemplate — bash, powershell, run_command
 *   collapsed: execute {bash/pwsh} cmd
 *             first 5 output lines
 *             ... N more lines ctrl+o to expand
 *   expanded: full output with duration footer
 *
 * subagentTemplate — subagent tool
 *   collapsed: agentName N working M done
 *             ↳ per-agent summaries
 *   expanded: full status
 */

import { type Component, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// ── Constants ──────────────────────────────────────────────────────────

export const INDENT = " ";
export const DIM_GREY = "\x1b[38;2;140;140;140m";

// ── Helpers ────────────────────────────────────────────────────────────

export function orange(theme: any, text: string): string {
  return `\x1b[38;2;250;179;135m${text}\x1b[39m`;
}

export function capitalizeToolName(toolName: string): string {
  if (toolName === 'edit') return 'Update';
  return toolName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function getCommandName(cmd: string): string {
  cmd = cmd.trim();
  let firstArg = "";
  if (cmd.startsWith('"')) {
    const endQuote = cmd.indexOf('"', 1);
    firstArg = endQuote !== -1 ? cmd.slice(1, endQuote) : cmd;
  } else if (cmd.startsWith("'")) {
    const endQuote = cmd.indexOf("'", 1);
    firstArg = endQuote !== -1 ? cmd.slice(1, endQuote) : cmd;
  } else {
    firstArg = cmd.split(/\s+/)[0] || "";
  }
  let base = firstArg.split(/[\\/]/).pop() || "";
  base = base.replace(/\.(exe|cmd|bat|sh|ps1)$/i, "");
  return base || "command";
}

function formatDur(s: number): string {
  if (s < 0.01) return "0.0s";
  if (s < 60) return s.toFixed(1) + "s";
  return Math.floor(s / 60) + "m " + Math.floor(s % 60) + "s";
}

// ── ANSI wrap helper ───────────────────────────────────────────────────

function splitAnsiPrefix(rl: string, prefixLen: number): [string, string] {
  let ansiPrefix = "";
  let contentStr = "";
  let visibleCount = 0;
  let i = 0;
  while (i < rl.length) {
    if (rl[i] === '\x1b') {
      const end = rl.indexOf('m', i);
      if (end !== -1) {
        if (visibleCount < prefixLen) ansiPrefix += rl.slice(i, end + 1);
        else contentStr += rl.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (visibleCount < prefixLen) ansiPrefix += rl[i];
    else contentStr += rl[i];
    visibleCount++;
    i++;
  }
  return [ansiPrefix, contentStr];
}

function wrapWithPrefix(rl: string, width: number): string[] {
  const visible = rl.replace(/\x1b\[[0-9;]*m/g, "");
  const boxMatch = visible.match(/^(\s*[\u23BF\u2502\u2514]\s*)/);
  if (!boxMatch || boxMatch[1].length === 0) {
    const spaceMatch = visible.match(/^(\s+)/);
    if (!spaceMatch || spaceMatch[1].length === 0) return wrapTextWithAnsi(rl, width);
    const prefixLen = spaceMatch[1].length;
    const [ansiPrefix, contentStr] = splitAnsiPrefix(rl, prefixLen);
    const contentWidth = Math.max(10, width - prefixLen - 2);
    const wrappedContent = wrapTextWithAnsi(contentStr, contentWidth);
    if (wrappedContent.length === 0) return [ansiPrefix];
    const result = [ansiPrefix + wrappedContent[0]];
    const continuationPrefix = " ".repeat(prefixLen);
    for (let j = 1; j < wrappedContent.length; j++) {
      result.push(continuationPrefix + wrappedContent[j]);
    }
    return result;
  }
  const prefixLen = boxMatch[1].length;
  const [ansiPrefix, contentStr] = splitAnsiPrefix(rl, prefixLen);
  const contentWidth = Math.max(10, width - prefixLen - 2);
  const wrappedContent = wrapTextWithAnsi(contentStr, contentWidth);
  if (wrappedContent.length === 0) return [ansiPrefix];
  const result = [ansiPrefix + wrappedContent[0]];
  const subsequentPrefix = boxMatch[1].replace(/[\u23BF\u2502\u2514]/g, " ");
  for (let j = 1; j < wrappedContent.length; j++) {
    result.push(subsequentPrefix + wrappedContent[j]);
  }
  return result;
}

// ── Generic Template Component ────────────────────────────────────────

class TemplateComponent {
  _plainText: string;
  constructor(private renderFn: (width: number) => string[], plainText: string) {
    this._plainText = plainText;
  }
  render(width: number): string[] {
    try { return this.renderFn(width); } catch (e: any) { return [`\x1b[31mError rendering: ${e.message}\x1b[39m`]; }
  }
  invalidate() {}
}

// ══════════════════════════════════════════════════════════════════════
// TEMPLATE 1: Standard Tool
// ══════════════════════════════════════════════════════════════════════
//
// collapsed:
//   toolname N unit
//   ↳ first detail line
//   ... N more lines ctrl+o to expand
//
// expanded:
//   toolname(args)
//   ⎿ first detail line
//   second detail line
//   ... N more

export function standardTemplate(
  toolName: string,
  label: string,
  detailLines: string[],
  expanded: boolean,
  theme: any,
  options?: {
    count?: number;
    unit?: string;
    maxPreview?: number;
    maxExpanded?: number;
    isError?: boolean;
  },
): Component {
  const count = options?.count ?? detailLines.length;
  const unit = options?.unit ?? "line";
  const PREVIEW_MAX = options?.maxPreview ?? 3;
  const EXPANDED_MAX = options?.maxExpanded ?? 40;
  const cappedName = capitalizeToolName(toolName);

  // Collapsed view
  const previewLines = detailLines.slice(0, PREVIEW_MAX).filter(l => l.trim());
  const remaining = Math.max(0, count - PREVIEW_MAX);
  const hasContent = detailLines.length > 0;
  const countStr = count > 0 ? `${count} ${unit}${count !== 1 ? "s" : ""}` : "no output";

  if (!expanded) {
    const collapsedLines: string[] = [];
    collapsedLines.push(INDENT + orange(theme, cappedName) + ` ${countStr}`);

    if (options?.isError) {
      collapsedLines.push(INDENT + DIM_GREY + "\u23bf failed tool call" + "\x1b[39m");
      return line(collapsedLines.join("\n"));
    }

    if (hasContent) {
      for (let i = 0; i < previewLines.length; i++) {
        const prefix = i === 0 ? INDENT + DIM_GREY + "\u23bf  " : INDENT + "   ";
        const maxLen = 80;
        const truncated = visibleWidth(previewLines[i]) > maxLen ? previewLines[i].slice(0, maxLen - 3) + "..." : previewLines[i];
        collapsedLines.push(prefix + "\x1b[97m" + truncated + "\x1b[39m");
      }
      if (remaining > 0) {
        collapsedLines.push(INDENT + "  " + DIM_GREY + "... " + remaining + " more lines (ctrl+o to expand)\x1b[39m");
      }
    } else {
      collapsedLines.push(INDENT + DIM_GREY + "\u23bf " + countStr + "\x1b[39m");
    }

    return line(collapsedLines.join("\n"));
  }

  // Expanded view
  const show = detailLines.slice(0, EXPANDED_MAX);
  const hasMore = detailLines.length > EXPANDED_MAX;
  const raw: string[] = [];
  raw.push(orange(theme, cappedName) + "(" + label + ")");

  for (let i = 0; i < show.length; i++) {
    const prefix = i === 0 ? "\u23bf  " : "   ";
    raw.push(prefix + (show[i] || ""));
  }

  if (hasMore) {
    raw.push(DIM_GREY + "... " + (detailLines.length - EXPANDED_MAX) + " more " + unit + "s" + "\x1b[39m");
  }

  return new TemplateComponent((width: number) => {
    const result: string[] = [];
    for (const rl of raw) {
      if (!rl) result.push("");
      else if (visibleWidth(rl) <= width) result.push(rl);
      else result.push(...wrapWithPrefix(rl, width));
    }
    return result;
  }, [cappedName + "(" + label + ")", ...detailLines].join("\n"));
}

// ══════════════════════════════════════════════════════════════════════
// TEMPLATE 2: Write Tool
// ══════════════════════════════════════════════════════════════════════
//
// collapsed:
//   write path
//   ↳ N lines
//   1 content line with number
//   2 content line
//   ... N more lines ctrl+o to expand
//
// expanded:
//   write(path)
//   full content with line numbers

export function writeTemplate(
  path: string,
  contentLines: string[],
  expanded: boolean,
  theme: any,
): Component {
  const lineCount = contentLines.length;
  const PREVIEW_LINES = 5;
  const MAX_EXPANDED = 50;

  if (!expanded) {
    const collapsedLines: string[] = [];
    collapsedLines.push(INDENT + orange(theme, "Write") + ` ${path}`);
    collapsedLines.push(INDENT + DIM_GREY + "\u23bf " + lineCount + " line" + (lineCount !== 1 ? "s" : "") + "\x1b[39m");

    const previewLines = contentLines.slice(0, PREVIEW_LINES);
    for (let i = 0; i < previewLines.length; i++) {
      const num = String(i + 1).padStart(4, " ");
      const maxLen = 80;
      const truncated = visibleWidth(previewLines[i]) > maxLen ? previewLines[i].slice(0, maxLen - 3) + "..." : previewLines[i];
      collapsedLines.push(INDENT + DIM_GREY + `${num}\x1b[39m  \x1b[97m` + truncated + "\x1b[39m");
    }
    if (lineCount > PREVIEW_LINES) {
      const remaining = lineCount - PREVIEW_LINES;
      collapsedLines.push(INDENT + "  " + DIM_GREY + "... " + remaining + " more lines (ctrl+o to expand)\x1b[39m");
    }

    return line(collapsedLines.join("\n"));
  }

  // Expanded view
  const show = contentLines.slice(0, MAX_EXPANDED);
  const raw: string[] = [];
  raw.push(orange(theme, "Write") + "(" + path + ")");

  for (let i = 0; i < show.length; i++) {
    const num = String(i + 1).padStart(4, " ");
    raw.push(DIM_GREY + `${num}\x1b[39m  ${show[i]}`);
  }

  if (contentLines.length > MAX_EXPANDED) {
    raw.push(DIM_GREY + "... " + (contentLines.length - MAX_EXPANDED) + " more lines\x1b[39m");
  }

  return new TemplateComponent((width: number) => {
    const result: string[] = [];
    for (const rl of raw) {
      if (!rl) result.push("");
      else if (visibleWidth(rl) <= width) result.push(rl);
      else result.push(...wrapWithPrefix(rl, width));
    }
    return result;
  }, ["Write(" + path + ")", ...contentLines].join("\n"));
}

// ══════════════════════════════════════════════════════════════════════
// TEMPLATE 3: Edit Tool
// ══════════════════════════════════════════════════════════════════════
//
// collapsed:
//   edit path
//   ↳ Added N lines, removed M lines
//   colored +/- diff lines (3 lines)
//   ... N more lines ctrl+o to expand
//
// expanded:
//   edit(path)
//   └ summary
//   colored diff lines

export function editTemplate(
  path: string,
  diffLines: string[],
  expanded: boolean,
  theme: any,
): Component {
  // Count added/removed
  let added = 0;
  let removed = 0;
  for (const dl of diffLines) {
    if (dl.startsWith("+") && !dl.startsWith("+++")) added++;
    if (dl.startsWith("-") && !dl.startsWith("---")) removed++;
  }
  let summary = "";
  if (added > 0) summary += `Added ${added} line${added !== 1 ? "s" : ""}`;
  if (added > 0 && removed > 0) summary += ", ";
  if (removed > 0) summary += `removed ${removed} line${removed !== 1 ? "s" : ""}`;
  if (!summary) summary = "no changes";

  function colorize(lineTxt: string): string {
    const numSignMatch = lineTxt.match(/^( *\d+) ([+\-]) (.*)$/);
    if (numSignMatch) {
      const num = numSignMatch[1].trim().padStart(3, " ");
      const sign = numSignMatch[2];
      const rest = numSignMatch[3];
      if (sign === '+') return `${DIM_GREY}${num}\x1b[39m \x1b[48;2;20;60;20m\x1b[38;2;160;240;160m+${rest}\x1b[49m\x1b[39m`;
      return `${DIM_GREY}${num}\x1b[39m \x1b[48;2;60;20;20m\x1b[38;2;240;160;160m-${rest}\x1b[49m\x1b[39m`;
    }
    const numSignEmptyMatch = lineTxt.match(/^( *\d+) ([+\-])$/);
    if (numSignEmptyMatch) {
      const num = numSignEmptyMatch[1].trim().padStart(3, " ");
      const sign = numSignEmptyMatch[2];
      if (sign === '+') return `${DIM_GREY}${num}\x1b[39m \x1b[48;2;20;60;20m\x1b[38;2;160;240;160m+\x1b[49m\x1b[39m`;
      return `${DIM_GREY}${num}\x1b[39m \x1b[48;2;60;20;20m\x1b[38;2;240;160;160m-\x1b[49m\x1b[39m`;
    }
    if (lineTxt.startsWith('+')) return `\x1b[48;2;20;60;20m\x1b[38;2;160;240;160m+${lineTxt.slice(1)}\x1b[49m\x1b[39m`;
    if (lineTxt.startsWith('-')) return `\x1b[48;2;60;20;20m\x1b[38;2;240;160;160m-${lineTxt.slice(1)}\x1b[49m\x1b[39m`;
    return lineTxt;
  }

  const PREVIEW_LINES = 3;
  const MAX_EXPANDED = 50;

  if (!expanded) {
    const collapsedLines: string[] = [];
    collapsedLines.push(INDENT + orange(theme, "Update") + ` ${path}`);
    collapsedLines.push(INDENT + DIM_GREY + "\u23bf " + summary + "\x1b[39m");

    const previewLines = diffLines.slice(0, PREVIEW_LINES);
    for (const dl of previewLines) {
      collapsedLines.push(INDENT + "  " + colorize(dl));
    }
    if (diffLines.length > PREVIEW_LINES) {
      const remaining = diffLines.length - PREVIEW_LINES;
      collapsedLines.push(INDENT + "  " + DIM_GREY + "... " + remaining + " more lines (ctrl+o to expand)\x1b[39m");
    }

    return line(collapsedLines.join("\n"));
  }

  // Expanded view
  const show = diffLines.slice(0, MAX_EXPANDED);
  const raw: string[] = [];
  raw.push(orange(theme, "Update") + "(" + path + ")");
  raw.push(DIM_GREY + "\u2514 " + summary + "\x1b[39m");

  for (const dl of show) {
    raw.push(colorize(dl));
  }

  if (diffLines.length > MAX_EXPANDED) {
    raw.push(DIM_GREY + "... " + (diffLines.length - MAX_EXPANDED) + " more lines\x1b[39m");
  }

  return new TemplateComponent((width: number) => {
    const result: string[] = [];
    for (const rl of raw) {
      if (!rl) result.push("");
      else if (visibleWidth(rl) <= width) result.push(rl);
      else result.push(...wrapWithPrefix(rl, width));
    }
    return result;
  }, ["Update(" + path + ")", "\u2514 " + summary, ...diffLines].join("\n"));
}

// ══════════════════════════════════════════════════════════════════════
// TEMPLATE 4: Execute Tool
// ══════════════════════════════════════════════════════════════════════
//
// collapsed:
//   execute {bash} cmd
//   first 5 output lines
//   ... N more lines ctrl+o to expand
//
// expanded:
//   execute {bash}(cmd)
//   full output with duration footer

export function executeTemplate(
  shellType: string,
  cmd: string,
  outputLines: string[],
  expanded: boolean,
  result: any,
  theme: any,
  options?: { durationS?: number },
): Component {
  const PREVIEW_LINES = 5;
  const MAX_EXPANDED = 40;
  const isError = result.isError || false;
  const durationS = options?.durationS ?? -1;

  if (!expanded) {
    const collapsedLines: string[] = [];

    // Header: execute {bash} cmd
    const cmdDisplay = cmd.split("\n")[0] || cmd;
    const maxDisplay = 50;
    const truncatedCmd = cmdDisplay.length > maxDisplay ? cmdDisplay.slice(0, maxDisplay - 3) + "..." : cmdDisplay;
    collapsedLines.push(INDENT + orange(theme, "execute") + ` \x1b[38;2;90;180;250m{${shellType}}\x1b[39m ${truncatedCmd}`);

    if (isError) {
      collapsedLines.push(INDENT + DIM_GREY + "\u23bf failed tool call" + "\x1b[39m");
      return line(collapsedLines.join("\n"));
    }

    const previewLines = outputLines.filter(l => l.trim()).slice(0, PREVIEW_LINES);
    if (previewLines.length > 0) {
      for (let i = 0; i < previewLines.length; i++) {
        const prefix = i === 0 ? INDENT + DIM_GREY + "\u23bf  " : INDENT + "   ";
        const maxLen = 80;
        const truncated = visibleWidth(previewLines[i]) > maxLen ? previewLines[i].slice(0, maxLen - 3) + "..." : previewLines[i];
        collapsedLines.push(prefix + "\x1b[97m" + truncated + "\x1b[39m");
      }
      const totalLines = outputLines.filter(l => l.trim()).length;
      const remaining = Math.max(0, totalLines - PREVIEW_LINES);
      if (remaining > 0) {
        collapsedLines.push(INDENT + "  " + DIM_GREY + "... " + remaining + " more lines (ctrl+o to expand)\x1b[39m");
      }
    } else {
      collapsedLines.push(INDENT + DIM_GREY + "\u23bf no output\x1b[39m");
    }

    return line(collapsedLines.join("\n"));
  }

  // Expanded view
  const show = outputLines.slice(0, MAX_EXPANDED);
  const hasMore = outputLines.length > MAX_EXPANDED;
  const raw: string[] = [];

  raw.push(orange(theme, "execute") + ` \x1b[38;2;90;180;250m{${shellType}}\x1b[39m` + "(" + cmd + ")");

  for (let i = 0; i < show.length; i++) {
    const prefix = i === 0 ? "\u23bf  " : "   ";
    raw.push(prefix + (show[i] || ""));
  }

  if (hasMore) {
    raw.push(DIM_GREY + "... " + (outputLines.length - MAX_EXPANDED) + " more lines\x1b[39m");
  }

  // Duration footer
  if (durationS >= 0) {
    const durStr = durationS < 60
      ? durationS.toFixed(1) + "s"
      : Math.floor(durationS / 60) + "m " + Math.floor(durationS % 60) + "s";
    raw.push(DIM_GREY + "\u2514 Took " + durStr + "\x1b[39m");
  }

  return new TemplateComponent((width: number) => {
    const result: string[] = [];
    for (const rl of raw) {
      if (!rl) result.push("");
      else if (visibleWidth(rl) <= width) result.push(rl);
      else result.push(...wrapWithPrefix(rl, width));
    }
    return result;
  }, ["execute {" + shellType + "}(" + cmd + ")", ...outputLines].join("\n"));
}

// ══════════════════════════════════════════════════════════════════════
// TEMPLATE 5: Read Batch Template
// ══════════════════════════════════════════════════════════════════════
//
// Used for batched read calls in a single tool-use block.

export function readBatchTemplate(
  files: { path: string; lines: string[] }[],
  expanded: boolean,
  theme: any,
): Component {
  const fileCount = files.length;
  const PREVIEW_MAX = 5;

  if (!expanded) {
    const collapsedLines: string[] = [];
    collapsedLines.push(INDENT + orange(theme, "Read") + ` ${fileCount} file${fileCount !== 1 ? "s" : ""}`);

    const previewFiles = files.slice(0, PREVIEW_MAX);
    for (const f of previewFiles) {
      collapsedLines.push(INDENT + DIM_GREY + "\u23bf \x1b[39m" + f.path);
    }
    if (fileCount > PREVIEW_MAX) {
      const remaining = fileCount - PREVIEW_MAX;
      collapsedLines.push(INDENT + "  " + DIM_GREY + "... " + remaining + " more files (ctrl+o to expand)\x1b[39m");
    }

    return line(collapsedLines.join("\n"));
  }

  // Expanded view
  const raw: string[] = [];
  raw.push(orange(theme, "Read") + `(${fileCount} file${fileCount !== 1 ? "s" : ""})`);

  for (const f of files) {
    raw.push("");
    raw.push(DIM_GREY + "\u2514 " + f.path + "\x1b[39m");
    const contentPreview = f.lines.slice(0, 10);
    for (const l of contentPreview) {
      raw.push("   " + l);
    }
    if (f.lines.length > 10) {
      raw.push(DIM_GREY + "   ... " + (f.lines.length - 10) + " more lines\x1b[39m");
    }
  }

  return new TemplateComponent((width: number) => {
    const result: string[] = [];
    for (const rl of raw) {
      if (!rl) result.push("");
      else if (visibleWidth(rl) <= width) result.push(rl);
      else result.push(...wrapWithPrefix(rl, width));
    }
    return result;
  }, ["Read(" + fileCount + " files)", ...files.map(f => f.path)].join("\n"));
}

// ══════════════════════════════════════════════════════════════════════
// TEMPLATE 6: Subagent Template
// ══════════════════════════════════════════════════════════════════════
//
// collapsed:
//   worker 2 working 1 done
//   ↳ worker using tools...
//   ↳ reviewer finished
//
// expanded:
//   subagent(...)
//   per-agent detailed status

export function subagentTemplate(
  agents: { name: string; status: string; toolCount: number; durationS?: number; error?: string }[],
  expanded: boolean,
  theme: any,
): Component {
  const working = agents.filter(a => a.status === "running" || a.status === "pending").length;
  const done = agents.filter(a => a.status === "completed").length;
  const failed = agents.filter(a => a.status === "failed" || a.status === "error").length;

  if (!expanded) {
    const collapsedLines: string[] = [];
    const statusParts: string[] = [];
    if (working > 0) statusParts.push(`${working} working`);
    if (done > 0) statusParts.push(`${done} done`);
    if (failed > 0) statusParts.push(`${failed} failed`);

    const agentNames = agents.map(a => a.name).join(", ");
    collapsedLines.push(INDENT + orange(theme, "Subagent") + ` ${agentNames.length > 40 ? agentNames.slice(0, 40) + "..." : agentNames}`);
    if (statusParts.length > 0) {
      collapsedLines.push(INDENT + DIM_GREY + "\u23bf " + statusParts.join(", ") + "\x1b[39m");
    }

    for (const a of agents) {
      const statusIcon = a.status === "completed" ? "\u2713" : a.status === "failed" || a.status === "error" ? "\u2717" : "\u25B6";
      const statusColor = a.status === "completed" ? "\x1b[38;2;120;220;120m" : a.status === "failed" || a.status === "error" ? "\x1b[38;2;240;160;160m" : "\x1b[38;2;250;179;135m";
      collapsedLines.push(INDENT + "  " + statusColor + statusIcon + "\x1b[39m " + a.name + (a.error ? `: ${a.error.slice(0, 60)}` : ""));
    }

    return line(collapsedLines.join("\n"));
  }

  // Expanded view
  const raw: string[] = [];
  raw.push(orange(theme, "Subagent") + `(${agents.length} agent${agents.length !== 1 ? "s" : ""})`);

  for (const a of agents) {
    const statusColor = a.status === "completed" ? "\x1b[38;2;120;220;120m" : a.status === "failed" ? "\x1b[38;2;240;160;160m" : "\x1b[38;2;250;179;135m";
    const durStr = (a.durationS !== undefined && a.durationS > 0) ? ` \u00b7 ${formatDur(a.durationS)}` : "";
    raw.push(DIM_GREY + "\u2514 " + statusColor + a.name + "\x1b[39m" + ` [${a.status}]` + ` \u00b7 ${a.toolCount} tools` + durStr);
    if (a.error) {
      raw.push("   " + "\x1b[38;2;240;160;160m" + a.error + "\x1b[39m");
    }
  }

  return new TemplateComponent((width: number) => {
    const result: string[] = [];
    for (const rl of raw) {
      if (!rl) result.push("");
      else if (visibleWidth(rl) <= width) result.push(rl);
      else result.push(...wrapWithPrefix(rl, width));
    }
    return result;
  }, ["Subagent(" + agents.length + ")", ...agents.map(a => a.name + " [" + a.status + "]")].join("\n"));
}

// ══════════════════════════════════════════════════════════════════════
// DEPRECATED — kept for compatibility with legacy code
// ══════════════════════════════════════════════════════════════════════

export function line(text: string): Component {
  return {
    render(width: number) {
      return [truncateToWidth(text, width, "...")];
    },
    invalidate() {},
  };
}

export function noOp(): Component {
  return { render() { return []; }, invalidate() {} };
}

export function compactFailed(theme: any): Component {
  return line(INDENT + DIM_GREY + "\u23bf failed tool call" + "\x1b[39m");
}

export function captureResult(result: any, durationMs?: number): any {
  const fullText = result.content?.[0]?.text || "";
  const details: Record<string, unknown> = { ...result.details, _fullOutput: fullText };
  if (durationMs !== undefined) {
    details._durationS = durationMs / 1000;
  }
  return { ...result, details };
}
