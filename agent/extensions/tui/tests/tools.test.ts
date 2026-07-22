import { describe, it, expect } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { resolveTemplate } from "../tools/rendering.js";

function makeTheme() {
  return {
    fg: (color: string, text: string) => `\x1b[38;2;fg:${color}m${text}\x1b[0m`,
    bg: (color: string, text: string) => `\x1b[48;2;bg:${color}m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  };
}

/** Render a collapsed tool block (3 lines): glow / ↳ / separator. */
function renderCollapsed(name: string, result: any, ctxArgs: any): string[] {
  const theme = makeTheme();
  const template = resolveTemplate({ name });
  if (!template || !template.renderResult) return [];
  const c = template.renderResult(result, { expanded: false }, theme as any, { args: ctxArgs });
  return c.render(40);
}

function renderExpanded(name: string, result: any, ctxArgs: any): string[] {
  const theme = makeTheme();
  const template = resolveTemplate({ name });
  if (!template || !template.renderResult) return [];
  const c = template.renderResult(result, { expanded: true }, theme as any, { args: ctxArgs });
  return c.render(40);
}

describe("find unified renderer", () => {
  it("collapsed: glow title (toolTitle, bold) + ↳ count + full-width separator", () => {
    const result = {
      content: [{ type: "text", text: "a.ts\nb.ts\nc.ts" }],
      details: { _fullOutput: "a.ts\nb.ts\nc.ts" },
      isError: false,
    };
    const out = renderCollapsed("find", result, { pattern: "*.ts" });
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("fg:toolTitle");
    expect(out[0]).toContain("\x1b[1mFind\x1b[22m");
    expect(out[1]).toContain("fg:muted");
    expect(out[1]).toContain("↳");
    expect(out[1]).toContain("(3)");
    expect(out[2]).toContain("fg:border");
    expect(visibleWidth(out[2])).toBe(40);
  });

  it("collapsed: error summary when isError", () => {
    const result = { content: [{ type: "text", text: "boom" }], details: {}, isError: true };
    const out = renderCollapsed("find", result, { pattern: "x" });
    expect(out[1]).toContain("failed");
  });

  it("expanded: shows full result lines", () => {
    const result = {
      content: [{ type: "text", text: "one\ntwo" }],
      details: { _fullOutput: "one\ntwo" },
      isError: false,
    };
    const out = renderExpanded("find", result, { pattern: "x" });
    expect(out.length).toBe(5); // glow + arrow + 2 body lines + separator
    expect(out[2]).toContain("one");
    expect(out[3]).toContain("two");
  });

  it("renderCall shows glow title + pattern args", () => {
    const theme = makeTheme();
    const template = resolveTemplate({ name: "find" });
    const out = template!.renderCall!({ pattern: "foo" }, theme as any, {}).render(40);
    expect(out[0]).toContain("Find");
    expect(out[0]).toContain("foo");
  });
});

describe("Execute unified renderer (via resolveTemplate)", () => {
  it("collapsed: glow title + ↳ count + full-width separator", () => {
    const result = {
      content: [{ type: "text", text: "hello\nworld" }],
      details: { _fullOutput: "hello\nworld", exitCode: 0 },
      isError: false,
    };
    const out = renderCollapsed("powershell", result, { command: "Write-Output hi" });
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("fg:toolTitle");
    expect(out[0]).toContain("\x1b[1mExecute\x1b[22m");
    expect(out[1]).toContain("↳");
    expect(out[1]).toContain("(2)");
    expect(out[2]).toContain("fg:border");
    expect(visibleWidth(out[2])).toBe(40);
  });

  it("collapsed: shows exit code hint on non-zero exit", () => {
    const result = {
      content: [{ type: "text", text: "err" }],
      details: { _fullOutput: "err", exitCode: 1 },
      isError: true,
    };
    const out = renderCollapsed("powershell", result, { command: "boom" });
    expect(out[1]).toContain("failed");
    expect(out[1]).toContain("exit 1");
  });

  it("truncation hint appears when output exceeds collapsed budget", () => {
    const manyLines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const result = {
      content: [{ type: "text", text: manyLines }],
      details: { _fullOutput: manyLines, exitCode: 0 },
      isError: false,
    };
    const out = renderCollapsed("powershell", result, { command: "big" });
    expect(out[1]).toContain("ctrl+o");
  });

  it("expanded: shows raw output body", () => {
    const result = {
      content: [{ type: "text", text: "a\nb" }],
      details: { _fullOutput: "a\nb", exitCode: 0 },
      isError: false,
    };
    const out = renderExpanded("powershell", result, { command: "echo" });
    expect(out.length).toBe(5);
    expect(out[2]).toContain("a");
    expect(out[3]).toContain("b");
  });

  it("renderCall shows glow title + command args", () => {
    const theme = makeTheme();
    const template = resolveTemplate({ name: "powershell" });
    const out = template!.renderCall!({ command: "Get-Date" }, theme as any, {}).render(40);
    expect(out[0]).toContain("Execute");
    expect(out[0]).toContain("Get-Date");
  });
});
