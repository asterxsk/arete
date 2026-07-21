/**
 * compactui — Compact tool rendering with output truncation
 *
 * Entry point. Imports and wires together:
 *   - rendering.ts    — shared rendering templates
 *   - patch-tools.ts  — template-based tool patching
 *   - assistant-footer.ts — duration footer on assistant messages
 *   - prompt-ui.ts    — user message prompt styling
 *   - tool-status-dot.ts — animated status dot for running tools
 *
 * Removed all explicit tool re-registrations. The generic patchTool
 * in patch-tools.ts handles all tool rendering via template dispatch.
 * Questions tool is left as-is per user request.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  AssistantMessageComponent,
  BashExecutionComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  InteractiveMode,
  ToolExecutionComponent,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Text, Spacer } from "@earendil-works/pi-tui";

import {
  line, noOp, DIM_GREY,
} from "./rendering.js";
import { patchTool, TRUNCATED_TOOLS, KNOWN_TOOLS, MAX_LINES } from "./patch-tools.js";
import { initAssistantFooter } from "./assistant-footer.js";
import { initPromptUi } from "./prompt-ui.js";
import { initToolStatusDot } from "./tool-status-dot.js";

// ── Module Constants ─────────────────────────────────────────────────
const HIDDEN_TOOLS = new Set(["todo", "grep", "find", "ls"]);


// ── Helper ────────────────────────────────────────────────────────────

/**
 * PrefixedMarkdown — renders markdown with a prefix on the first line
 * and matching indentation on continuation lines for visual alignment.
 */
function prefixedMarkdown(prefix: string, text: string, x: number, theme: any): any {
  return {
    render(width: number): string[] {
      const avail = width - x - prefix.length;
      if (avail <= 0) return [" ".repeat(width)];
      const md = new Markdown(text, 0, 0, theme);
      const lines = md.render(avail);
      if (!lines || lines.length === 0) return [""];
      const result: string[] = [];
      const basePad = " ".repeat(x);
      const prefixPad = " ".repeat(prefix.length);
      result.push(basePad + prefix + (lines[0] || ""));
      for (let i = 1; i < lines.length; i++) {
        result.push(basePad + prefixPad + (lines[i] || ""));
      }
      return result;
    },
    invalidate() {},
  };
}

// ── State ──────────────────────────────────────────────────────────────

let patchedAssistant = false;

