/**
 * rendering.ts — Shared rendering primitives for compactui
 *
 * Compact tool rendering helpers: line components, orange tool names,
 * compact call/result, expanded box, diff display, duration formatting.
 */

import { type Component, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// ── Constants ──────────────────────────────────────────────────────────

export const INDENT = " "; // Single space indent for tools
export const HINT = " (ctrl+o to expand)";
export const DIM_GREY = "\x1b[38;2;140;140;140m"; // Consistent dim color for all tool summaries

// ── Component Factories ────────────────────────────────────────────────

export function line(text: string): Component {
  return {
    render(width) {
      return [truncateToWidth(text, width, "...")];
    },
    invalidate() {},
  };
}

/** Blank spacer line used for uniform element spacing. */
export function spacer(): Component {
  return {
    __compactui_spacer: true,
    render() {
      return [""];
    },
    invalidate() {},
  };
}

/** No-op component that renders nothing (avoids extra newline). */
export function noOp(): Component {
  return {
    render() { return []; },
    invalidate() {},
  };
}

export function orange(theme: any, text: string): string {
  return `\x1b[38;2;250;179;135m${text}\x1b[39m`;
}

/** Convert tool_name to Title Case: run_command → Run Command */
export function capitalizeToolName(toolName: string): string {
  // Special case: edit → Update
  if (toolName === 'edit') return 'Update';
  return toolName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function compactCall(toolName: string, argsStr: string, theme: any): Component {
  let display = argsStr.split("\n")[0] ?? argsStr;
  const maxDisplay = 40;
  if (display.length > maxDisplay) display = display.slice(0, maxDisplay - 3) + "...";
  else if (display.length < argsStr.length) display += "...";
  const capitalizedName = capitalizeToolName(toolName);
  return line(INDENT + orange(theme, capitalizedName) + "(" + display + ")");
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

export function compactSummary(theme: any, summary: string, count: number, unit: string, fullOutput?: string): Component {
  const PREVIEW_LINES = 3;
  const lines = fullOutput ? fullOutput.split("\n").filter(l => l.trim()) : [];
  const showPreview = lines.length > 0;
  const previewLines = lines.slice(0, PREVIEW_LINES);
  const remaining = count > PREVIEW_LINES ? count - PREVIEW_LINES : 0;
  
  const components: Component[] = [];
  
  if (showPreview) {
    // Show first 3 lines of output
    for (let i = 0; i < previewLines.length; i++) {
      const prefix = i === 0 ? INDENT + DIM_GREY + "\u23bf  " : INDENT + "   ";
      const lineText = previewLines[i];
      // Truncate long lines — use visibleWidth to skip ANSI escape bytes
      const maxLen = 80;
      const truncated = visibleWidth(lineText) > maxLen ? lineText.slice(0, maxLen - 3) + "..." : lineText;
      components.push(line(prefix + "\x1b[97m" + truncated + "\x1b[39m"));
    }
    // Show truncation message
    if (remaining > 0) {
      components.push(line(INDENT + "  " + DIM_GREY + "... " + remaining + " more lines (ctrl+o to expand)\x1b[39m"));
    }
  } else {
    // Fallback to summary
    const countStr = count > 0 ? `${count} ${unit}${count !== 1 ? "s" : ""}` : "no output";
    components.push(line(INDENT + DIM_GREY + "\u23bf " + countStr + " of output\x1b[39m"));
  }
  
  return {
    render(width: number) {
      return components.flatMap(c => c.render(width));
    },
    invalidate() {},
  };
}

export function compactFailed(theme: any): Component {
  return line(INDENT + DIM_GREY + "\u23bf failed tool call" + "\x1b[39m");
}



// ── ANSI prefix/content splitting (shared by wrapWithPrefix & wrapDiffLine) ──

/**
 * Walk a raw ANSI string, splitting into the ANSI-prefixed portion up to
 * `prefixLen` visible characters, and the remaining content string.
 * Returns [ansiPrefix, contentStr].
 */
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

// ── Wrap with Prefix (for expanded box lines) ──────────────────────────

export function wrapWithPrefix(rl: string, width: number): string[] {
  const visible = rl.replace(/\x1b\[[0-9;]*m/g, "");
  // Match prefix: leading spaces + ⎿ (U+23BF) or │ or └ + trailing spaces
  // This handles formats like " ⎿ " or " │ " or "└ " or just "│ "
  const boxMatch = visible.match(/^(\s*[\u23BF\u2502\u2514]\s*)/);

  if (!boxMatch || boxMatch[1].length === 0) {
    // No box-drawing char — check for plain leading-spaces prefix (continuation lines)
    // e.g. "   content" where the 3 leading spaces are the indent
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

  // Check if content starts with line number (e.g., "   59  content")
  // If so, continuation lines should not repeat the line number
  const lineNumMatch = contentStr.match(/^(\s*\d+\s{2})/);
  const lineNumLen = lineNumMatch ? lineNumMatch[1].length : 0;
  const contentWithoutLineNum = lineNumMatch ? contentStr.slice(lineNumLen) : contentStr;
  
  // Content width with 2-char right margin
  const contentWidth = Math.max(10, width - prefixLen - 2);
  const wrappedContent = wrapTextWithAnsi(contentWithoutLineNum, contentWidth);
  if (wrappedContent.length === 0) return [ansiPrefix];

  const result = [ansiPrefix + (lineNumMatch ? lineNumMatch[1] : "") + wrappedContent[0]];
  // Subsequent lines: replace box-drawing char with space, keep trailing spaces
  // Do NOT include line number on continuation lines
  const subsequentPrefix = boxMatch[1].replace(/[\u23BF\u2502\u2514]/g, " ");
  for (let j = 1; j < wrappedContent.length; j++) {
    result.push(subsequentPrefix + " ".repeat(lineNumLen) + wrappedContent[j]);
  }
  return result;
}

// ── Expanded Box ───────────────────────────────────────────────────────

export function expandedBox(theme: any, headerName: string, argsLine: string, lines: string[], limit: number, moreSuffix = ""): Component {
  const show = lines.slice(0, limit);
  const hasMore = lines.length > limit;
  const raw: string[] = [];
  let moreLine = "";
  const capitalizedName = capitalizeToolName(headerName);

  // Output lines: ⎿ on first line, spaces on following lines
  // No padding - header is also at position 0
  for (let i = 0; i < show.length; i++) {
    // ⎿ is 1 char, ⎿ + 2 spaces = 3 chars total, same as 3 spaces on subsequent lines
    const prefix = i === 0 ? "\u23bf  " : "   "; // ⎿ + 2 spaces, subsequent lines 3 spaces
    raw.push(prefix + theme.fg("text", show[i]));
  }

  if (hasMore) {
    const moreText = moreSuffix ? " more " + moreSuffix : " more";
    moreLine = DIM_GREY + "... " + (lines.length - limit) + moreText + "\x1b[39m";
  }

  // Store plain text version for copy/paste
  const plainTextLines = [capitalizedName + "(" + argsLine + ")"];
  for (const line of show) {
    plainTextLines.push(line);
  }
  if (hasMore) {
    const moreTextPt = moreSuffix ? " more " + moreSuffix : " more";
    plainTextLines.push("... " + (lines.length - limit) + moreTextPt);
  }

  class GenericComponent {
    _plainText: string;
    constructor(private renderFn: (width: number) => string[], plainText: string) {
      this._plainText = plainText;
    }
    render(width: number): string[] {
      try { return this.renderFn(width); } catch (e: any) { return [`\x1b[31mError rendering: ${e.message}\x1b[39m`]; }
    }
    invalidate() {}
    handleInput() {}
  }

  return new GenericComponent((width: number) => {
      const result: string[] = [];
      const headerPrefix = orange(theme, capitalizedName) + "(";
      // NOTE: headerPrefixWidth must track *visible* width (plain text characters),
      // not the ANSI-escaped string length, since it is used to compute
      // available wrapping width via subtraction from the terminal width.
      const headerPrefixWidth = capitalizedName.length + 1;
      const argsWidth = Math.max(10, width - headerPrefixWidth - 1);

      const cleanArgsLine = argsLine.replace(/\r/g, "").replace(/^\n+/, "");
      const wrappedArgs = wrapTextWithAnsi(cleanArgsLine, argsWidth);
      if (cleanArgsLine.length === 0) {
        // No args - just show header without brackets
        result.push(truncateToWidth(orange(theme, capitalizedName), width));
      } else if (wrappedArgs.length === 0) {
        result.push(truncateToWidth(headerPrefix + ")", width));
      } else {
        for (let i = 0; i < wrappedArgs.length; i++) {
          if (i === 0) {
            const suffix = wrappedArgs.length === 1 ? ")" : "";
            result.push(truncateToWidth(headerPrefix + wrappedArgs[i] + suffix, width));
          } else {
            const prefix = " ".repeat(headerPrefixWidth);
            const suffix = i === wrappedArgs.length - 1 ? ")" : "";
            result.push(truncateToWidth(prefix + wrappedArgs[i] + suffix, width));
          }
        }
      }

      for (const rl of raw) {
        if (!rl) result.push("");
        else if (visibleWidth(rl) <= width) result.push(rl);
        else result.push(...wrapWithPrefix(rl, width));
      }
      // Append more line separately — never with ⎿ prefix
      if (moreLine) {
        if (visibleWidth(moreLine) <= width) result.push(moreLine);
        else result.push(...wrapTextWithAnsi(moreLine, width));
      }
      return result;
  }, plainTextLines.join("\n"));
}

// ── Diff Coloring ──────────────────────────────────────────────────────

export function colorizeDiffLine(theme: any, line: string): string {
  // ── Format A: "NNN + content" or "NNN - content" (number, space, sign, space, content)
  // This is the pi edit tool's format for changed lines
  const numSignMatch = line.match(/^( *\d+) ([+\-]) (.*)$/);
  if (numSignMatch) {
    const num = numSignMatch[1].trim().padStart(3, " ");
    const sign = numSignMatch[2];
    const rest = numSignMatch[3];
    if (sign === '+') {
      const greenText = "\x1b[38;2;160;240;160m";
      const greenBg = "\x1b[48;2;20;60;20m";
      return `${DIM_GREY}${num}\x1b[39m ${greenBg}${greenText}+${rest}\x1b[49m\x1b[39m`;
    }
    const redText = "\x1b[38;2;240;160;160m";
    const redBg = "\x1b[48;2;60;20;20m";
    return `${DIM_GREY}${num}\x1b[39m ${redBg}${redText}-${rest}\x1b[49m\x1b[39m`;
  }

  // ── Format A2: "NNN +" or "NNN -" (sign with no content — empty added/removed line)
  const numSignEmptyMatch = line.match(/^( *\d+) ([+\-])$/);
  if (numSignEmptyMatch) {
    const num = numSignEmptyMatch[1].trim().padStart(3, " ");
    const sign = numSignEmptyMatch[2];
    if (sign === '+') {
      const greenText = "\x1b[38;2;160;240;160m";
      const greenBg = "\x1b[48;2;20;60;20m";
      return `${DIM_GREY}${num}\x1b[39m ${greenBg}${greenText}+\x1b[49m\x1b[39m`;
    }
    const redText = "\x1b[38;2;240;160;160m";
    const redBg = "\x1b[48;2;60;20;20m";
    return `${DIM_GREY}${num}\x1b[39m ${redBg}${redText}-\x1b[49m\x1b[39m`;
  }

  // ── Format B: "NNN content" (number, space, content — context line, no sign)
  const numContextMatch = line.match(/^( *\d+) (.+)$/);
  if (numContextMatch) {
    const num = numContextMatch[1].trim().padStart(3, " ");
    const rest = numContextMatch[2];
    return `${DIM_GREY}${num}\x1b[39m  ${rest}`;
  }

  // ── Format C: bare number — "NNN" or "NNN " (empty context line)
  const numBareMatch = line.match(/^( *\d+) *$/);
  if (numBareMatch) {
    const num = numBareMatch[1].trim().padStart(3, " ");
    return `${DIM_GREY}${num}\x1b[39m`;
  }

  // ── Format D: sign-first — "+ 59 content" or "- 59 content"
  const signFirstMatch = line.match(/^([+\-]) *(\d+)(.*)$/);
  if (signFirstMatch) {
    const sign = signFirstMatch[1];
    const num = signFirstMatch[2].padStart(3, " ");
    const rest = signFirstMatch[3];
    if (sign === '+') {
      const greenText = "\x1b[38;2;160;240;160m";
      const greenBg = "\x1b[48;2;20;60;20m";
      return `${DIM_GREY}${num}\x1b[39m ${greenBg}${greenText}+${rest}\x1b[49m\x1b[39m`;
    }
    const redText = "\x1b[38;2;240;160;160m";
    const redBg = "\x1b[48;2;60;20;20m";
    return `${DIM_GREY}${num}\x1b[39m ${redBg}${redText}-${rest}\x1b[49m\x1b[39m`;
  }

  // ── Format E: standard unified diff (no line numbers): "+added", "-removed"
  if (line.startsWith('+')) {
    const greenText = "\x1b[38;2;160;240;160m";
    const greenBg = "\x1b[48;2;20;60;20m";
    return `${greenBg}${greenText}+${line.slice(1)}\x1b[49m\x1b[39m`;
  }
  if (line.startsWith('-')) {
    const redText = "\x1b[38;2;240;160;160m";
    const redBg = "\x1b[48;2;60;20;20m";
    return `${redBg}${redText}-${line.slice(1)}\x1b[49m\x1b[39m`;
  }

  return theme.fg("text", line);
}

/**
 * Wrap a diff line with proper indentation for continuation lines.
 * For numbered diffs: "   NNN +" → continuation "         +"
 * For standard unified diffs: "+content" → continuation "+"
 */
export function wrapDiffLine(rl: string, width: number): string[] {
  const visible = rl.replace(/\x1b\[[0-9;]*m/g, "");

  // Match numbered diff prefix: spaces + line number + space + sign
  // e.g., "   59 +" or "   59 -" or "   59  "
  const numberedMatch = visible.match(/^(\s*\d+\s*)([+\- ])/);
  if (numberedMatch && numberedMatch[1].length > 0) {
    const numAndSpaces = numberedMatch[1];
    const sign = numberedMatch[2];
    const prefixLen = numAndSpaces.length + 1; // +1 for the sign

    const [ansiPrefix, contentStr] = splitAnsiPrefix(rl, prefixLen);

    // Content width with 2-char right margin
    const contentWidth = Math.max(10, width - prefixLen - 2);
    const wrappedContent = wrapTextWithAnsi(contentStr, contentWidth);
    if (wrappedContent.length === 0) return [ansiPrefix];

    const signBg = sign === '+'
      ? "\x1b[48;2;20;60;20m"
      : sign === '-'
        ? "\x1b[48;2;60;20;20m"
        : "";
    const signFg = sign === '+'
      ? "\x1b[38;2;160;240;160m"
      : sign === '-'
        ? "\x1b[38;2;240;160;160m"
        : "";

    const firstLine = ansiPrefix + wrappedContent[0] + (signBg ? "\x1b[49m\x1b[39m" : "");
    const result = [firstLine];

    // Subsequent lines: no line number, just spaces + colored space instead of sign
    const subsequentPrefix = " ".repeat(numAndSpaces.length) + 
      (signBg ? `${signBg}${signFg} ` : "   ");

    for (let j = 1; j < wrappedContent.length; j++) {
      const lineText = subsequentPrefix + wrappedContent[j] + (signBg ? "\x1b[49m\x1b[39m" : "");
      result.push(lineText);
    }
    return result;
  }

  // Standard unified diff format (no line numbers): colored sign is first visible char
  const signMatch = visible.match(/^([+\- ])/);
  if (signMatch) {
    const sign = signMatch[1];
    const prefixLen = 1; // just the sign char
    const [ansiPrefix, contentStr] = splitAnsiPrefix(rl, prefixLen);
    const contentWidth = Math.max(10, width - prefixLen - 2);
    const wrappedContent = wrapTextWithAnsi(contentStr, contentWidth);
    if (wrappedContent.length === 0) return [ansiPrefix];

    const signBg = sign === '+'
      ? "\x1b[48;2;20;60;20m"
      : sign === '-'
        ? "\x1b[48;2;60;20;20m"
        : "";

    const firstLine = ansiPrefix + wrappedContent[0] + (signBg ? "\x1b[49m\x1b[39m" : "");
    const result = [firstLine];
    
    // Continuation: replace sign with space in ansiPrefix
    const subsequentPrefix = ansiPrefix.replace(/([+\-])/, " ");
    for (let j = 1; j < wrappedContent.length; j++) {
      const lineText = subsequentPrefix + wrappedContent[j] + (signBg ? "\x1b[49m\x1b[39m" : "");
      result.push(lineText);
    }
    return result;
  }

  return wrapTextWithAnsi(rl, width);
}

function padBackground(line: string, width: number): string {
  const w = visibleWidth(line);
  if (w >= width) return line;
  const padding = " ".repeat(width - w);
  if (line.includes("\x1b[48;")) {
    if (line.endsWith("\x1b[49m\x1b[39m")) {
      return line.slice(0, -10) + padding + "\x1b[49m\x1b[39m";
    }
    if (line.endsWith("\x1b[39m\x1b[49m")) {
      return line.slice(0, -10) + padding + "\x1b[39m\x1b[49m";
    }
    if (line.endsWith("\x1b[49m")) {
      return line.slice(0, -5) + padding + "\x1b[49m";
    }
  }
  return line + padding;
}

export function diffExpandedBox(theme: any, headerName: string, argsLine: string, lines: string[], limit: number, moreSuffix = ""): Component {
  const show = lines.slice(0, limit);
  const hasMore = lines.length > limit;
  const raw: string[] = [];
  let moreLine = "";
  const capitalizedName = capitalizeToolName(headerName);

  // Count added/removed lines from diff (exclude hunk headers +++/---)
  let added = 0;
  let removed = 0;
  for (const dl of lines) {
    if (dl.startsWith("+") && !dl.startsWith("+++")) added++;
    if (dl.startsWith("-") && !dl.startsWith("---")) removed++;
  }
  let summary = "";
  if (added > 0) summary += `Added ${added} line${added !== 1 ? "s" : ""}`;
  if (added > 0 && removed > 0) summary += ", ";
  if (removed > 0) summary += `removed ${removed} line${removed !== 1 ? "s" : ""}`;
  if (!summary) summary = "no changes";

  // First content line is the summary line
  raw.push(DIM_GREY + "└ " + summary + "\x1b[39m");

  for (let i = 0; i < show.length; i++) {
    raw.push(colorizeDiffLine(theme, show[i]));
  }

  if (hasMore) {
    const moreText = moreSuffix ? " more " + moreSuffix : " more";
    moreLine = DIM_GREY + "... " + (lines.length - limit) + moreText + "\x1b[39m";
  }

  // Store plain text version for copy/paste
  const plainTextLines = [
    capitalizedName + "(" + argsLine + ")",
    "└ " + summary,
    ...show
  ];
  if (hasMore) {
    const moreTextPt = moreSuffix ? " more " + moreSuffix : " more";
    plainTextLines.push("... " + (lines.length - limit) + moreTextPt);
  }

  class GenericComponent {
    _plainText: string;
    constructor(private renderFn: (width: number) => string[], plainText: string) {
      this._plainText = plainText;
    }
    render(width: number): string[] {
      try { return this.renderFn(width); } catch (e: any) { return [`\x1b[31mError rendering: ${e.message}\x1b[39m`]; }
    }
    invalidate() {}
    handleInput() {}
  }

  return new GenericComponent((width: number) => {
      const result: string[] = [];
      const headerPrefix = orange(theme, capitalizedName) + "(";
      const headerPrefixWidth = capitalizedName.length + 1;
      const argsWidth = Math.max(10, width - headerPrefixWidth - 1);

      const cleanArgsLine = argsLine.replace(/\r/g, "").replace(/^\n+/, "");
      const wrappedArgs = wrapTextWithAnsi(cleanArgsLine, argsWidth);
      if (cleanArgsLine.length === 0) {
        result.push(truncateToWidth(orange(theme, capitalizedName), width));
      } else if (wrappedArgs.length === 0) {
        result.push(truncateToWidth(headerPrefix + ")", width));
      } else {
        for (let i = 0; i < wrappedArgs.length; i++) {
          if (i === 0) {
            const suffix = wrappedArgs.length === 1 ? ")" : "";
            result.push(truncateToWidth(headerPrefix + wrappedArgs[i] + suffix, width));
          } else {
            const prefix = " ".repeat(headerPrefixWidth);
            const suffix = i === wrappedArgs.length - 1 ? ")" : "";
            result.push(truncateToWidth(prefix + wrappedArgs[i] + suffix, width));
          }
        }
      }
      for (const rl of raw) {
        if (!rl) result.push("");
        else {
          let linesToRender: string[];
          if (visibleWidth(rl) <= width) {
            linesToRender = [rl];
          } else {
            linesToRender = wrapDiffLine(rl, width);
          }
          for (const line of linesToRender) {
            result.push(padBackground(line, width));
          }
        }
      }
      if (moreLine) {
        if (visibleWidth(moreLine) <= width) result.push(moreLine);
        else result.push(...wrapTextWithAnsi(moreLine, width));
      }
      return result;
  }, plainTextLines.join("\n"));
}

// ── Capture Result ─────────────────────────────────────────────────────

export function captureResult(result: any, durationMs?: number): any {
  const fullText = result.content?.[0]?.text || "";
  const details: Record<string, unknown> = { ...result.details, _fullOutput: fullText };
  if (durationMs !== undefined) {
    details._durationS = durationMs / 1000;
  }
  return { ...result, details };
}
