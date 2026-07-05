import * as fs from "node:fs";
import { Markdown } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { ArtifactInfo } from "./storage.ts";
import { clampScroll } from "./md-helpers.ts";

const HEADER_LINES = 2;
const FOOTER_LINES = 2;

interface ReaderTheme {
  fg: (name: string, text: string) => string;
  bold: (text: string) => string;
  bg: (name: string, text: string) => string;
}

interface ReaderMarkdownTheme {
  heading: (text: string) => string;
  link: (text: string) => string;
  linkUrl: (text: string) => string;
  code: (text: string) => string;
  codeBlock: (text: string) => string;
  codeBlockBorder: (text: string) => string;
  quote: (text: string) => string;
  quoteBorder: (text: string) => string;
  hr: (text: string) => string;
  listBullet: (text: string) => string;
  bold: (text: string) => string;
  italic: (text: string) => string;
  strikethrough: (text: string) => string;
  underline: (text: string) => string;
}

interface ReaderTui {
  terminal: { rows: number };
  requestRender: () => void;
}

function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export class MarkdownReaderComponent implements Component {
  private scrollOffset = 0;
  private lastBodyLineCount = 0;
  private visibleHeight = 20;
  private markdown: Markdown;
  private readonly artifact: ArtifactInfo;
  private readonly theme: ReaderTheme;
  private readonly markdownTheme: ReaderMarkdownTheme;
  private readonly tui: ReaderTui;
  private readonly ctx: MarkdownReaderCtx;
  private readonly onClose: () => void;
  private cachedWidth = 0;
  private cachedLines: string[] = [];
  private bodyLineCount = 0;
  private _focused = false;
  private selectedLineIndex = 0;

  // Inline Commenting State
  private isCommenting = false;
  private commentInputText = "";

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
  }

  constructor(
    ctx: MarkdownReaderCtx,
    artifact: ArtifactInfo,
    content: string,
    theme: ReaderTheme,
    markdownTheme: ReaderMarkdownTheme,
    tui: ReaderTui,
    onClose: () => void,
  ) {
    this.ctx = ctx;
    this.artifact = artifact;
    this.theme = theme;
    this.markdownTheme = markdownTheme;
    this.tui = tui;
    this.onClose = onClose;
    // Strip the first H1 line so the title doesn't appear twice
    const strippedContent = content.replace(/^#\s+.+\n?/, "");
    this.markdown = new Markdown(strippedContent, 1, 0, markdownTheme);
  }

  private reloadContent() {
    const content = fs.readFileSync(this.artifact.path, "utf8");
    const strippedContent = content.replace(/^#\s+.+\n?/, "");
    this.markdown = new Markdown(strippedContent, 1, 0, this.markdownTheme);
    this.cachedWidth = 0; // force re-render
  }

  private saveComment() {
    const bodyLines = this.cachedLines;
    if (this.selectedLineIndex < 0 || this.selectedLineIndex >= bodyLines.length) {
      this.isCommenting = false;
      this.commentInputText = "";
      return;
    }
    const selectedLine = bodyLines[this.selectedLineIndex];
    const trimmedComment = this.commentInputText.trim();
    if (!trimmedComment) {
      this.isCommenting = false;
      this.commentInputText = "";
      return;
    }

    try {
      const fileContent = fs.readFileSync(this.artifact.path, "utf8");
      const fileLines = fileContent.split(/\r?\n/);

      // Strip ANSI escape codes and find the corresponding source line
      const cleanText = selectedLine.replace(/\x1b\[[0-9;]*m/g, "").trim();
      const searchPattern = cleanText.replace(/^[•\s\->*│]+/, "").trim();

      let targetLineIdx = -1;
      if (searchPattern) {
        targetLineIdx = fileLines.findIndex(line => line.includes(searchPattern));
      }

      if (targetLineIdx === -1) {
        // Proportional fallback
        targetLineIdx = Math.min(
          fileLines.length - 1,
          Math.floor((this.selectedLineIndex / bodyLines.length) * fileLines.length)
        );
      }

      // Format the comment as blockquotes under the selected line
      const commentPrefix = `> **Comment (Line ${targetLineIdx + 1}):** `;
      const formattedComment = trimmedComment
        .split("\n")
        .map((line, idx) => (idx === 0 ? commentPrefix + line : `> ${line}`))
        .join("\n");

      // Insert the comment directly below the target line
      fileLines.splice(targetLineIdx + 1, 0, formattedComment);

      fs.writeFileSync(this.artifact.path, fileLines.join("\n"), "utf8");
      
      this.isCommenting = false;
      this.commentInputText = "";
      this.reloadContent();
      this.ctx.ui.notify(`Added comment below line ${targetLineIdx + 1}`, "info");
      setTimeout(() => { try { this.ctx.ui.notify(""); } catch {} }, 5000);
    } catch (err) {
      this.isCommenting = false;
      this.commentInputText = "";
      this.ctx.ui.notify(`Failed to add comment: ${err instanceof Error ? err.message : String(err)}`, "error");
      setTimeout(() => { try { this.ctx.ui.notify(""); } catch {} }, 5000);
    }
  }

  private async promptForSubmit() {
    try {
      const confirmSubmit = await this.ctx.ui.confirm(
        "Submit Review",
        `Submit review for "${this.artifact.title}" and notify the agent?`
      );
      if (!confirmSubmit) return;

      const piApi = (globalThis as any).__pi_artifacts_api;
      if (piApi && typeof piApi.sendUserMessage === "function") {
        const msg = `Review complete for artifact "${this.artifact.title}". Please recheck using the check_artifact tool with id: "${this.artifact.name}".`;
        await piApi.sendUserMessage(msg, { deliverAs: "nextTurn" });
      }

      this.ctx.ui.notify("Review submitted successfully!", "info");
      setTimeout(() => { try { this.ctx.ui.notify(""); } catch {} }, 5000);
      
      this.onClose();
    } catch (err) {
      this.ctx.ui.notify(`Failed to submit review: ${err instanceof Error ? err.message : String(err)}`, "error");
      setTimeout(() => { try { this.ctx.ui.notify(""); } catch {} }, 5000);
    }
  }

  render(width: number): string[] {
    const inputLines = this.isCommenting ? this.commentInputText.split("\n") : [];
    const commentBoxLines = this.isCommenting ? 3 + inputLines.length : 0;

    this.visibleHeight = Math.max(1, this.tui.terminal.rows - HEADER_LINES - FOOTER_LINES - commentBoxLines);

    // Cache rendered lines when width changes
    if (width !== this.cachedWidth) {
      this.cachedWidth = width;
      const prefixWidth = width > 15 ? 8 : 0;
      this.cachedLines = this.markdown.render(width - prefixWidth);
      this.bodyLineCount = this.cachedLines.length;
    }

    const bodyLines = this.cachedLines;
    this.lastBodyLineCount = bodyLines.length;

    // Clamp selectedLineIndex to valid range
    if (this.selectedLineIndex >= bodyLines.length) {
      this.selectedLineIndex = Math.max(0, bodyLines.length - 1);
    }

    // Keep cursor in view
    if (this.selectedLineIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedLineIndex;
    } else if (this.selectedLineIndex >= this.scrollOffset + this.visibleHeight) {
      this.scrollOffset = Math.max(0, this.selectedLineIndex - this.visibleHeight + 1);
    }

    this.scrollOffset = clampScroll(this.scrollOffset, 0, bodyLines.length, this.visibleHeight);
    const visible = bodyLines.slice(this.scrollOffset, this.scrollOffset + this.visibleHeight);

    // Format visible lines with line numbers and cursor highlight
    const prefixWidth = width > 15 ? 8 : 0;
    const formattedVisible = visible.map((line, idx) => {
      const globalIdx = this.scrollOffset + idx;
      const isSelected = globalIdx === this.selectedLineIndex;

      if (prefixWidth === 0) {
        return line;
      }

      const numStr = String(globalIdx + 1).padStart(4, " ");
      const prefix = isSelected
        ? `${this.theme.fg("accent", ">")} ${this.theme.fg("dim", numStr)}  `
        : `  ${this.theme.fg("dim", numStr)}  `;

      const content = line;

      return prefix + content;
    });

    // Center and decorate the title
    const titleText = this.theme.bold(this.artifact.title);
    const titleLen = this.artifact.title.length;
    const leftPadding = Math.max(0, Math.floor((width - titleLen) / 2));
    const titleLine = " ".repeat(leftPadding) + this.theme.fg("accent", titleText);
    const headerUnderline = this.theme.fg("accent", "─".repeat(width));

    // Bottom divider & footer
    const divider = this.theme.fg("accent", "─".repeat(Math.max(0, width)));
    const footerText = this.isCommenting
      ? " [Commenting Mode]"
      : ` ↑↓/jk navigate • c comment • s submit • PgUp/PgDn • g top/G bottom • Esc close [${this.bodyLineCount} lines]`;
    const footer = this.theme.fg("dim", footerText);

    const result = [titleLine, headerUnderline, ...formattedVisible, divider, footer];

    // If commenting, render the inline comment box at the bottom
    if (this.isCommenting) {
      const commentHeader = this.theme.fg("accent", ` Comment on line ${this.selectedLineIndex + 1}:`);
      
      const commentBody = inputLines.map((line, idx) => {
        // Render fake cursor block at the end of the last line being typed
        if (idx === inputLines.length - 1) {
          return "  " + line + "\x1b[7m \x1b[27m";
        }
        return "  " + line;
      });

      const commentSeparator = this.theme.fg("accent", "─".repeat(width));
      const commentFooter = this.theme.fg("dim", " Enter save • Shift+Enter (or Alt+Enter) newline • Esc cancel");

      result.push(commentHeader, ...commentBody, commentSeparator, commentFooter);
    }

    return result;
  }

  handleInput(data: string): void {
    if (this.isCommenting) {
      this.handleCommentInput(data);
      return;
    }

    const totalLines = this.lastBodyLineCount;

    if (data === "\x1b") {
      this.onClose();
      return;
    }
    if (data === "j" || data === "\x1b[B") {
      this.selectedLineIndex = Math.min(totalLines - 1, this.selectedLineIndex + 1);
    } else if (data === "k" || data === "\x1b[A") {
      this.selectedLineIndex = Math.max(0, this.selectedLineIndex - 1);
    } else if (data === "\x1b[6~") {
      this.selectedLineIndex = Math.min(totalLines - 1, this.selectedLineIndex + this.visibleHeight);
    } else if (data === "\x1b[5~") {
      this.selectedLineIndex = Math.max(0, this.selectedLineIndex - this.visibleHeight);
    } else if (data === "g") {
      this.selectedLineIndex = 0;
    } else if (data === "G") {
      this.selectedLineIndex = Math.max(0, totalLines - 1);
    } else if (data === "c") {
      this.isCommenting = true;
      this.commentInputText = "";
    } else if (data === "s") {
      this.promptForSubmit();
      return;
    } else {
      return;
    }

    this.tui.requestRender();
  }

  private handleCommentInput(data: string): void {
    if (data === "\x1b") { // Escape to cancel
      this.isCommenting = false;
      this.commentInputText = "";
      this.tui.requestRender();
      return;
    }

    // Check for Shift+Enter (or Alt+Enter) to insert newline
    const isShiftEnter = (keyData: string): boolean => {
      return (
        keyData === "\x1b[13;2u" ||
        keyData === "\x1b[27;2;13~" ||
        keyData === "\x1b\r" ||
        keyData === "\x1b\n"
      );
    };

    if (isShiftEnter(data)) {
      this.commentInputText += "\n";
      this.tui.requestRender();
      return;
    }

    if (data === "\r" || data === "\n") { // Enter to save
      this.saveComment();
      return;
    }

    if (data === "\x7f" || data === "\x08") { // Backspace
      this.commentInputText = this.commentInputText.slice(0, -1);
      this.tui.requestRender();
      return;
    }

    if (data === "\t") {
      this.commentInputText += "  ";
      this.tui.requestRender();
      return;
    }

    // Check for control characters
    const hasControlChars = [...data].some((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
    });

    if (!hasControlChars || data === " ") {
      this.commentInputText += data;
      this.tui.requestRender();
    }
  }

  invalidate(): void {
    this.markdown.invalidate();
    this.cachedWidth = 0;
  }
}

interface MarkdownReaderCtx {
  ui: {
    input: (prompt: string) => Promise<string | undefined>;
    notify: (message: string, type: "success" | "error" | "info" | "warning") => void;
    custom: <T>(
      factory: (
        tui: ReaderTui,
        theme: ReaderTheme,
        keybindings: unknown,
        done: (result: T) => void,
      ) => Component,
      options?: { overlay?: boolean; overlayOptions?: Record<string, unknown> },
    ) => Promise<T>;
  };
}

export function openMarkdownReader(ctx: MarkdownReaderCtx, artifact: ArtifactInfo): Promise<void> {
  const content = fs.readFileSync(artifact.path, "utf8");

  return ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      const markdownTheme: ReaderMarkdownTheme = {
        heading: (text) => theme.fg("accent", theme.bold(text)),
        link: (text) => theme.fg("accent", text),
        linkUrl: (text) => theme.fg("dim", text),
        code: (text) => theme.fg("warning", text),
        codeBlock: (text) => theme.fg("text", text),
        codeBlockBorder: (text) => theme.fg("dim", text),
        quote: (text) => theme.fg("muted", text),
        quoteBorder: (text) => theme.fg("dim", text),
        hr: (text) => theme.fg("dim", text),
        listBullet: (text) => theme.fg("accent", text),
        bold: (text) => theme.bold(text),
        italic: (text) => text,
        strikethrough: (text) => text,
        underline: (text) => text,
      };

      return new MarkdownReaderComponent(ctx, artifact, content, theme, markdownTheme, tui, () =>
        done(undefined),
      );
    }
  );
}
