import { describe, it, expect, beforeEach } from "vitest";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import {
  patchUnknownToolRenderers,
  DEDICATED_TOOLS,
  SUPPRESSED_TOOLS,
} from "../tools/patch-tools.js";

const PATCH_FLAG = "__tui_patchTools_patched";

beforeEach(() => {
  // Reset idempotency guards so each test re-applies cleanly.
  delete (globalThis as any)[PATCH_FLAG];
});

/**
 * Fake ExtensionAPI. Its registerTool / prototype registerTool CAPTURE the tool
 * so assertions can inspect what was passed — the patch wraps these capturing
 * fns, so the captured tool is the already-unified one.
 */
function makePi(): { pi: any; captured: any } {
  const captured: any = {};
  const pi: any = {
    registerTool: (tool: any) => {
      captured.tool = tool;
      return tool;
    },
  };
  const proto = {
    registerTool: (tool: any) => {
      captured.protoTool = tool;
      return tool;
    },
  };
  Object.setPrototypeOf(pi, proto);
  return { pi, captured };
}

const THEME = {
  fg: (_c: string, t: string) => t,
  bg: (_c: string, t: string) => t,
  bold: (t: string) => t,
  inverse: (t: string) => t,
};

describe("patch-tools: unknown/generic tool monkey-patch", () => {
  it("VAL-TOOL-011: unknown tool routes to the unified renderer (glow + ↳ + separator)", () => {
    const { pi, captured } = makePi();
    patchUnknownToolRenderers(pi);

    pi.registerTool({
      name: "mystery_tool",
      label: "mystery_tool",
      description: "a future tool",
      parameters: {},
    });

    const tool = captured.tool;
    expect(tool.renderShell).toBe("self");
    expect(typeof tool.renderCall).toBe("function");
    expect(typeof tool.renderResult).toBe("function");

    const callLines = tool.renderCall({ query: "hello" }, THEME, {}).render(80);
    const resultLines = tool
      .renderResult(
        { content: [{ type: "text", text: "line one\nline two" }], isError: false },
        { expanded: false },
        THEME,
        { args: { query: "hello" } },
      )
      .render(80);
    const callText = callLines.join("\n");
    const resultText = resultLines.join("\n");

    // Glow tool title present (tool name rendered, underscores replaced with spaces).
    expect(callText).toContain("Mystery tool");
    // ↳ summary line present in the result (not call).
    expect(resultText).toContain("↳");
    // Full-width border separator (─ repeated) present.
    expect(resultText).toContain("─");
  });

  it("catches late-registered tools via the prototype registerTool patch", () => {
    const { pi, captured } = makePi();
    patchUnknownToolRenderers(pi);

    // Call the wrapped *prototype* registerTool — our patch installed the
    // wrapper on Object.getPrototypeOf(pi).registerTool.
    Object.getPrototypeOf(pi).registerTool({
      name: "second_late",
      label: "second_late",
      description: "registered late",
      parameters: {},
    });

    const tool = captured.protoTool;
    expect(tool).toBeDefined();
    expect(tool.renderShell).toBe("self");
    expect(tool.name).toBe("second_late");
  });

  it("does not override a known/dedicated tool's renderer", () => {
    const { pi, captured } = makePi();
    patchUnknownToolRenderers(pi);

    pi.registerTool({
      name: "read",
      label: "read",
      description: "read file",
      parameters: {},
      renderShell: "self",
      renderCall: () => ["CUSTOM"],
      renderResult: () => ["CUSTOM"],
    });

    const tool = captured.tool;
    // read stays unpatched by the unknown-tool patch.
    expect(tool.__tui_unknown_patched).toBeUndefined();
    expect(DEDICATED_TOOLS.has(tool.name)).toBe(true);
  });

  it("is idempotent: calling the patch twice does not double-wrap registerTool", () => {
    const { pi, captured } = makePi();
    patchUnknownToolRenderers(pi);
    expect((pi.registerTool as any).__tui_patched).toBe(true);

    // Second call should be a no-op (guarded by global flag).
    patchUnknownToolRenderers(pi);

    pi.registerTool({ name: "uniq_a", parameters: {} });
    const tool = captured.tool;
    expect(tool.renderShell).toBe("self");
    expect((globalThis as any)[PATCH_FLAG]).toBe(true);
  });

  it("render prototype backstop renders unified block for unknown tool (no raw dump)", () => {
    const width = 60;
    const fake: any = {
      toolName: "generic_tool",
      args: { prompt: "do a thing" },
      result: { content: [{ type: "text", text: "out" }], isError: false },
      expanded: false,
      render: (ToolExecutionComponent.prototype as any).render,
    };
    const out = fake.render(width).join("\n");
    expect(out).toContain("Generic tool");
    expect(out).toContain("↳");
    expect(out).toContain("─");
  });

  it("render prototype backstop returns [] for suppressed tools", () => {
    const width = 60;
    const fake: any = {
      toolName: Array.from(SUPPRESSED_TOOLS)[0] ?? "todo",
      args: {},
      result: undefined,
      expanded: false,
      render: (ToolExecutionComponent.prototype as any).render,
    };
    const out = fake.render(width);
    expect(out).toEqual([]);
  });

  it("exposes a callable, defensive patch entry point", () => {
    expect(typeof patchUnknownToolRenderers).toBe("function");
  });
});
