import { describe, it, expect } from "vitest";
import { registerToolRenderers } from "../tools/register.js";

const TOOL_NAMES = ["read", "write", "edit", "bash", "ls", "grep", "find", "powershell"];

describe("registerToolRenderers", () => {
  it("re-registers all built-in tools with renderCall/renderResult", () => {
    const registered: any[] = [];
    const pi: any = {
      registerTool: (tool: any) => registered.push(tool),
    };
    registerToolRenderers(pi as any);

    const names = registered.map((t) => t.name);
    for (const n of TOOL_NAMES) expect(names).toContain(n);

    for (const tool of registered) {
      expect(typeof tool.renderCall).toBe("function");
      expect(typeof tool.renderResult).toBe("function");
      expect(tool.renderShell).toBe("self");
    }
  });

  it("preserves original execution behavior (read delegates to host factory)", async () => {
    const registered: any[] = [];
    const pi: any = { registerTool: (tool: any) => registered.push(tool) };
    registerToolRenderers(pi as any);

    const byName = Object.fromEntries(registered.map((t) => [t.name, t]));
    expect(typeof byName.read.execute).toBe("function");
    // Calling the registered execute should run without throwing (delegates to factory).
    const res = await byName.read.execute("call-1", { path: __filename }, undefined, undefined);
    expect(res).toBeDefined();
    expect(res.content?.[0]?.type ?? res.content?.[0]?.type).toBeDefined();
  });

  it("powershell execute mirrors spawn + captures output", async () => {
    const registered: any[] = [];
    const pi: any = { registerTool: (tool: any) => registered.push(tool) };
    registerToolRenderers(pi as any);
    const pwsh = registered.find((t) => t.name === "powershell");
    const res: any = await pwsh.execute(
      "c1",
      { command: "Write-Output hello" },
      undefined,
      undefined,
    );
    expect(res.content[0].text).toContain("hello");
    expect(res.details._fullOutput).toContain("hello");
  });
});
