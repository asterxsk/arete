/**
 * compactui — Compact tool rendering with output truncation
 *
 * Entry point. Imports and wires together:
 *   - rendering.ts    — shared rendering primitives
 *   - patch-tools.ts  — tool patching interception
 *   - assistant-footer.ts — duration footer on assistant messages
 *   - prompt-ui.ts    — user message prompt styling
 *   - tool-status-dot.ts — animated status dot for running tools
 */

import * as path from "path";
import type { ExtensionAPI, EditToolDetails } from "@earendil-works/pi-coding-agent";
import {
  AssistantMessageComponent,
  BashExecutionComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  InteractiveMode,
  ToolExecutionComponent,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Text, Spacer, truncateToWidth } from "@earendil-works/pi-tui";

import {
  line, noOp, orange, compactCall, compactSummary, compactFailed,
  expandedBox, diffExpandedBox, captureResult, DIM_GREY, capitalizeToolName, INDENT, wrapDiffLine, colorizeDiffLine,
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
        // Installs a one-time wrapper on this.chatContainer that gives every
        // non-blank child a uniform 1-line spacer above it. Behaviour:
        //   - Incoming single-blank-line component (native Spacer, line("")) →
        //     held back; flushed before the next non-blank child so we never
        //     double up spacers.
        //   - Incoming non-blank child → if a spacer is held, flush it; else if
        //     the container already has content, inject a fresh Spacer(1) above.
        //   - Empty container + first child → no spacer injected (nothing to
        //     separate from).
        // This covers every code path that adds to chatContainer: addMessageToChat
        // (user/assistant/tool/bash/custom), message_start (streaming
        // AssistantMessageComponent), message_update (tool components),
        // toggleThinkingBlockVisibility rebuild, showStatus, errorMessage, etc.
        const installChatContainerProactiveSpacer = (chatContainer: any) => {
          if (chatContainer.__compactui_proactiveSpacerInstalled) return;
          const originalAddChild = chatContainer.addChild;
          let lastSpacerArgs: any[] | null = null;
          // Hold skill invocation components to reorder them below user message
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
            // We identify it by checking for skillBlock property and the component type
            const isSkillComponent = component && 
              typeof component === "object" &&
              component.constructor?.name === "SkillInvocationMessageComponent" &&
              !component.expanded;
            
            if (isSkillComponent) {
              // Hold back skill component to render after user message
              pendingSkillComponent = component;
              return;
            }
            
            // Detect UserMessageComponent (user message)
            const isUserMessage = component && 
              typeof component === "object" &&
              component.constructor?.name === "UserMessageComponent";
            
            if (isUserMessage && pendingSkillComponent) {
              // Flush any held spacer first
              if (lastSpacerArgs) {
                originalAddChild.apply(this, lastSpacerArgs);
                lastSpacerArgs = null;
              }
              // User message coming after held skill: render user message first,
              // then add skill subtitle below it
              const result = originalAddChild.apply(this, args);
              // Now add the skill subtitle (no background, compact format)
              const skillName = pendingSkillComponent.skillBlock?.name || "skill";
              const hint = " [ctrl+o to expand]";
              const prefix = "  \u2514 ";
              const lineText = prefix + skillName + hint;
              const resetColor = "\x1b[39m";
              const subtitleText = DIM_GREY + lineText + resetColor;
              // Create a simple line component for the subtitle
              const subtitleComponent = {
                render(width: number) { return [subtitleText]; },
                invalidate() {}
              };
              originalAddChild.call(this, subtitleComponent);
              pendingSkillComponent = null;
              return result;
            }
            
            // Hold back any spacer component so we never render two blank
            // lines back-to-back. It will be flushed before the next
            // non-blank component, or dropped if no such component follows.
            if (args.length > 0 && args[0] && typeof args[0].render === "function") {
              const lines = args[0].render();
              if (lines.length === 1 && lines[0].trim() === "") {
                lastSpacerArgs = args;
                return;
              }
            }

            // Non-spacer incoming: inject a spacer if the container doesn't
            // already end with a blank line (either from a held spacer or implicitly).
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
          // First call into addMessageToChat installs the persistent wrapper
          // on chatContainer so streaming/direct addChild calls also benefit.
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
          // Render markdown with width reduced by 4 (to account for the 4-space prefix)
          const lines = this.markdown.render(Math.max(1, width - 4));
          const result = [];
          for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            // Strip all existing ANSI codes to remove syntax highlighting
            line = line.replace(/\x1b\[[0-9;]*m/g, "");
            // Apply normal grey color to the entire line
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
                // Add "● " prefix before first assistant text block on the same line
                if (text && !hasPrefix) {
                  hasPrefix = true;
                  // We'll handle the prefix below when creating the markdown component
                }
                // Clean up garbage literal ANSI escapes and markdown-escaped ANSI from history
                text = text.replace(/\\x1b\[[0-9;]*m/g, "");
                text = text.replace(/\x1b\[[0-9;]*m/g, "");
                text = text.replace(/\\?\[\[?38;2;140;140;140m/g, "");
                text = text.replace(/\\?\[0m/g, "");
                text = text.replace(/\\?\[39m/g, "");

                const footerMarker = "✻ Worked for";
                const markerIndex = text.lastIndexOf(footerMarker);
                
                if (markerIndex !== -1 && markerIndex >= text.length - 200) {
                   const footerText = text.substring(markerIndex).trim();
                   text = text.substring(0, markerIndex).trim();
                   // Also remove any older duplicate markers from the body
                   text = text.replace(/✻ Worked for[^\n]*/g, "").trim();
                   text = text.replace(/✦ Worked for[^\n]*/g, "").trim();
                   
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
                   // Clean up duplicates even if it's not at the end
                   text = text.replace(/✻ Worked for[^\n]*/g, "").trim();
                   text = text.replace(/✦ Worked for[^\n]*/g, "").trim();
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
                // Only inject a separator if thinking isn't the first child of
                // contentContainer. When thinking is first, the proactive
                // chatContainer spacer above the AssistantMessageComponent is
                // already the separator from the previous chat line — adding
                // another line("") here would yield a 2-line gap.
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
          // Completely hide certain tool calls
          if (this.toolName && HIDDEN_TOOLS.has(this.toolName)) {
            return [];
          }
          const knownTools = ["read", "write", "bash", "edit", "find", "grep", "ls"];
          if (this.toolName && !knownTools.includes(this.toolName)) {
            const dummyTheme = {
              fg: (color: string, text: string) => color === "dim" ? `${DIM_GREY}${text}\x1b[39m` : text
            };
            const argsStr = typeof this.args === "string" ? this.args : JSON.stringify(this.args || {});
            const w = width || 100; // fallback if width not provided
            
            if (!this.expanded) {
              const resultLines: string[] = [];
              
              const callComp = compactCall(this.toolName, argsStr, dummyTheme);
              resultLines.push(...callComp.render(w));
              
              if (this.result) {
                if (this.result.isError) {
                  resultLines.push(...compactFailed(dummyTheme).render(w));
                } else {
                  const fullText = this.result.content?.[0]?.text || "";
                  const lineCount = fullText ? fullText.split("\n").length : 0;
                  resultLines.push(...compactSummary(dummyTheme, `${this.toolName} output`, lineCount, "line", fullText).render(w));
                }
              }
              
              return resultLines;
            } else {
              // Expanded view for unknown tools
              const resultLines: string[] = [];
              
              if (this.result) {
                if (this.result.isError) {
                  // Show expanded error with ⎿ prefix
                  const errText = this.result.content?.[0]?.text || "failed";
                  const errLines = errText.split("\n");
                  resultLines.push(...expandedBox(dummyTheme, this.toolName, argsStr, errLines, 40).render(w));
                } else {
                  // expandedBox includes its own header
                  const fullText = this.result.content?.[0]?.text || "";
                  const lines = fullText.split("\n");
                  resultLines.push(...expandedBox(dummyTheme, this.toolName, argsStr, lines, 40).render(w));
                }
              } else {
                // Still running - show running status with ⎿ prefix
                const runningLines = [`${capitalizeToolName(this.toolName)} running...`];
                resultLines.push(...expandedBox(dummyTheme, this.toolName, argsStr, runningLines, 40).render(w));
              }
              
              return resultLines;
            }
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
      const PATH_PREFIX = path.join(process.env.HOME || "~", ".pi", "agent") + "/";
      const PATH_TOOLS = new Set(["read", "write", "edit"]);
      
      function shortenPath(toolName: string, fullPath: string): string {
        // Return parent folder/filename for all tools
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
          // Shorten path for read/write/edit tools in non-expanded view
          if (PATH_TOOLS.has(this.toolName) && !this.expanded && this.args) {
            const origPath = this.args.path || this.args.file || this.args.filePath || this.args.source;
            if (origPath && typeof origPath === "string" && origPath.includes("/")) {
              // Temporarily modify args for rendering
              const shortened = shortenPath(this.toolName, origPath);
              if (this.args.path) this.args.path = shortened;
              if (this.args.file) this.args.file = shortened;
              if (this.args.filePath) this.args.filePath = shortened;
              if (this.args.source) this.args.source = shortened;
              origUpdateDisplay.call(this);
              // Restore original args
              if (this.args.path) this.args.path = origPath;
              if (this.args.file) this.args.file = origPath;
              if (this.args.filePath) this.args.filePath = origPath;
              if (this.args.source) this.args.source = origPath;
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
        
        // Patch updateDisplay for new look
        CompactionSummaryMessageComponent.prototype.updateDisplay = function () {
          this.clear();
          
          const tokenStr = this.message.tokensBefore.toLocaleString();
          const hint = DIM_GREY + " (ctrl+o to expand)" + "\x1b[39m";
          
          if (this.expanded) {
            // Use Markdown for proper word wrap and formatting
            const header = `**Compacted from ${tokenStr} tokens**\n\n`;
            this.addChild(new Markdown(header + this.message.summary, 0, 0, getMarkdownTheme(), {
              color: (text: string) => `${DIM_GREY}${text}\x1b[39m`,
            }));
          } else {
            // Collapsed view - centered
            const message = "\u273b Compacted from " + tokenStr + " tokens" + hint;
            const padding = Math.max(0, Math.floor((60 - message.length) / 2));
            const centered = " ".repeat(padding) + message;
            this.addChild(new Text(centered, 0, 0));
          }
        };
        
        // Patch render to remove background (Box adds customMessageBg background)
        const origRender = CompactionSummaryMessageComponent.prototype.render;
        CompactionSummaryMessageComponent.prototype.render = function (width: number) {
          const lines = origRender.call(this, width);
          // Strip background ANSI codes (48;2;r;g;b or 40-47 range)
          return lines.map((line: string) => {
            // Remove 48;2;r;g;b background sequences
            let cleaned = line.replace(/\x1b\[48;2;\d+;\d+;\d+m/g, "");
            // Also remove standard background colors (40-47, 100-107)
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
      
      // Check for JSON leak patterns
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

  // ── Tool: Read ──────────────────────────────────────────────────────
  const cwd = process.cwd();
  const originalRead = createReadTool(cwd);
  pi.registerTool({
    name: "read",
    label: "read",
    description: originalRead.description,
    parameters: originalRead.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      const t0 = Date.now();
      return captureResult(
        await originalRead.execute(toolCallId, params, signal, onUpdate),
        Date.now() - t0
      );
    },
    renderCall(args, theme, context) {
      if (context.expanded) return noOp();
      return compactCall("read", args.path ?? "?", theme);
    },
    renderResult(result, { expanded }, theme, context) {
      const details = result.details as Record<string, unknown> | undefined;
      const full =
        (details?._fullOutput as string) || result.content?.[0]?.text || "";
      const lines = full.split("\n");
      const lineCount = lines.length;

      if (!expanded) {
        if (result.isError) return compactFailed(theme);
        return compactSummary(theme, "Read", lineCount, "line");
      }

      const filePath = context.args.path ?? "?";
      const offset = (context.args.offset as number) || 1;
      const endLine = offset + lineCount - 1;
      const label =
        lineCount > 0 ? `${offset}-${endLine}, ${filePath}` : filePath;

      const numberedLines = lines.map((line: string, i: number) => {
        const num = String(offset + i).padStart(4, " ");
        return `${DIM_GREY}${num}\x1b[39m  ${line}`;
      });

      return expandedBox(theme, "read", label, numberedLines, 40, "lines in file");
    },
  });

  // ── Tool: Write ─────────────────────────────────────────────────────
  const originalWrite = createWriteTool(cwd);
  pi.registerTool({
    name: "write",
    label: "write",
    description: originalWrite.description,
    parameters: originalWrite.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      const t0 = Date.now();
      return captureResult(
        await originalWrite.execute(toolCallId, params, signal, onUpdate),
        Date.now() - t0
      );
    },
    renderCall(args, theme, context) {
      if (context.expanded) return noOp();
      return compactCall("write", args.path ?? "?", theme);
    },
    renderResult(result, { expanded }, theme, context) {
      const details = result.details as Record<string, unknown> | undefined;
      const full =
        (details?._fullOutput as string) || result.content?.[0]?.text || "";
      const lines = full.split("\n");
      const lineCount = lines.length;

      if (!expanded) {
        if (result.isError) return compactFailed(theme);
        return compactSummary(theme, "Written", lineCount, "line", full);
      }

      const filePath = context.args.path ?? "?";

      const numberedLines = lines.map((line: string, i: number) => {
        const num = String(i + 1).padStart(4, " ");
        return `${DIM_GREY}${num}\x1b[39m  ${line}`;
      });

      return expandedBox(theme, "write", filePath, numberedLines, 40);
    },
  });

  // ── Tool: Edit ──────────────────────────────────────────────────────
  const originalEdit = createEditTool(cwd);
  pi.registerTool({
    name: "edit",
    label: "edit",
    description: originalEdit.description,
    parameters: originalEdit.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      const t0 = Date.now();
      const result = await originalEdit.execute(
        toolCallId,
        params,
        signal,
        onUpdate
      );
      const durationMs = Date.now() - t0;
      const diff = (result.details as Record<string, unknown>)?.diff as
        | string
        | undefined;
      const fullText = diff || result.content?.[0]?.text || "";
      return {
        ...result,
        details: {
          ...result.details,
          _fullOutput: fullText,
          _durationS: durationMs / 1000,
        },
      };
    },
    renderCall(args, theme, context) {
      if (context.expanded) return noOp();
      return compactCall("edit", args.path ?? "?", theme);
    },
    renderResult(result, { expanded }, theme, context) {
      const details = result.details as EditToolDetails | undefined;
      const diffLines = details?.diff?.split("\n");

      if (!expanded) {
        if (result.isError) return compactFailed(theme);
        if (!diffLines || diffLines.length === 0) return noOp();
        // Count added/removed lines from diff (exclude hunk headers +++/---)
        let added = 0;
        let removed = 0;
        for (const dl of diffLines) {
          if (dl.startsWith("+") && !dl.startsWith("+++")) added++;
          if (dl.startsWith("-") && !dl.startsWith("---")) removed++;
        }
        let summary = "";
        if (added > 0) summary += `Added ${added} line${added !== 1 ? "s" : ""}`;
        if (added > 0 && removed > 0) summary += ", ";
        if (removed > 0) summary += `removed ${removed} line${removed !== 1 ? "s" : ""}`;
        if (!summary) summary = "no changes";
        
        // Show first 8 lines of diff with proper coloring
        const PREVIEW_LINES = 8;
        const previewLines = diffLines.slice(0, PREVIEW_LINES);
        const remaining = diffLines.length > PREVIEW_LINES ? diffLines.length - PREVIEW_LINES : 0;
        
        // Create colored diff lines using existing colorizeDiffLine
        const coloredDiffLines: string[] = previewLines.map(dl => colorizeDiffLine(theme, dl));
        
        // Build preview component with wrapping
        const previewComponent: Component = {
          render(width: number) {
            const result: string[] = [];
            // Summary line
            result.push(INDENT + DIM_GREY + "\u23bf " + summary + "\x1b[39m");
            // Diff lines: prepend INDENT to match the ⎿ summary line above.
            for (const coloredLine of coloredDiffLines) {
              const innerWidth = Math.max(10, width - INDENT.length);
              const wrapped = wrapDiffLine(coloredLine, innerWidth);
              for (const wrappedLine of wrapped) {
                result.push(INDENT + wrappedLine);
              }
            }
            // Truncation message
            if (remaining > 0) {
              result.push(INDENT + "  " + DIM_GREY + "... " + remaining + " more lines (ctrl+o to expand)\x1b[39m");
            }
            return result;
          },
          invalidate() {},
        };
        
        return previewComponent;
      }

      if (!diffLines || diffLines.length === 0) return noOp();

      return diffExpandedBox(
        theme,
        "edit",
        context.args.path ?? "",
        diffLines,
        50
      );
    },
  });

  // ── Tool: Bash ──────────────────────────────────────────────────────
  const originalBash = createBashTool(cwd);
  pi.registerTool({
    name: "bash",
    label: "bash",
    description: originalBash.description,
    parameters: originalBash.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      const t0 = Date.now();
      return captureResult(
        await originalBash.execute(toolCallId, params, signal, onUpdate),
        Date.now() - t0
      );
    },
    renderCall(args, theme, context) {
      if (context.expanded) return noOp();
      return compactCall("bash", args.command ?? "?", theme);
    },
    renderResult(result, { expanded }, theme, context) {
      const details = result.details as Record<string, unknown> | undefined;
      const full =
        (details?._fullOutput as string) || result.content?.[0]?.text || "";
      const lines = full.split("\n");

      if (!expanded) {
        if (result.isError) return compactFailed(theme);
        return compactSummary(theme, "Output", lines.length, "line", full);
      }

      const cmd =
        context.args.command || (details?.command as string) || "";
      return expandedBox(theme, "bash", cmd, lines, 40);
    },
  });

  // ── Tool: Ls ────────────────────────────────────────────────────────
  const originalLs = createLsTool(cwd);
  pi.registerTool({
    name: "ls",
    label: "ls",
    description: originalLs.description,
    parameters: originalLs.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      const t0 = Date.now();
      return captureResult(
        await originalLs.execute(toolCallId, params, signal, onUpdate),
        Date.now() - t0
      );
    },
    renderCall(args, theme, context) {
      if (context.expanded) return noOp();
      return compactCall("ls", args.path || ".", theme);
    },
    renderResult(result, { expanded }, theme, context) {
      const details = result.details as Record<string, unknown> | undefined;
      const full =
        (details?._fullOutput as string) || result.content?.[0]?.text || "";
      const lines = full.split("\n").filter((l: string) => l.trim());

      if (!expanded) {
        if (result.isError) return compactFailed(theme);
        return compactSummary(theme, "Listed", lines.length, "entry", full);
      }

      return expandedBox(theme, "ls", context.args.path || ".", lines, 40);
    },
  });

  // ── Tool: Grep ──────────────────────────────────────────────────────
  const originalGrep = createGrepTool(cwd);
  pi.registerTool({
    name: "grep",
    label: "grep",
    description: originalGrep.description,
    parameters: originalGrep.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      const t0 = Date.now();
      return captureResult(
        await originalGrep.execute(toolCallId, params, signal, onUpdate),
        Date.now() - t0
      );
    },
    renderCall(args, theme, context) {
      if (context.expanded) return noOp();
      return compactCall("grep", args.pattern ?? "?", theme);
    },
    renderResult(result, { expanded }, theme, context) {
      const details = result.details as Record<string, unknown> | undefined;
      const full =
        (details?._fullOutput as string) || result.content?.[0]?.text || "";
      const lines = full.split("\n").filter((l: string) => l.trim());

      if (!expanded) {
        if (result.isError) return compactFailed(theme);
        return compactSummary(theme, "Found", lines.length, "match", full);
      }

      return expandedBox(theme, "grep", context.args.pattern ?? "?", lines, 40);
    },
  });

  // ── Tool: Find ──────────────────────────────────────────────────────
  const originalFind = createFindTool(cwd);
  pi.registerTool({
    name: "find",
    label: "find",
    description: originalFind.description,
    parameters: originalFind.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      const t0 = Date.now();
      return captureResult(
        await originalFind.execute(toolCallId, params, signal, onUpdate),
        Date.now() - t0
      );
    },
    renderCall(args, theme, context) {
      if (context.expanded) return noOp();
      return compactCall(
        "find",
        (args.pattern ?? "?") + (args.path ? " " + args.path : ""),
        theme
      );
    },
    renderResult(result, { expanded }, theme, context) {
      const details = result.details as Record<string, unknown> | undefined;
      const full =
        (details?._fullOutput as string) || result.content?.[0]?.text || "";
      const lines = full.split("\n").filter((l: string) => l.trim());

      if (!expanded) {
        if (result.isError) return compactFailed(theme);
        return compactSummary(theme, "Found", lines.length, "file", full);
      }

      return expandedBox(
        theme,
        "find",
        (context.args.pattern ?? "?") +
          (context.args.path ? " " + context.args.path : ""),
        lines,
        40
      );
    },
  });

  // ── Patch renderWidgetContainer: remove leading spacer above widgets ──
  // InteractiveMode.renderWidgetContainer() unconditionally adds a Spacer(1)
  // before any aboveEditor widgets when leadingSpacer=true, producing a blank
  // line between the spinner and the todo overlay. We patch it to skip that
  // spacer so the todos sit flush against the spinner.
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
      // Suppress the leading spacer — it creates a blank gap between the
      // spinner/working-message and the aboveEditor widget (e.g. todos).
      return originalRenderWidgetContainer.call(this, container, widgets, spacerWhenEmpty, false);
    };
    (InteractiveMode.prototype.renderWidgetContainer as any).__compactui_patched = true;
  }

  // ── Initialize UI Features ──────────────────────────────────────────
  initAssistantFooter(pi);
  initPromptUi();
  initToolStatusDot();

  // ── Patch showStatus: auto-dismiss status notifications after 3s ──
  // Methods like toggleThinkingBlockVisibility call showStatus() which adds
  // a one-shot notification line to the chat (e.g. "Thinking blocks: hidden").
  // We patch it to auto-remove the notification after 3 seconds.
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
