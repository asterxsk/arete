// bar editor — replaces the default pi editor with a boxed one:
// ╭─────────────────────╮
// │ ❯ content...        │
// ╰─────────────────────╯
// Top border has "━" sweep during agent turn (2x speed, sinusoidal easing,
// slower at corners). White ┃ side borders, white ╭╮╰╯ corners/bottom, grey ❯ prompt.
// Spinner is suppressed during agent turn. No ↑↑ indicator.

import {
  CustomEditor,
  type ExtensionAPI,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

const RESET = "\x1b[0m";
const GREY_S = "\x1b[38;2;140;140;140m";
const FG_S = "\x1b[38;2;255;255;255m";

const TICK_MS = 60;
const BLINK_PERIOD_TICKS = 20; // ~1.2s full fade-in/fade-out cycle
const BLINK_POS = 2;
const BLINK_LEN = 2; // width of the blinker in dash cells

// ── Module-level animation state (shared with turn-status lifecycle) ──

let isAnimating = false;
let animPosition = 0;
let blinkPhase = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let editorInstance: BoxedEditor | null = null;
let currentCtx: any = null;
let requestRenderFn: (() => void) | null = null;

/** Color for the blinker at intensity t (0..1): lerps from border grey
 *  (t=0, blends into the dashes) to full red (t=1) for a smooth fade. */
function redAt(t: number): string {
  const r = Math.round(140 + (255 - 140) * t);
  const g = Math.round(140 * (1 - t));
  const b = Math.round(140 * (1 - t));
  return `\x1b[38;2;${r};${g};${b}m`;
}

// ── Helpers ──────────────────────────────────────────────────────────

// ── BoxedEditor ───────────────────────────────────────────────────────

export class BoxedEditor extends CustomEditor {
  /** Find the index of the bottom border line — last line that's all dashes when stripped. */
  private findBottomBorderIdx(lines: string[]): number {
    for (let i = lines.length - 1; i >= 0; i--) {
      const stripped = lines[i].replace(/\x1b\[[0-9;]*m/g, "");
      if (/^[\u2500 \d\u2191\u2193more]+$/.test(stripped.trim())) {
        return i;
      }
    }
    return lines.length - 1;
  }

  /** Prefix a content line with left ┃, preserving existing ANSI formatting. */
  private leftBorder(content: string): string {
    return `${FG_S}\u2502${RESET}${content}`;
  }

  /** Append right ┃ after content, padding with spaces to fill inner width. */
  private rightBorder(content: string, inner: number): string {
    // visibleWidth strips ANSI internally
    const contentWidth = visibleWidth(content);
    const pad = " ".repeat(Math.max(0, inner - contentWidth));
    return `${content}${pad}${FG_S}\u2502${RESET}`;
  }

  /** Wrap a content line in ┃ ... ┃, recoloring plain text to white. */
  private boxContentLine(line: string, inner: number): string {
    const colored = `${FG_S}${line}`.replace(/\x1b\[0m/g, `\x1b[0m${FG_S}`);
    return this.rightBorder(this.leftBorder(colored), inner);
  }

  render(width: number): string[] {
    const innerWidth = Math.max(0, width - 2);
    const lines = super.render(innerWidth);
    if (lines.length < 2) return lines;

    const borderColor = (text: string) => this.borderColor(text);
    const bottomIdx = this.findBottomBorderIdx(lines);
    const inner = Math.max(0, width - 2);
    const prompt = "\u276f";

    // ── Top border ──────────────────────────────────────────────────
    if (isAnimating) {
      // Build exactly `inner` dash cells, with a smooth-fading red blinker of
      // BLINK_LEN cells at BLINK_POS (3rd dash from left, counting corner as 0).
      const intensity = (Math.sin(blinkPhase) + 1) / 2; // 0..1, eased in/out
      const blinker = redAt(intensity);
      let dashes = "";
      for (let c = 0; c < inner; c++) {
        if (c >= BLINK_POS && c < BLINK_POS + BLINK_LEN) {
          dashes += `${blinker}\u2501${FG_S}`;
        } else {
          dashes += "\u2500";
        }
      }
      lines[0] = `${FG_S}\u256d${dashes}\u256e${RESET}`;
    } else {
      lines[0] = `${FG_S}\u256d${borderColor("\u2500".repeat(Math.max(0, width - 2)))}${FG_S}\u256e${RESET}`;
    }

    // ── Content lines ───────────────────────────────────────────────
    // Base editor (paddingX=0) renders NO side borders: top/bottom are full
    // "─" lines and middle lines are "leftPadding + displayText + pad + rightPadding".
    // We wrap middle lines with "│", injecting the "❯" prompt on the first line.
    // The base already pads text to innerWidth, so we only add the side rails
    // and replace the left margin with the prompt — preserving all ANSI
    // (cursor reverse-video, text color) from the original displayText.
    for (let i = 1; i <= bottomIdx; i++) {
      const raw = lines[i] || "";
      if (i === 1) {
        // Strip exactly one leading space the base reserves for the cursor,
        // then inject "❯ " as the prompt. Keep the rest (text + cursor) verbatim.
        const stripped = raw.replace(/^ /, "");
        const promptPrefix = `${FG_S}\u2502${RESET}${GREY_S} ${prompt} `;
        // Force white text: prepend white, and re-apply white after every ANSI
        // reset (e.g. the cursor's \x1b[0m) so trailing text stays white too.
        const colored = `${FG_S}${stripped}`.replace(/\x1b\[0m/g, `\x1b[0m${FG_S}`);
        const body = truncateToWidth(`${promptPrefix}${colored}`, width - 1, "", false);
        lines[i] = `${body}${FG_S}\u2502${RESET}`;
      } else {
        const wrapped = this.boxContentLine(raw, inner);
        lines[i] = truncateToWidth(wrapped, width, "");
      }
    }

    // ── Bottom border ───────────────────────────────────────────────
    lines[bottomIdx] = `${FG_S}\u2570${"\u2500".repeat(inner)}\u256f${RESET}`;

    // Lines after bottomIdx (autocomplete dropdown) are left untouched
    return lines;
  }
}

// ── Animation lifecycle ──────────────────────────────────────────────

function tick(): void {
  if (!isAnimating) return;
  blinkPhase += (2 * Math.PI) / BLINK_PERIOD_TICKS;
  if (blinkPhase > 2 * Math.PI) blinkPhase -= 2 * Math.PI;
  editorInstance?.invalidate();
  requestRenderFn?.();
}

function startAnimation(ctx: any): void {
  isAnimating = true;
  animPosition = 0;

  // Hide default spinner
  ctx.ui.setWorkingIndicator({ frames: [] });
  ctx.ui.setWorkingMessage(undefined);
  ctx.ui.setWorkingVisible(false);

  editorInstance?.invalidate();
  requestRenderFn?.();

  if (intervalId === null) {
    intervalId = setInterval(tick, TICK_MS);
  }
}

function stopAnimation(): void {
  isAnimating = false;
  animPosition = 0;

  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }

  if (currentCtx?.hasUI) {
    currentCtx.ui.setWorkingIndicator(undefined);
    currentCtx.ui.setWorkingMessage(undefined);
    currentCtx.ui.setWorkingVisible(true);
  }

  editorInstance?.invalidate();
  requestRenderFn?.();
}

function cleanup(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (currentCtx?.hasUI) {
    currentCtx.ui.setWorkingIndicator(undefined);
    currentCtx.ui.setWorkingMessage(undefined);
    currentCtx.ui.setWorkingVisible(true);
  }
  isAnimating = false;
  animPosition = 0;
  editorInstance = null;
  currentCtx = null;
  requestRenderFn = null;
}

// ── Registration ─────────────────────────────────────────────────────

export function registerBar(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event: any, ctx: any) => {
    currentCtx = ctx;

    if (ctx.hasUI) {
      // Replace the default editor with BoxedEditor
      ctx.ui.setEditorComponent((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
        const editor = new BoxedEditor(tui, theme, keybindings);
        editorInstance = editor;
        // Capture requestRender from the TUI
        requestRenderFn = () => tui.requestRender();
        return editor;
      });

      // Suppress default working messages while animation is active
      const origSetWorkingMessage = ctx.ui.setWorkingMessage;
      ctx.ui.setWorkingMessage = function (this: any, msg: string | undefined) {
        if (isAnimating) return;
        return origSetWorkingMessage.apply(this, arguments as any);
      };
    }
  });

  pi.on("before_agent_start", async (_event: any, ctx: any) => {
    if (ctx) currentCtx = ctx;
    if (currentCtx?.hasUI) {
      startAnimation(currentCtx);
    }
  });

  pi.on("agent_end", async () => {
    stopAnimation();
  });

  pi.on("turn_start", async (_event: any, ctx: any) => {
    if (ctx) currentCtx = ctx;
  });

  pi.on("session_shutdown", () => {
    cleanup();
  });
}
