// tui/tools/patch-tools.ts — monkey-patch for unknown/generic tools.
//
// Goal: any tool that is NOT shipped with a dedicated per-tool render module
// (read/write/edit/ls/grep/find, and the combined Execute tool registered under
// bash/pwsh/powershell) must still render in the unified format.
//
// Rendering is delegated to resolveTemplate/patchTool in rendering.ts, which
// provides a generic fallback for any tool name.
//
// Mirrors the archived compactui monkey-patch pattern:
//   - patch `ToolExecutionComponent.prototype.render` so unknown tools are
//     rendered through our unified block instead of an unstyled raw dump,
//   - patch BOTH the instance `registerTool` AND the prototype `registerTool`
//     so late-registered tools (subagent, memory, video_extract, future tools
//     registered by other extensions after this extension loads) are also
//     caught and given unified renderCall/renderResult immediately,
//   - patch `InteractiveMode.addMessageToChat` → `chatContainer.addChild` for
//     uniform single-line spacing consistency (no double spacers).
//
// Everything is guarded with try/catch and an idempotent `__patched` flag so
// the patch never crashes the host and cannot be applied twice.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { InteractiveMode, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Spacer } from "@earendil-works/pi-tui";

import { resolveTemplate } from "./rendering.js";

// ── Constants ──────────────────────────────────────────────────────────

/**
 * Tool names that already have a dedicated unified renderer (read/write/edit/
 * ls/grep/find/bash/pwsh/powershell). These are left to the host's normal
 * render path; only the rest are intercepted.
 */
export const DEDICATED_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "ls",
  "grep",
  "find",
  "bash",
  "pwsh",
  "powershell",
]);

/** Tools that should produce no visual output at all. */
export const SUPPRESSED_TOOLS = new Set(["todo"]);

// Convenience flag name shared with rendering primitives (avoid duplication).
const PATCH_FLAG = "__tui_patchTools_patched";

// ── Passthrough theme ─────────────────────────────────────────────────
//
// For the render() backstop (tools registered BEFORE our registerTool patches
// ran) we use a passthrough theme so the unified structure still renders
// without color.

const PASSTHROUGH_THEME: any = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  inverse: (text: string) => text,
};

// ── Per-registration patch (instance + prototype registerTool) ───────

/**
 * Give an unknown/generic tool a unified renderCall/renderResult via
 * resolveTemplate in rendering.ts. Known tools and tools that already ship
 * their own renderer are left untouched. Idempotent.
 */
function unifyUnknownTool(tool: any): void {
  if (!tool || typeof tool !== "object") return;
  const name = tool.name ?? tool.toolName;
  if (!name) return;
  if (DEDICATED_TOOLS.has(name)) return;
  if ((tool as any).__tui_unknown_patched) return;
  // Skip a tool that already provides its own custom render shell.
  if (tool.renderShell === "self" && typeof tool.renderCall === "function") return;

  const template = resolveTemplate(tool);
  if (!template) return;

  (tool as any).__tui_unknown_patched = true;
  tool.renderShell = "self";
  tool.renderCall = template.renderCall;
  tool.renderResult = template.renderResult;
}

// ── Public entry point ───────────────────────────────────────────────

/**
 * Install the unknown-tool monkey-patches:
 *   1. ToolExecutionComponent.prototype.render backstop (for tools already
 *      registered before this extension loaded).
 *   2. Instance + prototype registerTool wrapping (catches late-registered
 *      tools from other extensions).
 *   3. InteractiveMode.addMessageToChat → chatContainer.addChild spacing
 *      consistency (one uniform blank line above every non-blank child).
 *
 * Idempotent and fully guarded; safe to call multiple times and safe if the
 * required peer classes are missing.
 */
export function patchUnknownToolRenderers(pi: ExtensionAPI): void {
  try {
    if ((globalThis as any)[PATCH_FLAG]) return;

    patchToolExecutionRenderBackstop();
    patchRegisterToolInstance(pi as any);
    patchRegisterToolPrototype(pi as any);
    patchAddMessageToChatSpacing();

    (globalThis as any)[PATCH_FLAG] = true;
  } catch (e: any) {
    // Never let patching break the host.
    if (typeof console !== "undefined") {
      console.error("[tui] patchUnknownToolRenderers failed:", e?.message ?? e);
    }
  }
}

// ── 1. ToolExecutionComponent.prototype.render backstop ──────────────

