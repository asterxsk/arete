/**
 * prompt-ui.ts — User message prompt styling
 *
 * Patches UserMessageComponent.render to add a dark background,
 * " ❯ " prefix, and proper padding for user input display.
 */

import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const PROMPT_PATCH = Symbol.for("pi-agent:patched-prompt");

export function initPromptUi(): void {
  const userMsgProto = UserMessageComponent.prototype as any;
  if (userMsgProto[PROMPT_PATCH]) return;

  const originalRender = userMsgProto.render;
  // Find and disable the Box child's bg and padding
  function getBoxChild(instance: any): any {
    for (const child of instance.children || []) {
      if (child.constructor?.name === "Box") return child;
    }
    return null;
  }

  userMsgProto.render = function (width: number) {
    const isAutocomplete = typeof this.text === "string" && (this.text.startsWith("→ ") || this.text.startsWith("  "));

    const targetWidth = isAutocomplete ? width : Math.max(1, width - 3);
    const box = getBoxChild(this);
    if (box) {
      box.bgFn = null;
      box.paddingY = 0;
      box.paddingX = 0;
      box.invalidateCache?.();
    }

    const bg = "\x1b[48;2;58;58;58m";
    const resetBg = "\x1b[49m";
    const prefix = " \u276f ";
    const prefixW = visibleWidth(prefix);
    const lines = originalRender.call(this, isAutocomplete ? width : Math.max(1, targetWidth - prefixW));
    if (!Array.isArray(lines) || lines.length === 0) return lines;

    if (isAutocomplete) {
      return lines;
    }

    // Remove all empty padding lines
    const contentLines = lines.filter((l: string) => l !== "");
    if (contentLines.length === 0) {
      const pad = " ".repeat(Math.max(0, targetWidth));
      return [truncateToWidth(bg + prefix + pad + resetBg, width)];
    }

    // Render all content lines with bg; first gets prefix, rest get indent
    const indent = " ".repeat(prefixW);
    return contentLines.map((lineText: string, i: number) => {
      const pfx = i === 0 ? prefix : indent;
      const visLen = prefixW + visibleWidth(lineText);
      const padding = " ".repeat(Math.max(0, targetWidth - visLen));
      return truncateToWidth(bg + pfx + lineText + padding + resetBg, width);
    });
  };
  userMsgProto[PROMPT_PATCH] = true;
  (userMsgProto.render as any).__compactui_spacer_patched = true;
}