// ── Main Extension ─────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Flag so other extensions (like tasks) know we are active
  (globalThis as any).__pi_betterui_enabled = true;

  // ── Patch Already-Registered Tools ──────────────────────────────────
  const registeredTools = (pi as any).tools
    ? ((pi as any).tools instanceof Map
        ? Array.from((pi as any).tools.values())
        : Object.values((pi as any).tools))
    : ((pi as any).getTools ? (pi as any).getTools() : []);
  for (const tool of registeredTools) {
    if (tool && typeof tool === 'object') patchTool(tool);
  }

  // Patch the instance's registerTool
  const origRegister = pi.registerTool.bind(pi);
  pi.registerTool = (tool: any) => {
    patchTool(tool);
    origRegister(tool);
  };

  // Patch the prototype's registerTool to catch other extensions
  const proto = Object.getPrototypeOf(pi);
  if (proto && typeof proto.registerTool === "function" && !(proto as any).__compactui_patched_register) {
    (proto as any).__compactui_patched_register = true;
    const origProtoRegister = proto.registerTool;
    proto.registerTool = function (tool: any) {
      patchTool(tool);
      return origProtoRegister.call(this, tool);
    };
  }

  // Expose patchTool globally as fallback for fresh pi objects
  (globalThis as any).__pi_patchTool = patchTool;


  
  // ── Patch UI Components ─────────────────────────────────────────────
  if (!patchedAssistant) {
    try {
      if (InteractiveMode && InteractiveMode.prototype.addMessageToChat &&
          !(InteractiveMode.prototype.addMessageToChat as any).__compactui_patched) {
        // ── Persistent chatContainer.addChild patch with proactive spacer ──
        const installChatContainerProactiveSpacer = (chatContainer: any) => {
          if (chatContainer.__compactui_proactiveSpacerInstalled) return;
          const originalAddChild = chatContainer.addChild;
          let lastSpacerArgs: any[] | null = null;
          let pendingSkillComponent: any = null;

          chatContainer.addChild = function (...args: any[]) {
            const component = args[0];
            
            // Skip hidden tool components entirely (no render, no spacing)
            if (component && typeof component === "object" &&
                component.constructor?.name === "ToolExecutionComponent" &&
                component.toolName && HIDDEN_TOOLS.has(component.toolName)) {
              return;
            }
            
            // Detect SkillInvocationMessageComponent (skill block)
            const isSkillComponent = component && 
              typeof component === "object" &&
              component.constructor?.name === "SkillInvocationMessageComponent" &&
              !component.expanded;
            
            if (isSkillComponent) {
              pendingSkillComponent = component;
              return;
            }
            
            // Detect UserMessageComponent (user message)
            const isUserMessage = component && 
              typeof component === "object" &&
              component.constructor?.name === "UserMessageComponent";
            
            if (isUserMessage && pendingSkillComponent) {
              if (lastSpacerArgs) {
                originalAddChild.apply(this, lastSpacerArgs);
                lastSpacerArgs = null;
              }
              const result = originalAddChild.apply(this, args);
              const skillName = pendingSkillComponent.skillBlock?.name || "skill";
              const hint = " [ctrl+o to expand]";
              const prefix = "  \u2514 ";
              const lineText = prefix + skillName + hint;
              const subtitleText = DIM_GREY + lineText + "\x1b[39m";
              const subtitleComponent = {
                render(width: number) { return [subtitleText]; },
                invalidate() {}
              };
              originalAddChild.call(this, subtitleComponent);
              pendingSkillComponent = null;
              return result;
            }
            
            // Hold back spacer components
            if (args.length > 0 && args[0] && typeof args[0].render === "function") {
              const lines = args[0].render();
              if (lines.length === 1 && lines[0].trim() === "") {
                lastSpacerArgs = args;
                return;
              }
            }

            let needsSpacer = this.children.length > 0;
            if (needsSpacer) {
              for (let i = this.children.length - 1; i >= 0; i--) {
                const child = this.children[i];
                if (typeof child.render === "function") {
                  const childLines = child.render(100);
                  if (childLines && childLines.length > 0) {
                    if (childLines[childLines.length - 1].trim() === "") {
                      needsSpacer = false;
                    }
                    break;
                  }
                }
              }
            }

            if (needsSpacer) {
              if (lastSpacerArgs) {
                originalAddChild.apply(this, lastSpacerArgs);
              } else {
                originalAddChild.call(this, new Spacer(1));
              }
            }
            lastSpacerArgs = null;

            return originalAddChild.apply(this, args);
          };
          chatContainer.__compactui_proactiveSpacerInstalled = true;
        };

        const originalAdd = InteractiveMode.prototype.addMessageToChat;
        InteractiveMode.prototype.addMessageToChat = function (message: any, options?: any) {
          if (this.chatContainer) installChatContainerProactiveSpacer(this.chatContainer);
          return originalAdd.call(this, message, options);
        };
        (InteractiveMode.prototype.addMessageToChat as any).__compactui_patched = true;
      }

      class CompactThinkingBlock {
        private markdown: any;
        constructor(text: string, theme: any) {
          this.markdown = new Markdown(text, 0, 0, theme);
        }
        render(width: number) {
          const lines = this.markdown.render(Math.max(1, width - 4));
          const result = [];
          for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            line = line.replace(/\x1b\[[0-9;]*m/g, "");
            line = `\x1b[38;2;140;140;140m${line}\x1b[39m`;
            
            if (i === 0) {
              result.push(`\x1b[38;2;140;140;140m∴\x1b[39m  ${line}`);
            } else {
              result.push(`    ${line}`);
            }
          }
          return result;
        }
      }

      // ── Patch AssistantMessageComponent.updateContent ────────────────
      if (
        AssistantMessageComponent &&
        AssistantMessageComponent.prototype.updateContent &&
        !(AssistantMessageComponent.prototype.updateContent as any).__compactui_patched
      ) {
        AssistantMessageComponent.prototype.updateContent = function (message: any) {
          this.lastMessage = message;
          this.contentContainer.clear();

          let hasThinking = false;
          let hasPrefix = false;
          for (let i = 0; i < message.content.length; i++) {
            const content = message.content[i];
            if (content.type === "text" && content.text.trim()) {
              if (hasThinking) {
                this.contentContainer.addChild(line(""));
              }
              if (content.text) {
                let text = content.text.trim();
                if (text && !hasPrefix) {
                  hasPrefix = true;
                }
                text = text.replace(/\\x1b\[[0-9;]*m/g, "");
                text = text.replace(/\x1b\[[0-9;]*m/g, "");
                text = text.replace(/\\?\[\[?38;2;140;140;140m/g, "");
                text = text.replace(/\\?\[0m/g, "");
                text = text.replace(/\\?\[39m/g, "");

                const footerMarker = "\u273b Worked for";
                const markerIndex = text.lastIndexOf(footerMarker);
                
                if (markerIndex !== -1 && markerIndex >= text.length - 200) {
                   const footerText = text.substring(markerIndex).trim();
                   text = text.substring(0, markerIndex).trim();
                   text = text.replace(/\u273b Worked for[^\n]*/g, "").trim();
                   text = text.replace(/\u2726 Worked for[^\n]*/g, "").trim();
                   
                   if (text) {
                     if (hasPrefix) {
                       this.contentContainer.addChild(prefixedMarkdown("\u25cf ", text, 1, this.markdownTheme));
                     } else {
                       this.contentContainer.addChild(new Markdown(text, 1, 0, this.markdownTheme));
                     }
                   }
                   this.contentContainer.addChild(line(""));
                   this.contentContainer.addChild(
                     new Text(`${DIM_GREY}${footerText}\x1b[0m`, 1, 0)
                   );
                } else {
                   text = text.replace(/\u273b Worked for[^\n]*/g, "").trim();
                   text = text.replace(/\u2726 Worked for[^\n]*/g, "").trim();
                   if (text) {
                     if (hasPrefix) {
                       this.contentContainer.addChild(prefixedMarkdown("\u25cf ", text, 1, this.markdownTheme));
                     } else {
                       this.contentContainer.addChild(new Markdown(text, 1, 0, this.markdownTheme));
                     }
                   }
                }
              }
            } else if (
              content.type === "thinking" &&
              content.thinking &&
              content.thinking.trim()
            ) {
              if (!this.hideThinkingBlock) {
                hasThinking = true;
                if (this.contentContainer.children.length > 0) {
                  this.contentContainer.addChild(line(""));
                }
                this.contentContainer.addChild(
                  new CompactThinkingBlock(content.thinking.trim(), this.markdownTheme)
                );
              }
            }
          }

          const hasToolCalls = message.content.some((c: any) => c.type === "tool_use");
          
          if (!hasToolCalls) {
            if (message.stopReason === "aborted") {
              const abortMessage =
                message.errorMessage && message.errorMessage !== "Request was aborted"
                  ? message.errorMessage
                  : "Operation aborted";
              this.contentContainer.addChild(
                new Text(`\x1b[38;2;255;85;85m${abortMessage}\x1b[39m`, 1, 0)
              );
            } else if (message.stopReason === "error") {
              const errorMsg = message.errorMessage || "Unknown error";
              this.contentContainer.addChild(
                new Text(`\x1b[38;2;255;85;85mError: ${errorMsg}\x1b[39m`, 1, 0)
              );
            }
          }
        };
        (AssistantMessageComponent.prototype.updateContent as any).__compactui_patched = true;
      }

      // ── Patch ToolExecutionComponent.render ────────────────────────
      if (
        ToolExecutionComponent &&
        ToolExecutionComponent.prototype.render &&
        !ToolExecutionComponent.prototype.render.__compactui_patched
      ) {
        const originalRender = ToolExecutionComponent.prototype.render;
        ToolExecutionComponent.prototype.render = function (width: number) {
          if (this.toolName && HIDDEN_TOOLS.has(this.toolName)) {
            return [];
          }
          const out = originalRender.apply(this, arguments) as string[];
          while (out.length > 0 && out[0].trim() === "") out.shift();
          return out;
        };
        ToolExecutionComponent.prototype.render.__compactui_patched = true;
      }

      // ── Patch BashExecutionComponent.render ──────────────────────────
      if (
        BashExecutionComponent &&
        BashExecutionComponent.prototype.render &&
        !(BashExecutionComponent.prototype.render as any).__compactui_patched
      ) {
        const originalBashRender = BashExecutionComponent.prototype.render;
        BashExecutionComponent.prototype.render = function (this: any, width: number) {
          const lines = originalBashRender.call(this, width);
          while (lines.length > 0 && lines[0].trim() === "") lines.shift();
          return lines;
        };
        (BashExecutionComponent.prototype.render as any).__compactui_patched = true;
      }

      // ── Patch CustomMessageComponent.render ──────────────────────────
      if (
        CustomMessageComponent &&
        CustomMessageComponent.prototype.render &&
        !(CustomMessageComponent.prototype.render as any).__compactui_patched
      ) {
        const originalCustomRender = CustomMessageComponent.prototype.render;
        CustomMessageComponent.prototype.render = function (this: any, width: number) {
          const lines = originalCustomRender.call(this, width);
          while (lines.length > 0 && lines[0].trim() === "") lines.shift();
          return lines;
        };
        (CustomMessageComponent.prototype.render as any).__compactui_patched = true;
      }

      // Patch toggleToolOutputExpansion
      const originalToggleExpand =
        InteractiveMode.prototype.toggleToolOutputExpansion;
      if (
        originalToggleExpand &&
        !InteractiveMode.prototype.toggleToolOutputExpansion.__compactui_patched
      ) {
        InteractiveMode.prototype.toggleToolOutputExpansion = function () {
          const scroll =
            this.chatContainer &&
            typeof this.chatContainer.getScroll === "function"
              ? this.chatContainer.getScroll()
              : undefined;

          originalToggleExpand.apply(this, arguments);

          if (
            scroll !== undefined &&
            this.chatContainer &&
            typeof this.chatContainer.setScroll === "function"
          ) {
            setTimeout(() => {
              if (
                this.chatContainer &&
                typeof this.chatContainer.setScroll === "function"
              ) {
                this.chatContainer.setScroll(scroll);
              }
              if (
                this.ui &&
                typeof this.ui.requestRender === "function"
              ) {
                this.ui.requestRender();
              }
            }, 10);
          }
        };
        InteractiveMode.prototype.toggleToolOutputExpansion.__compactui_patched = true;
      }

      // ── Patch ToolExecutionComponent for path stripping ────────────────
      const PATH_TOOLS = new Set(["read", "write", "edit"]);
      
      function shortenPath(toolName: string, fullPath: string): string {
        const parts = fullPath.split("/");
        if (parts.length >= 2) {
          return parts.slice(-2).join("/");
        }
        return fullPath;
      }
      
      if (
        ToolExecutionComponent &&
        ToolExecutionComponent.prototype.updateDisplay &&
        !(ToolExecutionComponent.prototype.updateDisplay as any).__compactui_path_patched
      ) {
        const origUpdateDisplay = ToolExecutionComponent.prototype.updateDisplay;
        ToolExecutionComponent.prototype.updateDisplay = function () {
          if (this.result && !Array.isArray(this.result.content)) {
            this.result.content = [];
          }
          if (PATH_TOOLS.has(this.toolName) && !this.expanded && this.args) {
            const pathKey = this.args.path ? 'path' : this.args.file ? 'file' : this.args.filePath ? 'filePath' : this.args.source ? 'source' : null;
            const origPath = pathKey ? this.args[pathKey] : null;
            if (origPath && typeof origPath === "string" && origPath.includes("/")) {
              const shortened = shortenPath(this.toolName, origPath);
              this.args[pathKey] = shortened;
              origUpdateDisplay.call(this);
              this.args[pathKey] = origPath;
              return;
            }
          }
          origUpdateDisplay.call(this);
        };
        (ToolExecutionComponent.prototype.updateDisplay as any).__compactui_path_patched = true;
      }

      // ── Patch CompactionSummaryMessageComponent ──────────────────
      if (
        CompactionSummaryMessageComponent &&
        !(CompactionSummaryMessageComponent.prototype as any).__compactui_patched
      ) {
        const origUpdateDisplay = CompactionSummaryMessageComponent.prototype.updateDisplay;
        
        CompactionSummaryMessageComponent.prototype.updateDisplay = function () {
          this.clear();
          
          const tokenStr = this.message.tokensBefore.toLocaleString();
          const hint = DIM_GREY + " (ctrl+o to expand)" + "\x1b[39m";
          
          if (this.expanded) {
            const header = `**Compacted from ${tokenStr} tokens**\n\n`;
            this.addChild(new Markdown(header + this.message.summary, 0, 0, getMarkdownTheme(), {
              color: (text: string) => `${DIM_GREY}${text}\x1b[39m`,
            }));
          } else {
            const message = "\u273b Compacted from " + tokenStr + " tokens" + hint;
            const padding = Math.max(0, Math.floor((60 - message.length) / 2));
            const centered = " ".repeat(padding) + message;
            this.addChild(new Text(centered, 0, 0));
          }
        };
        
        const origRender = CompactionSummaryMessageComponent.prototype.render;
        CompactionSummaryMessageComponent.prototype.render = function (width: number) {
          const lines = origRender.call(this, width);
          return lines.map((line: string) => {
            let cleaned = line.replace(/\x1b\[48;2;\d+;\d+;\d+m/g, "");
            cleaned = cleaned.replace(/\x1b\[(?:4[0-7]|10[0-7])m/g, "");
            return cleaned;
          });
        };
        
        (CompactionSummaryMessageComponent.prototype as any).__compactui_patched = true;
      }

      patchedAssistant = true;
    } catch (e) {
      console.error("Failed to patch UI components in compactui extension:", e);
    }
  }

  // ── Event Hooks ─────────────────────────────────────────────────────
  const unknownTools = new Set<string>();

  pi.on("tool_call", async (event) => {
    if (!KNOWN_TOOLS.has(event.toolName) && !unknownTools.has(event.toolName)) {
      unknownTools.add(event.toolName);
    }
  });

  // ── Truncate tool output + format unknown tool errors ───────────────
  pi.on("tool_result", async (event) => {
    const content = event.content;
    if (!content || content.length === 0) return;

    if (event.isError && unknownTools.has(event.toolName)) {
      const errorText = content
        .map((p: any) => (p.type === "text" ? p.text : ""))
        .join("\n");
      const formatted = `Tool "${event.toolName}" is not registered.\nAvailable tools: ${Array.from(KNOWN_TOOLS).join(", ")}`;
      return {
        content: [{ type: "text", text: formatted }],
        details: { _fullOutput: formatted, _isUnknownTool: true },
        isError: true,
      };
    }

    // Detect JSON leaks and tool issues
    if (!event.isError) {
      const fullText = content
        .map((p: any) => (p.type === "text" ? p.text : ""))
        .join("\n");
      
      const isJsonLeak = 
        fullText.startsWith("{\"") ||
        fullText.startsWith("[{\"") ||
        fullText.match(/^{\s*"error"\s*:/i) ||
        fullText.match(/^{\s*"message"\s*:\s*"/i) ||
        fullText.includes("\"error\":\s*\"") ||
        fullText.includes("traceback") ||
        fullText.includes("Traceback (most recent call last)") ||
        fullText.includes("SyntaxError:") ||
        fullText.includes("JSONDecodeError:");
      
      if (isJsonLeak && fullText.length > 0) {
        const formatted = `Tool "${event.toolName}" returned malformed output`;
        return {
          content: [{ type: "text", text: formatted }],
          details: { _fullOutput: formatted, _isJsonLeak: true },
          isError: true,
        };
      }
    }

    if (!TRUNCATED_TOOLS.has(event.toolName)) return;

    const newContent = content.map((part: any) => {
      if (part.type !== "text" || !part.text) return part;
      const lines = part.text.split("\n");
      if (lines.length <= MAX_LINES) return part;
      const totalLines = lines.length;
      const hidden = totalLines - MAX_LINES;
      const kept = lines.slice(0, MAX_LINES).join("\n");
      return {
        ...part,
        text: `${kept}\n... (${hidden} more lines, ${totalLines} total, ctrl+o to expand)`,
      };
    });

    for (let i = 0; i < content.length; i++) {
      if (newContent[i].text !== content[i].text) {
        return { content: newContent };
      }
    }
  });

  // ── Patch renderWidgetContainer: remove leading spacer above widgets ──
  if (
    InteractiveMode &&
    InteractiveMode.prototype.renderWidgetContainer &&
    !(InteractiveMode.prototype.renderWidgetContainer as any).__compactui_patched
  ) {
    const originalRenderWidgetContainer = InteractiveMode.prototype.renderWidgetContainer;
    InteractiveMode.prototype.renderWidgetContainer = function (
      container: any,
      widgets: any,
      spacerWhenEmpty: boolean,
      leadingSpacer: boolean,
    ) {
      return originalRenderWidgetContainer.call(this, container, widgets, spacerWhenEmpty, false);
    };
    (InteractiveMode.prototype.renderWidgetContainer as any).__compactui_patched = true;
  }

  // ── Initialize UI Features ──────────────────────────────────────────
  initAssistantFooter(pi);
  initPromptUi();
  initToolStatusDot();

  // ── Patch showStatus: auto-dismiss status notifications after 3s ──
  if (
    InteractiveMode &&
    InteractiveMode.prototype.showStatus &&
    !(InteractiveMode.prototype.showStatus as any).__compactui_autoDismiss
  ) {
    const origShowStatus = InteractiveMode.prototype.showStatus;
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;

    InteractiveMode.prototype.showStatus = function (message: string) {
      origShowStatus.call(this, message);

      if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
      }

      dismissTimer = setTimeout(() => {
        const spacer = (this as any).lastStatusSpacer;
        const text = (this as any).lastStatusText;
        if (spacer && text) {
          (this as any).chatContainer.removeChild(spacer);
          (this as any).chatContainer.removeChild(text);
          (this as any).lastStatusSpacer = undefined;
          (this as any).lastStatusText = undefined;
          (this as any).ui?.requestRender();
        }
        dismissTimer = null;
      }, 3000);
    };
    (InteractiveMode.prototype.showStatus as any).__compactui_autoDismiss = true;
  }

  // Hide the native "Thought for Ns" label from the TUI since it is now shown in the spinner
  pi.on("session_start", async (e, ctx) => {
    if (ctx.mode === "tui") {
      ctx.ui.setHiddenThinkingLabel("");
    }
  });
}
