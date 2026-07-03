/**
 * tool-status-dot.ts — Animated status dot for running tools
 *
 * Shows a blinking green dot for in-progress tool calls, a solid green
 * dot for completed calls, and a red dot for errors.
 */

import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const DOT_PATCH = Symbol.for("pi-agent:patched-dot");
const RESET = "\x1b[0m";
const SUCCESS = "\x1b[32m";
const ERROR = "\x1b[31m";
const MUTED = "\x1b[90m";
const BLINK_MS = 500;
const MAX_BLINKING = 5;

let blinkPhase = true;
let blinkTimer: ReturnType<typeof setTimeout> | null = null;
const contexts = new Map<any, { order: number; invalidate: () => void }>();
let orderCounter = 0;

function getKey(ctx: any): any {
  return ctx?.state ?? ctx;
}

function activeKeys(): any[] {
  return [...contexts.entries()]
    .sort((a, b) => b[1].order - a[1].order)
    .slice(0, MAX_BLINKING)
    .map(([key]) => key);
}

function scheduleBlinkTimer(): void {
  if (blinkTimer || contexts.size === 0) return;
  blinkTimer = setTimeout(() => {
    blinkTimer = null;
    blinkPhase = !blinkPhase;
    for (const key of activeKeys()) {
      const entry = contexts.get(key);
      try { entry?.invalidate(); } catch {}
    }
    scheduleBlinkTimer();
  }, BLINK_MS);
}

export function statusDot(ctx: any, isPartial: boolean, isError: boolean): string {
  if (!isPartial && !isError) return `${SUCCESS}\u25cf${RESET} `;
  if (!isPartial && isError) return `${ERROR}\u25cf${RESET} `;

  const key = getKey(ctx);
  const invalidate = typeof ctx?.invalidate === "function" ? () => ctx.invalidate() : () => {};

  if (!contexts.has(key)) {
    contexts.set(key, { order: ++orderCounter, invalidate });
    scheduleBlinkTimer();
  } else {
    contexts.get(key)!.invalidate = invalidate;
  }

  const isActive = activeKeys().includes(key);
  if (!isActive) return `${MUTED}\u25cb${RESET} `;
  return blinkPhase ? `${SUCCESS}\u25cf${RESET} ` : `${MUTED}\u25cb${RESET} `;
}

export function initToolStatusDot(): void {
  const proto = ToolExecutionComponent.prototype as any;
  if (proto[DOT_PATCH]) return;
  const originalRender = proto.render;

  if (typeof originalRender !== "function") return;

  proto.render = function (width: number): string[] {
    const lines: string[] = originalRender.call(this, Math.max(1, width - 2));
    if (!Array.isArray(lines) || lines.length === 0) return lines;

    const ctx = this;
    // Determine error state: check component flag, result flag, and empty output
    const resultIsError = !!(ctx.result?.isError);
    const resultIsEmpty = !ctx.isPartial && ctx.result &&
      !(ctx.result.content?.[0]?.text?.trim());
    const isError = !!(ctx.isError) || resultIsError || resultIsEmpty;
    const dot = statusDot(ctx, !!ctx.isPartial, isError);

    let found = false;
    for (let i = 0; i < lines.length; i++) {
        if (!found) {
            if (lines[i].trim().length > 0) {
                let raw = lines[i];
                if (raw.startsWith(" ")) raw = raw.substring(1);
                lines[i] = " " + dot.trim() + " " + raw;
                found = true;
            } else if (lines[i] !== "") {
                // preserve intentional empty spacing lines, only indent non-empty padding
                lines[i] = "  " + lines[i];
            }
        } else {
            lines[i] = "  " + lines[i];
        }
    }
    if (!found && lines.length > 0) {
        let raw = lines[0];
        if (raw.startsWith(" ")) raw = raw.substring(1);
        lines[0] = " " + dot.trim() + " " + raw;
    }

    if (!ctx.isPartial) {
      const key = getKey(ctx);
      if (contexts.has(key)) {
        contexts.delete(key);
        if (contexts.size === 0 && blinkTimer) {
          clearTimeout(blinkTimer);
          blinkTimer = null;
        }
      }
    }

    return width !== undefined ? lines.map(l => typeof l === "string" ? truncateToWidth(l, width) : l) : lines;
  };

  proto[DOT_PATCH] = true;
  (proto.render as any).__compactui_spacer_patched = true;
}
