// tui/tools/register.ts — registerToolRenderers(pi)
//
// Re-registers each built-in tool with the unified template-based renderers
// defined in rendering.ts (via resolveTemplate) while preserving the original
// execution behavior by delegating `execute` to the host `create*Tool` factories.
//
// Each `execute` is wrapped so that the captured plain-text output is placed on
// `details._fullOutput`; the template renderers read that field.
//
// All tools without dedicated execution (web_search, web_fetch, memory, etc.)
// are handled by patchUnknownToolRenderers in patch-tools.ts.
//
// Called from index.ts after registerBar.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createLsTool,
  createGrepTool,
  createFindTool,
} from "@earendil-works/pi-coding-agent";

import { patchTool } from "./rendering.js";
import { registerExecuteTool } from "./execute.js";
import { patchUnknownToolRenderers } from "./patch-tools.js";

// ── Helpers ───────────────────────────────────────────────────────────

/** Wrap an original tool result, capturing plain text into details._fullOutput. */
function capture(result: any, durationMs?: number): any {
  const fullText =
    result?.content?.map((c: any) => (c.type === "text" ? c.text : "")).join("\n") ?? "";
  return {
    ...result,
    details: {
      ...result?.details,
      _fullOutput: fullText,
      _durationS: (durationMs ?? 0) / 1000,
    },
  };
}

/** Build an `execute` wrapper that preserves behavior and injects _fullOutput. */
function wrapExecute(original: any) {
  return async (toolCallId: string, params: any, signal: any, onUpdate: any) => {
    const t0 = Date.now();
    return capture(await original.execute(toolCallId, params, signal, onUpdate), Date.now() - t0);
  };
}

// ── Registration ───────────────────────────────────────────────────────

export function registerToolRenderers(pi: ExtensionAPI): void {
  const cwd = process.cwd();

  const tools = [
    { tool: createReadTool(cwd), params: { name: "read", label: "read" } },
    { tool: createWriteTool(cwd), params: { name: "write", label: "write" } },
    { tool: createEditTool(cwd), params: { name: "edit", label: "edit" } },
    { tool: createLsTool(cwd), params: { name: "ls", label: "ls" } },
    { tool: createGrepTool(cwd), params: { name: "grep", label: "grep" } },
    { tool: createFindTool(cwd), params: { name: "find", label: "find" } },
  ];

  for (const { tool, params } of tools) {
    const definition = {
      name: params.name,
      label: params.label,
      description: tool.description,
      parameters: tool.parameters,
      async execute(toolCallId: string, p: any, signal: any, onUpdate: any) {
        return wrapExecute(tool)(toolCallId, p, signal, onUpdate);
      },
    };
    patchTool(definition);
    pi.registerTool(definition);
  }

  // bash + pwsh + powershell now route to the single combined Execute tool
  registerExecuteTool(pi);

  // Monkey-patch ToolExecutionComponent + registerTool + spacing so any tool
  // without a dedicated render module still renders in the unified format.
  patchUnknownToolRenderers(pi);
}
