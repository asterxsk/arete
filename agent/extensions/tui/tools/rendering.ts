// tui/tools/rendering.ts — Shared rendering primitives for per-tool renderers.
//
// Each primitive returns a pi-tui `Component` ({ render(width): string[], invalidate() })
// so it can be composed with `group()` and embedded in the unified tool format used by
// tools/{read,write,edit,bash,ls,grep,find,powershell}.ts and tools/patch-tools.ts.
//
// Mirrors the shape of agent/extensions/archived/compactui/rendering.ts but uses theme
// tokens (toolTitle, muted, toolDiffAdded, toolDiffRemoved, toolDiffContext, border,
// toolSuccessBg, toolErrorBg) so the colors track the active arete theme.

import { type Component, truncateToWidth } from "@earendil-works/pi-tui";

// Dim grey used for the truncation hint, matching the rest of the UI.
const DIM_GREY = "\x1b[38;2;140;140;140m";

// ── Helpers ─────────────────────────────────────────────────────────────

/** Wrap a lazy render fn in a Component. */
function component(renderFn: (width: number) => string[]): Component {
  return {
    render(width: number): string[] {
      try {
        return renderFn(width);
      } catch (e: any) {
        return [`\x1b[31mError rendering: ${e?.message ?? e}\x1b[39m`];
      }
    },
    invalidate() {},
  };
}

/** Single-line component from a (theme-resolved) ANSI string. */
function line(text: string): Component {
  return component((width: number) => [truncateToWidth(text, width, "...")]);
}

// ── Tool glow label ─────────────────────────────────────────────────────
//
// Glow label: greyish-white bold tool title line. Used as the collapsed header
// for every tool. `args` (when provided) is appended in a dimmer muted style.

export function glowLabel(theme: any, toolName: string, args?: string): Component {
  const label =
    theme.fg("toolTitle", theme.bold(toolName)) + (args ? theme.fg("muted", " " + args) : "");
  return line(label);
}

// ── Output arrow summary line ───────────────────────────────────────────
//
// `↳ <label>` line in the muted color, e.g. "↳ 5 lines".

export function outputArrowLine(theme: any, label: string, lineCount?: number): Component {
  const summary = lineCount !== undefined ? `${label} (${lineCount})` : label;
  return line(theme.fg("muted", `↳ ${summary}`));
}

// ── Diff line ───────────────────────────────────────────────────────────
//
// Colorizes a single diff line:
//   '+' added   → toolDiffAdded fg + translucent toolSuccessBg bg
//   '-' removed → toolDiffRemoved fg + translucent toolErrorBg bg
//   otherwise   → toolDiffContext fg (context lines)

export function diffLine(theme: any, raw: string): Component {
  return line(colorizeDiffLine(theme, raw));
}

function colorizeDiffLine(theme: any, raw: string): string {
  if (raw.startsWith("+")) {
    return theme.bg("toolSuccessBg", theme.fg("toolDiffAdded", raw));
  }
  if (raw.startsWith("-")) {
    return theme.bg("toolErrorBg", theme.fg("toolDiffRemoved", raw));
  }
  return theme.fg("toolDiffContext", raw);
}

// ── Separator ───────────────────────────────────────────────────────────
//
// Full-width `─` dash line in the border color.

export function separator(theme: any, width: number): Component {
  const w = Math.max(0, width);
  return line(theme.fg("border", "─".repeat(w)));
}

// ── Truncation ──────────────────────────────────────────────────────────
//
// Collapse a list of already-rendered lines to `max` lines, appending a
// '… (K more lines, ctrl+o to expand)' hint line when overflow occurs.

export function truncate(lines: string[], max: number): Component {
  return component((_width: number) => {
    if (lines.length <= max) return lines;
    const shown = lines.slice(0, max);
    const remaining = lines.length - max;
    const hint = `${DIM_GREY}… (${remaining} more lines, ctrl+o to expand)\x1b[39m`;
    return [...shown, hint];
  });
}

// ── Group ───────────────────────────────────────────────────────────────
//
// Vertical stack of components (renders each in sequence). Used by per-tool
// renderers to compose glowLabel + outputArrowLine + separator.

export function group(children: Component[]): Component {
  return component((width: number) => children.flatMap((c) => c.render(width)));
}
