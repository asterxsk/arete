import { describe, it, expect } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  glowLabel,
  outputArrowLine,
  diffLine,
  separator,
  truncate,
  group,
} from "../tools/rendering.js";

/** Visible (ANSI-stripped) width of a rendered line. */
function visibleWidthOf(line: string): number {
  return visibleWidth(line);
}

/** Mock theme that tags colors with ANSI-style escapes (invisible to width
 *  measurement, so truncateToWidth only counts actual content) so we can
 *  assert which token was used. */
function makeTheme() {
  return {
    fg: (color: string, text: string) => `\x1b[38;2;fg:${color}m${text}\x1b[0m`,
    bg: (color: string, text: string) => `\x1b[48;2;bg:${color}m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  };
}

describe("rendering primitives", () => {
  it("glowLabel is a bold toolTitle line", () => {
    const theme = makeTheme();
    const c = glowLabel(theme as any, "read", "file.ts");
    const out = c.render(80);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("fg:toolTitle");
    expect(out[0]).toContain("\x1b[1mread\x1b[22m");
    expect(out[0]).toContain("fg:muted");
    expect(out[0]).toContain("file.ts");
    expect(typeof c.invalidate).toBe("function");
  });

  it("glowLabel works without args", () => {
    const theme = makeTheme();
    const out = glowLabel(theme as any, "bash").render(80);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("fg:toolTitle");
    expect(out[0]).toContain("\x1b[1mbash\x1b[22m");
  });

  it("outputArrowLine uses muted color with ↳ prefix", () => {
    const theme = makeTheme();
    const out = outputArrowLine(theme as any, "tool output", 5).render(80);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("fg:muted");
    expect(out[0]).toContain("↳ tool output (5)");
  });

  it("diffLine colors + with toolDiffAdded + toolSuccessBg", () => {
    const theme = makeTheme();
    const out = diffLine(theme as any, "+added line").render(80);
    expect(out[0]).toContain("bg:toolSuccessBg");
    expect(out[0]).toContain("fg:toolDiffAdded");
    expect(out[0]).toContain("+added line");
  });

  it("diffLine colors - with toolDiffRemoved + toolErrorBg", () => {
    const theme = makeTheme();
    const out = diffLine(theme as any, "-removed line").render(80);
    expect(out[0]).toContain("bg:toolErrorBg");
    expect(out[0]).toContain("fg:toolDiffRemoved");
    expect(out[0]).toContain("-removed line");
  });

  it("diffLine uses toolDiffContext for context lines", () => {
    const theme = makeTheme();
    const out = diffLine(theme as any, " context line").render(80);
    expect(out[0]).toContain("fg:toolDiffContext");
    expect(out[0]).toContain(" context line");
    expect(out[0]).not.toContain("bg:");
  });

  it("separator fills full width with border color", () => {
    const theme = makeTheme();
    const out = separator(theme as any, 10).render(10);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("fg:border");
    expect(visibleWidthOf(out[0])).toBe(10);
  });

  it("separator respects a different width", () => {
    const theme = makeTheme();
    const out = separator(theme as any, 4).render(4);
    expect(visibleWidthOf(out[0])).toBe(4);
  });

  it("truncate returns all lines when under the limit", () => {
    const out = truncate(["a", "b", "c"], 5).render(80);
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("truncate collapses overflow with ctrl+o hint", () => {
    const lines = ["1", "2", "3", "4", "5"];
    const out = truncate(lines, 2).render(80);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("1");
    expect(out[1]).toBe("2");
    expect(out[2]).toContain("3 more lines, ctrl+o to expand");
  });

  it("group stacks child components vertically", () => {
    const theme = makeTheme();
    const out = group([
      glowLabel(theme as any, "read"),
      outputArrowLine(theme as any, "tool output", 5),
    ]).render(80);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("read");
    expect(out[1]).toContain("↳");
  });
});
