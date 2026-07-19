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
import { spawn } from "child_process";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
  createLsTool,
  createGrepTool,
  createFindTool,
} from "@earendil-works/pi-coding-agent";

import * as readMod from "./read.js";
import * as writeMod from "./write.js";
import * as editMod from "./edit.js";
import * as bashMod from "./bash.js";
import * as lsMod from "./ls.js";
import * as grepMod from "./grep.js";
import * as findMod from "./find.js";
import * as powershellMod from "./powershell.js";

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

/** Mirror of extensions/powershell/index.ts spawn — preserves powershell execution. */
function makePowershellExecute(): (
  toolCallId: string,
  params: any,
  signal: any,
  _onUpdate: any,
) => Promise<any> {
  return (toolCallId: string, params: any, signal: any, _onUpdate: any) => {
    const start = Date.now();
    const command = (params as { command: string }).command;
    const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
    return new Promise((resolve) => {
      const child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          encodedCommand,
        ],
        { windowsHide: true, cwd: (params as any).cwd || process.cwd() },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
      child.on("close", (code: number) => {
        const elapsed = (Date.now() - start) / 1000;
        const combined = stdout + (stdout && stderr ? "\n" : "") + stderr;
        const text = combined.trim() || "(no output)";
        const isError = code !== 0;
        return resolve(
          capture(
            {
              content: [{ type: "text", text }],
              details: { exitCode: code, stderr, stdout, _durationS: elapsed, command },
              isError,
            },
            elapsed * 1000,
          ),
        );
      });
      child.on("error", (err: Error) => {
        resolve(
          capture(
            {
              content: [{ type: "text", text: "Failed to start PowerShell: " + err.message }],
              details: { _durationS: (Date.now() - start) / 1000 },
              isError: true,
            },
            Date.now() - start,
          ),
        );
      });
      if (signal) {
        const abort = () => {
          if (!child.killed) child.kill();
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }
    });
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

  const bash = createBashTool(cwd);
  pi.registerTool({
    name: "bash",
    label: "bash",
    description: bash.description,
    parameters: bash.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      return wrapExecute(bash)(toolCallId, params, signal, onUpdate);
    },
    renderCall: bashMod.renderCall,
    renderResult: bashMod.renderResult,
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

  // powershell: no host factory — mirror extensions/powershell spawn logic.
  pi.registerTool({
    name: "powershell",
    label: "powershell",
    description:
      "Execute PowerShell commands on the local Windows system. Supports any cmdlet, script, or PowerShell command. Results include stdout, stderr, and exit code.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "PowerShell command or script to execute" },
      },
      required: ["command"],
    },
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      return makePowershellExecute()(toolCallId, params, signal, onUpdate);
    },
    renderCall: powershellMod.renderCall,
    renderResult: powershellMod.renderResult,
  });
}
