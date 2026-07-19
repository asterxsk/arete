// tui/tools/register.ts — registerToolRenderers(pi)
//
// Re-registers each built-in tool with the unified per-tool renderers defined in
// tools/{read,write,edit,bash,ls,grep,find,powershell}.ts while preserving the
// original execution behavior by delegating `execute` to the host `create*Tool`
// factories (and, for powershell, to a spawn mirror of extensions/powershell).
//
// Each `execute` is wrapped so that the captured plain-text output is placed on
// `details._fullOutput`; the per-tool renderers read that field.
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

import * as readMod from "./read.js";
import * as writeMod from "./write.js";
import * as editMod from "./edit.js";
import * as lsMod from "./ls.js";
import * as grepMod from "./grep.js";
import * as findMod from "./find.js";
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

  const read = createReadTool(cwd);
  pi.registerTool({
    name: "read",
    label: "read",
    description: read.description,
    parameters: read.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      return wrapExecute(read)(toolCallId, params, signal, onUpdate);
    },
    renderCall: readMod.renderCall,
    renderResult: readMod.renderResult,
  });

  const write = createWriteTool(cwd);
  pi.registerTool({
    name: "write",
    label: "write",
    description: write.description,
    parameters: write.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      return wrapExecute(write)(toolCallId, params, signal, onUpdate);
    },
    renderCall: writeMod.renderCall,
    renderResult: writeMod.renderResult,
  });

  const edit = createEditTool(cwd);
  pi.registerTool({
    name: "edit",
    label: "edit",
    description: edit.description,
    parameters: edit.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      return wrapExecute(edit)(toolCallId, params, signal, onUpdate);
    },
    renderCall: editMod.renderCall,
    renderResult: editMod.renderResult,
  });

  const ls = createLsTool(cwd);
  pi.registerTool({
    name: "ls",
    label: "ls",
    description: ls.description,
    parameters: ls.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      return wrapExecute(ls)(toolCallId, params, signal, onUpdate);
    },
    renderCall: lsMod.renderCall,
    renderResult: lsMod.renderResult,
  });

  const grep = createGrepTool(cwd);
  pi.registerTool({
    name: "grep",
    label: "grep",
    description: grep.description,
    parameters: grep.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      return wrapExecute(grep)(toolCallId, params, signal, onUpdate);
    },
    renderCall: grepMod.renderCall,
    renderResult: grepMod.renderResult,
  });

  const find = createFindTool(cwd);
  pi.registerTool({
    name: "find",
    label: "find",
    description: find.description,
    parameters: find.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      return wrapExecute(find)(toolCallId, params, signal, onUpdate);
    },
    renderCall: findMod.renderCall,
    renderResult: findMod.renderResult,
  });

  // bash + pwsh + powershell now route to the single combined Execute tool,
  // which supersedes the legacy separate bash/powershell renderers.
  registerExecuteTool(pi);

  // Monkey-patch ToolExecutionComponent.render (and instance/prototype
  // registerTool + addMessageToChat spacing) so any tool without a dedicated
  // render module still renders in the unified format. Runs after per-tool
  // registration so late-registered tools are also caught.
  patchUnknownToolRenderers(pi);
}
