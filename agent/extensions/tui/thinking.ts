// thinking component — renders thinking blocks with "┃ " prefix
// Pipe and text use the theme's thinkingText grey (arete: #8c8c8c).
// Text is italic and monotone (no syntax highlighting), matching native behavior.

import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";

// arete theme "thinkingText" = #8c8c8c. The internal `theme` singleton and
// getResolvedThemeColors() are NOT exported from the package root (the
// "exports" map blocks subpath imports), so we use the resolved constant.
const THINKING_GREY = "\x1b[38;2;140;140;140m";

export class ThinkingComponent {
  private text: string;
  private theme: MarkdownTheme;
  private outputPad: number;
  constructor(text: string, theme: MarkdownTheme, outputPad = 1) {
    this.text = text;
    this.theme = theme;
    this.outputPad = outputPad;
  }

  render(width: number): string[] {
    const result: string[] = [];

    const color = THINKING_GREY;
    const colorFn = (text: string) => `${color}${text}`;
    const PIPE = `${color}\u2503 `;

    // Prefix = outputPad indent + "┃ " (2 visible). Markdown rendered with
    // paddingX=0 so lines start exactly at the pipe, no double-indent.
    const indent = " ".repeat(this.outputPad);
    const prefixVisible = this.outputPad + 2;
    const contentWidth = Math.max(1, width - prefixVisible);

    // Render with color override and italic so all text uses thinkingText
    const md = new Markdown(this.text, 0, 0, this.theme, {
      color: colorFn,
      italic: true,
    });
    const lines = md.render(contentWidth);
    for (let i = 0; i < lines.length; i++) {
      result.push(`${indent}${PIPE}${lines[i]}`);
    }
    return result;
  }
}

export function isThinkingComponent(obj: any): obj is ThinkingComponent {
  return obj instanceof ThinkingComponent;
}
