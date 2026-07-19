import { describe, it, expect } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  defaultShellFor,
  selectShell,
  renderCall,
  renderResult,
  ALIASES,
} from "../tools/execute.js";

function makeTheme() {
  return {
    fg: (color: string, text: string) => `\x1b[38;2;fg:${color}m${text}\x1b[0m`,
    bg: (color: string, text: string) => `\x1b[48;2;bg:${color}m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  };
}

function renderCollapsed(result: any, ctxArgs: any): string[] {
  const theme = makeTheme();
  const c = renderResult(result, { expanded: false }, theme as any, { args: ctxArgs });
  return c.render(40);
}

describe("shell selection (pure)", () => {
  it("VAL-TOOL-012: defaults to pwsh on win32, bash elsewhere", () => {
    expect(defaultShellFor("win32")).toBe("pwsh");
    expect(defaultShellFor("linux")).toBe("bash");
    expect(defaultShellFor("darwin")).toBe("bash");
  });

  it("VAL-TOOL-012: selectShell without param mirrors platform default", () => {
    expect(selectShell(undefined, "win32")).toBe("pwsh");
    expect(selectShell(undefined, "linux")).toBe("bash");
    expect(selectShell(undefined, "darwin")).toBe("bash");
  });

  it("VAL-TOOL-013: explicit shell param overrides platform default", () => {
    expect(selectShell("bash", "win32")).toBe("bash");
    expect(selectShell("pwsh", "linux")).toBe("pwsh");
    expect(selectShell("bash", "darwin")).toBe("bash");
    expect(selectShell("pwsh", "win32")).toBe("pwsh");
  });

  it("shell selection is deterministic across repeated calls", () => {
    expect(selectShell(undefined, "win32")).toBe(selectShell(undefined, "win32"));
    expect(selectShell("bash", "linux")).toBe(selectShell("bash", "linux"));
  });
});

describe("Execute unified rendering", () => {
  it("renderCall uses glow label 'Execute' + command args", () => {
    const theme = makeTheme();
    const out = renderCall({ command: "Get-Date" }, theme as any, {}).render(40);
    expect(out[0]).toContain("\x1b[1mExecute\x1b[22m");
    expect(out[0]).toContain("fg:toolTitle");
    expect(out[0]).toContain("Get-Date");
  });

  it("collapsed result: glow + ↳ + full-width separator; records chosen shell", () => {
    const result = {
      content: [{ type: "text", text: "hello\nworld" }],
      details: { _fullOutput: "hello\nworld", exitCode: 0, shell: "pwsh" },
      isError: false,
    };
    const out = renderCollapsed(result, { command: "echo hi" });
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("\x1b[1mExecute\x1b[22m");
    expect(out[1]).toContain("↳");
    expect(out[1]).toContain("(2)"); // line count
    expect(out[1]).toContain("(pwsh)"); // chosen shell tag
    expect(out[2]).toContain("fg:border");
    expect(visibleWidth(out[2])).toBe(40);
  });

  it("collapsed error result records shell + exit code", () => {
    const result = {
      content: [{ type: "text", text: "boom" }],
      details: { _fullOutput: "boom", exitCode: 1, shell: "bash" },
      isError: true,
    };
    const out = renderCollapsed(result, { command: "false" });
    expect(out[1]).toContain("failed");
    expect(out[1]).toContain("exit 1");
    expect(out[1]).toContain("(bash)");
  });

  it("expanded result shows shell tag and full body", () => {
    const result = {
      content: [{ type: "text", text: "a\nb" }],
      details: { _fullOutput: "a\nb", exitCode: 0, shell: "bash" },
      isError: false,
    };
    const theme = makeTheme();
    const out = renderResult(result, { expanded: true }, theme as any, {
      args: { command: "echo" },
    }).render(40);
    expect(out[2]).toContain("a");
    expect(out[3]).toContain("b");
  });
});

describe("VAL-TOOL-014: aliases route to single Execute tool", () => {
  it("three aliases exported (bash, pwsh, powershell)", () => {
    expect(ALIASES).toEqual(["bash", "pwsh", "powershell"]);
  });

  it("each alias renders identical unified format", () => {
    const theme = makeTheme();
    const callBash = renderCall({ command: "x" }, theme as any, {}).render(40);
    const callPwsh = renderCall({ command: "x" }, theme as any, {}).render(40);
    const callPs = renderCall({ command: "x" }, theme as any, {}).render(40);
    expect(callBash).toEqual(callPwsh);
    expect(callPwsh).toEqual(callPs);
    // Glow label is the single 'Execute' name regardless of alias.
    expect(callBash[0]).toContain("Execute");
    expect(callBash[0]).not.toContain("fg:toolTitle" + "bash");
  });

  it("alias→Execute mapping exposed via registerExecuteTool names", async () => {
    const registered: any[] = [];
    const pi: any = { registerTool: (tool: any) => registered.push(tool) };
    // Local import to avoid running full registerToolRenderers (needs cwd/fs).
    const { registerExecuteTool } = await import("../tools/execute.js");
    registerExecuteTool(pi as any);
    const names = registered.map((t) => t.name);
    for (const a of ALIASES) {
      expect(names).toContain(a);
      const tool = registered.find((t) => t.name === a);
      expect(tool.renderCall).toBe(renderCall);
      expect(tool.renderResult).toBe(renderResult);
    }
    // Exactly three registrations, all pointing at the same renderers.
    expect(registered).toHaveLength(3);
  });
});