function patchToolExecutionRenderBackstop(): void {
  if (
    !ToolExecutionComponent ||
    !(ToolExecutionComponent as any).prototype?.render ||
    (ToolExecutionComponent.prototype.render as any).__tui_patched
  ) {
    return;
  }

  const originalRender = ToolExecutionComponent.prototype.render as any;
  (ToolExecutionComponent.prototype.render as any) = function (this: any, width: number) {
    const toolName = this.toolName;
    const name = typeof toolName === "string" ? toolName : "";
    const w = width || 100;

    // Suppressed tools: render nothing.
    if (name && SUPPRESSED_TOOLS.has(name)) return [];

    // Known/dedicated tools keep their own unified rendering.
    if (name && DEDICATED_TOOLS.has(name)) {
      const out = originalRender.apply(this, arguments);
      return Array.isArray(out) ? out : [];
    }

    // Unknown tool: resolve template and render through it.
    try {
      const fakeTool = { name };
      const template = resolveTemplate(fakeTool as any);
      if (!template || !template.renderResult) return [];

      const comp = template.renderResult(
        this.result ?? { content: [] },
        { expanded: Boolean(this.expanded) },
        PASSTHROUGH_THEME,
        { args: this.args, isError: this.result?.isError },
      );
      const lines = Array.isArray(comp) ? comp : comp.render(w);
      // Drop any leading blank line.
      while (lines.length > 0 && lines[0].trim() === "") lines.shift();
      return lines;
    } catch {
      return [];
    }
  };
  (ToolExecutionComponent.prototype.render as any).__tui_patched = true;
}

// ── 2a. Instance registerTool ────────────────────────────────────────

function patchRegisterToolInstance(pi: any): void {
  if (!pi || typeof pi.registerTool !== "function") return;
  if ((pi.registerTool as any).__tui_patched) return;

  const origRegister = pi.registerTool.bind(pi);
  (pi as any).registerTool = function (tool: any, ...rest: any[]) {
    try {
      unifyUnknownTool(tool);
    } catch {
      /* never block registration */
    }
    return origRegister(tool, ...rest);
  };
  (pi.registerTool as any).__tui_patched = true;
}

// ── 2b. Prototype registerTool (catches other extensions' registrations) ─

function patchRegisterToolPrototype(pi: any): void {
  const proto = pi && Object.getPrototypeOf(pi);
  if (
    !proto ||
    typeof proto.registerTool !== "function" ||
    (proto.registerTool as any).__tui_patched
  ) {
    return;
  }

  const origProtoRegister = proto.registerTool;
  proto.registerTool = function (tool: any, ...rest: any[]) {
    try {
      unifyUnknownTool(tool);
    } catch {
      /* never block registration */
    }
    return origProtoRegister.call(this, tool, ...rest);
  };
  (proto.registerTool as any).__tui_patched = true;
}

// ── 3. InteractiveMode.addMessageToChat spacing consistency ──────────

function patchAddMessageToChatSpacing(): void {
  if (
    !InteractiveMode ||
    !(InteractiveMode as any).prototype?.addMessageToChat ||
    (InteractiveMode.prototype.addMessageToChat as any).__tui_patched
  ) {
    return;
  }

  const installChatContainerProactiveSpacer = (chatContainer: any) => {
    if (!chatContainer || chatContainer.__tui_proactiveSpacerInstalled) return;

    const originalAddChild = chatContainer.addChild;
    let lastSpacerArgs: any[] | null = null;

    chatContainer.addChild = function (...args: any[]) {
      const component = args[0];

      // Hold back an explicit single-blank-line component so we never stack two
      // spacers back-to-back; flush it before the next non-blank child.
      if (args.length > 0 && component && typeof component.render === "function") {
        const probe = component.render();
        if (probe.length === 1 && probe[0].trim() === "") {
          lastSpacerArgs = args;
          return;
        }
      }

      // Non-blank child: inject a single spacer if the container already has
      // content and does not already end on a blank line.
      let needsSpacer = this.children.length > 0;
      if (needsSpacer) {
        for (let i = this.children.length - 1; i >= 0; i--) {
          const child = this.children[i];
          if (typeof child?.render === "function") {
            const childLines = child.render(100);
            if (
              childLines &&
              childLines.length > 0 &&
              childLines[childLines.length - 1].trim() === ""
            ) {
              needsSpacer = false;
            }
            break;
          }
        }
      }

      if (needsSpacer) {
        if (lastSpacerArgs) originalAddChild.apply(this, lastSpacerArgs);
        else originalAddChild.call(this, new Spacer(1));
      }
      lastSpacerArgs = null;

      return originalAddChild.apply(this, args);
    };

    chatContainer.__tui_proactiveSpacerInstalled = true;
  };

  const originalAdd = InteractiveMode.prototype.addMessageToChat as any;
  InteractiveMode.prototype.addMessageToChat = function (message: any, options?: any) {
    if (this.chatContainer) installChatContainerProactiveSpacer(this.chatContainer);
    return originalAdd.call(this, message, options);
  };
  (InteractiveMode.prototype.addMessageToChat as any).__tui_patched = true;
}
