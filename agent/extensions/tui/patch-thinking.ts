// patch-thinking.ts — monkey-patch AssistantMessageComponent.updateContent
// to use ThinkingComponent for thinking blocks instead of native italic Markdown.

import { ThinkingComponent } from "./thinking";
import { Markdown, Text, Spacer } from "@earendil-works/pi-tui";
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";

let patched = false;

export function patchThinkingRendering(): void {
  if (patched) return;
  if (!AssistantMessageComponent?.prototype?.updateContent) return;
  if ((AssistantMessageComponent.prototype.updateContent as any).__thinkingPatched) return;

  // Fallback colors — theme access is module-internal to pi-coding-agent
  const THINKING_GREY = "\x1b[38;2;140;140;140m";
  const ITALIC = "\x1b[3m";
  const RESET_ALL = "\x1b[0m";
  const ERROR_COLOR = "\x1b[38;2;255;85;85m";

  AssistantMessageComponent.prototype.updateContent = function (message: any) {
    this.lastMessage = message;
    this.contentContainer.clear();

    const hasVisibleContent = message.content.some(
      (c: any) =>
        (c.type === "text" && c.text?.trim()) || (c.type === "thinking" && c.thinking?.trim()),
    );
    if (hasVisibleContent) {
      this.contentContainer.addChild(new Spacer(1));
    }

    for (let i = 0; i < message.content.length; i++) {
      const content = message.content[i];
      if (content.type === "text" && content.text?.trim()) {
        this.contentContainer.addChild(
          new Markdown(content.text.trim(), this.outputPad, 0, this.markdownTheme),
        );
      } else if (content.type === "thinking" && content.thinking?.trim()) {
        const hasVisibleContentAfter = message.content
          .slice(i + 1)
          .some(
            (c: any) =>
              (c.type === "text" && c.text?.trim()) ||
              (c.type === "thinking" && c.thinking?.trim()),
          );

        if (this.hideThinkingBlock) {
          // Show static thinking label when hidden (grey + italic, like native)
          this.contentContainer.addChild(
            new Text(
              `${THINKING_GREY}${ITALIC}${this.hiddenThinkingLabel}${RESET_ALL}`,
              this.outputPad,
              0,
            ),
          );
        } else {
          // Use ThinkingComponent with ┃ prefix instead of native italic Markdown
          this.contentContainer.addChild(
            new ThinkingComponent(content.thinking.trim(), this.markdownTheme, this.outputPad),
          );
        }

        if (hasVisibleContentAfter) {
          this.contentContainer.addChild(new Spacer(1));
        }
      }
    }

    // Handle stop reasons — same as native
    const hasToolCalls = message.content.some(
      (c: any) => c.type === "toolCall" || c.type === "tool_use",
    );
    this.hasToolCalls = hasToolCalls;

    if (message.stopReason === "length") {
      this.contentContainer.addChild(new Spacer(1));
      this.contentContainer.addChild(
        new Text(
          `${ERROR_COLOR}Error: Model stopped because it reached the maximum output token limit. The response may be incomplete.${RESET_ALL}`,
          this.outputPad,
          0,
        ),
      );
    } else if (!hasToolCalls) {
      if (message.stopReason === "aborted") {
        const abortMessage =
          message.errorMessage && message.errorMessage !== "Request was aborted"
            ? message.errorMessage
            : "Operation aborted";
        this.contentContainer.addChild(new Spacer(1));
        this.contentContainer.addChild(
          new Text(`${ERROR_COLOR}${abortMessage}${RESET_ALL}`, this.outputPad, 0),
        );
      } else if (message.stopReason === "error") {
        const errorMsg = message.errorMessage || "Unknown error";
        this.contentContainer.addChild(new Spacer(1));
        this.contentContainer.addChild(
          new Text(`${ERROR_COLOR}Error: ${errorMsg}${RESET_ALL}`, this.outputPad, 0),
        );
      }
    }
  };

  (AssistantMessageComponent.prototype.updateContent as any).__thinkingPatched = true;
  patched = true;
}
