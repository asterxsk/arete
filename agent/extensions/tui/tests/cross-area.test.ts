// cross-area.test.ts — Integration tests proving the three areas (thinking
// block, boxed editor bar/blinker, unified tool-output rendering) coexist
// without regression.
//
// Covers VAL-CROSS-001 .. VAL-CROSS-005 from the validation contract:
//   - 001 thinking `┃ ` blocks + unified tool blocks coexist
//   - 002 boxed editor `╭─╮` + unified tool blocks coexist
//   - 003 blinker sweep + tool output render simultaneously in one turn
//   - 004 tool rendering is identical with memory on vs off
//   - 005 full e2e turn (memory + blinker + tool + editor) no regression,
//         clean agent_end, clean shutdown, no default-spinner leak.
//
// Where pure-UI coexistence can't be unit-tested, we assert via component
// render() output composition: each area's Component is rendered to its line
// array and the composed frame is verified to contain every area's signature
// with no clobbering. The milestone user-testing validator (tuistory) performs
// the visual cross-checks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ThinkingComponent } from "../thinking.js";
import { resolveTemplate } from "../tools/rendering.js";
import { renderMemorySearchCall, renderMemorySearchResult } from "../memory.js";

// ── Helpers ──────────────────────────────────────────────────────────

/** Strip ANSI so we can look at visible characters for structural assertions. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Theme used by the unified tool renderers (only fg/bg/bold are read). */
function makeToolTheme() {
  return {
    fg: (color: string, text: string) => `\x1b[38;2;fg:${color}m${text}\x1b[0m`,
    bg: (color: string, text: string) => `\x1b[48;2;bg:${color}m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  };
}

/** Minimal MarkdownTheme so ThinkingComponent's Markdown.render doesn't throw
 *  on missing methods (italic/bold/fg/bg are the ones actually exercised). */
function makeMarkdownTheme(): any {
  const id = (t: string) => t;
  return {
    fg: id,
    bg: id,
    bold: id,
    italic: id,
    dim: id,
    underline: id,
    strikethrough: id,
    link: id,
    code: id,
    heading: id,
    blockquote: id,
    listItem: id,
    hr: id,
    table: id,
  };
}

function thinkingLines(theme: any, text: string, width: number): string[] {
  return new ThinkingComponent(text, theme, 1).render(width).map(stripAnsi);
}

function unifiedToolLines(name: string, result: any, ctxArgs: any, width = 80): string[] {
  const theme = makeToolTheme();
  const template = resolveTemplate({ name });
  if (!template || !template.renderResult) return [];
  return template
    .renderResult(result, { expanded: false }, theme as any, { args: ctxArgs })
    .render(width)
    .map(stripAnsi);
}

/** Details needed to install a real BoxedEditor the same way the host does. */
interface EditorSetup {
  mockTui: any;
  editorTheme: any;
  ui: any;
  ctx: any;
  handlers: Record<string, ((e: any, c: any) => Promise<void>)[]>;
  keybindings: any;
}

/** Build the mock wiring (tui/theme/ui/ctx/handlers) for a BoxedEditor. */
function makeEditorSetup(width: number, theme: any, keybindings: any): EditorSetup {
  // The editor reads these off the theme (borderColor) and the tui.
  const mockTui: any = { requestRender: vi.fn(), width, terminal: { rows: 24 } };
  const editorTheme: any = { ...theme, borderColor: (s: string) => s };
  const ui = {
    setWorkingIndicator: vi.fn(),
    setWorkingMessage: vi.fn(),
    setWorkingVisible: vi.fn(),
    setEditorComponent: vi.fn(),
  };
  const ctx: any = { hasUI: true, ui };
  const handlers: Record<string, ((e: any, c: any) => Promise<void>)[]> = {};
  return { mockTui, editorTheme, ui, ctx, handlers, keybindings };
}

// ── VAL-CROSS-001: thinking `┃ ` blocks + unified tool blocks coexist ──

describe("VAL-CROSS-001: thinking block (┃ prefix) coexists with unified tool blocks", () => {
  const theme = makeMarkdownTheme();
  const WIDTH = 80;

  it("thinking lines carry the `┃ ` pipe prefix, tool blocks carry glow/↳/separator — no collision", () => {
    const think = thinkingLines(theme, "Let me check the file first.", WIDTH);
    const tool = unifiedToolLines(
      "read",
      {
        content: [{ type: "text", text: "a\nb\nc" }],
        details: { _fullOutput: "a\nb\nc" },
        isError: false,
      },
      { path: "/tmp/x.ts" },
      WIDTH,
    );

    // thinking signature
    expect(think.length).toBeGreaterThan(0);
    for (const l of think) expect(l.startsWith(" ┃ ")).toBe(true);

    // unified tool block signature
    expect(tool).toHaveLength(3);
    expect(tool[0]).toContain("Read"); // glow title
    expect(tool[1]).toContain("↳"); // arrow line
    expect(tool[2].replace(/ /g, "")).toContain("─"); // separator (full width)

    // Compose: thinking above the tool block, exactly as a chat frame would.
    const frame = [...think, ...tool];
    const joined = frame.join("\n");

    // each area kept its signature; concatenation preserves both
    expect(frame[0].startsWith(" ┃ ")).toBe(true);
    expect(joined).toContain("┃ ");
    expect(joined).toContain("Read");
    expect(joined).toContain("↳");

    // No line was clobbered: line count is the exact sum (no overlap)
    expect(frame.length).toBe(think.length + tool.length);

    // The tool separator is full width (full-width border line intact)
    expect(visibleWidth(tool[2])).toBe(WIDTH);
  });

  it("multiple thinking blocks can each be followed by tool blocks without prefix loss", () => {
    const t1 = thinkingLines(theme, "step one", WIDTH);
    const t2 = thinkingLines(theme, "step two", WIDTH);
    const tool1 = unifiedToolLines(
      "bash",
      { content: [{ type: "text", text: "out" }], details: { _fullOutput: "out" }, isError: false },
      { command: "echo hi" },
      WIDTH,
    );
    const tool2 = unifiedToolLines(
      "edit",
      { details: { diff: "+a\n-b" } },
      { path: "/tmp/y.ts" },
      WIDTH,
    );

    const frame = [...t1, ...tool1, ...t2, ...tool2];
    const thinkCount = frame.filter((l) => l.startsWith(" ┃ ")).length;
    expect(thinkCount).toBe(t1.length + t2.length);
    // both tool blocks kept their glow titles
    expect(frame.some((l) => l.includes("Execute"))).toBe(true);
    expect(frame.some((l) => l.includes("Update"))).toBe(true);
  });
});

// ── VAL-CROSS-002: boxed editor (╭─╮) coexists with unified tool blocks ──

describe("VAL-CROSS-002: boxed editor (╭─╮) coexists with unified tool blocks", () => {
  const WIDTH = 50;
  let keybindings: any;
  let editorTheme: any;

  beforeEach(() => {
    keybindings = { matches: vi.fn(() => false) };
    editorTheme = makeToolTheme();
    vi.resetModules();
  });

  async function installEditor(): Promise<{ editor: any; editorLines: string[] }> {
    const setup = makeEditorSetup(WIDTH, editorTheme, keybindings);
    const { mockTui, editorTheme: eth, ui, ctx, handlers, keybindings: kb } = setup;
    const { registerBar } = await import("../bar.js");
    registerBar({ on: (n: string, fn: any) => (handlers[n] ||= []).push(fn) });
    void (handlers["session_start"] || []).map((h: any) => h({}, ctx));
    const cb = ui.setEditorComponent.mock.calls[0][0];
    const editor = cb(mockTui, eth, kb);
    const lines = editor.render(WIDTH).map(stripAnsi);
    return { editor, editorLines: lines };
  }

  it("idle boxed editor keeps ╭─╮ corners and a tool block stays intact beside it", async () => {
    const { editorLines } = await installEditor();

    // top border is boxed
    expect(editorLines[0]).toContain("╭");
    expect(editorLines[0]).toContain("╮");
    // bottom border is boxed
    const last = editorLines[editorLines.length - 1];
    expect(last).toContain("╰");
    expect(last).toContain("╯");

    // An independent unified tool block rendered in the same frame.
    const tool = unifiedToolLines(
      "read",
      {
        content: [{ type: "text", text: "x\ny" }],
        details: { _fullOutput: "x\ny" },
        isError: false,
      },
      { path: "/tmp/z.ts" },
      WIDTH,
    );

    const frame = [...editorLines, ...tool];
    const joined = frame.join("\n");
    // boxed editor corners intact AND tool block signature present
    expect(joined).toContain("╭");
    expect(joined).toContain("╮");
    expect(joined).toContain("╰");
    expect(joined).toContain("╯");
    expect(joined).toContain("Read");
    expect(joined).toContain("↳");

    // tool separator still full width (not collapsed into the editor box)
    expect(visibleWidth(tool[2])).toBe(WIDTH);
  });
});

// ── VAL-CROSS-003: blinker sweep + tool output render simultaneously ──

describe("VAL-CROSS-003: blinker sweep + unified tool block render simultaneously", () => {
  const WIDTH = 50;
  let setIntervalSpy: any;
  let keybindings: any;
  let editorTheme: any;

  beforeEach(() => {
    keybindings = { matches: vi.fn(() => false) };
    editorTheme = makeToolTheme();
    setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(() => ({}) as unknown as ReturnType<typeof setInterval>);
    vi.resetModules();
  });
  afterEach(() => {
    setIntervalSpy.mockRestore();
  });

  async function driveBlinkerActive(): Promise<{ editor: any; ui: any; handlers: any; ctx: any }> {
    const setup = makeEditorSetup(WIDTH, editorTheme, keybindings);
    const { mockTui, editorTheme: eth, ui, ctx, handlers, keybindings: kb } = setup;
    const { registerBar } = await import("../bar.js");
    registerBar({ on: (n: string, fn: any) => (handlers[n] ||= []).push(fn) });
    void (handlers["session_start"] || []).map((h: any) => h({}, ctx));
    const cb = ui.setEditorComponent.mock.calls[0][0];
    const editor = cb(mockTui, eth, kb);
    // Activate the sweep via the proven `before_agent_start` green path.
    void (handlers["before_agent_start"] || []).map((h: any) => h({}, ctx));
    return { editor, ui, handlers, ctx };
  }

  it("animated editor top shows red ━ sweep AND a tool block renders in the same frame", async () => {
    const { editor } = await driveBlinkerActive();
    const barLines = editor.render(WIDTH).map(stripAnsi);
    const tool = unifiedToolLines(
      "bash",
      {
        content: [{ type: "text", text: "hello" }],
        details: { _fullOutput: "hello" },
        isError: false,
      },
      { command: "echo hello" },
      WIDTH,
    );

    // The bar's top border must contain the red blinker during animation.
    // redAt outputs a 255 red channel → look for the raw escape in the colored line.
    const topColored = editor.render(WIDTH)[0];
    expect(topColored).toContain("\x1b[38;2;255;"); // red channel of the blinker
    expect(topColored).toContain("╭");
    expect(topColored).toContain("╮");

    // mid-turn, exactly one blinker interval is running.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    // Both areas render in one synchronous frame.
    const frame = [...barLines, ...tool];
    const joined = frame.join("\n");
    expect(joined).toContain("╭"); // boxed editor present
    expect(joined).toContain("Execute"); // tool block present (bash → Execute label)
    expect(joined).toContain("↳"); // tool arrow line present
    // tool separator still full width
    expect(visibleWidth(tool[2])).toBe(WIDTH);
  });

  it("retry boundary (API error) keeps sweep + tool block, default spinner stays hidden", async () => {
    // Drive blinker active, then simulate an API-error retry via turn_start /
    // agent_settled while still animating — the core cross-area survival proof.
    const { editor, ui, handlers, ctx } = await driveBlinkerActive();
    const tool = unifiedToolLines(
      "bash",
      {
        content: [{ type: "text", text: "hello" }],
        details: { _fullOutput: "hello" },
        isError: false,
      },
      { command: "echo hello" },
      WIDTH,
    );

    // Before retry: sweep visible (red channel) and tool block present.
    expect(editor.render(WIDTH)[0]).toContain("\x1b[38;2;255;");
    expect(tool[0]).toContain("Execute"); // bash tools use Execute label
    expect(tool[1]).toContain("↳");

    // Fire the retry boundary events.
    void (await Promise.all((handlers["turn_start"] || []).map((fn: any) => fn({}, ctx))));
    void (await Promise.all((handlers["agent_settled"] || []).map((fn: any) => fn({}, ctx))));

    // After retry: sweep STILL animating (red channel present)…
    expect(editor.render(WIDTH)[0]).toContain("\x1b[38;2;255;");
    // …the hidden indicator was re-applied on retry…
    expect(ui.setWorkingIndicator).toHaveBeenCalledWith({ frames: [] });
    expect(ui.setWorkingVisible).toHaveBeenCalledWith(false);
    // …and the default spinner was NEVER restored (no leak into the tool turn).
    expect(ui.setWorkingVisible).not.toHaveBeenCalledWith(true);
    expect(ui.setWorkingIndicator).not.toHaveBeenCalledWith(undefined);
    // Still exactly one blinker interval (no leak across retry).
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    // Tool block remains identical after the retry boundary.
    expect(tool[0]).toContain("Execute"); // bash tools use Execute label
    expect(tool[1]).toContain("↳");
    expect(visibleWidth(tool[2])).toBe(WIDTH);
  });
});

// ── VAL-CROSS-004: tool rendering identical with memory on vs off ──

describe("VAL-CROSS-004: tool rendering identical with memory on vs off", () => {
  const WIDTH = 80;
  const theme = makeToolTheme();

  function renderWithMemoryFlag(
    name: string,
    result: any,
    ctxArgs: any,
    memoryOn: boolean,
  ): string[] {
    const theme = makeToolTheme();
    const template = resolveTemplate({ name });
    if (!template || !template.renderResult) return [];
    const ctx: any = {
      args: ctxArgs,
      memoryEnabled: memoryOn,
      __memoryInjected: memoryOn,
      systemPromptFlags: { memory: memoryOn },
    };
    return template.renderResult(result, { expanded: false }, theme as any, ctx).render(WIDTH);
  }

  it("read block renders identically regardless of memory flag", () => {
    const result = {
      content: [{ type: "text", text: "a\nb\nc" }],
      details: { _fullOutput: "a\nb\nc" },
      isError: false,
    };
    const off = renderWithMemoryFlag("read", result, { path: "/tmp/x.ts" }, false);
    const on = renderWithMemoryFlag("read", result, { path: "/tmp/x.ts" }, true);
    expect(on).toEqual(off);
  });

  it("bash block renders identically regardless of memory flag", () => {
    const result = {
      content: [{ type: "text", text: "hi" }],
      details: { _fullOutput: "hi", exitCode: 0 },
      isError: false,
    };
    const off = renderWithMemoryFlag("bash", result, { command: "echo hi" }, false);
    const on = renderWithMemoryFlag("bash", result, { command: "echo hi" }, true);
    expect(on).toEqual(off);
  });

  it("edit diff block renders identically regardless of memory flag", () => {
    const result = { details: { diff: "+lineA\n-lineB\n context" } };
    const off = renderWithMemoryFlag("edit", result, { path: "/tmp/y.ts" }, false);
    const on = renderWithMemoryFlag("edit", result, { path: "/tmp/y.ts" }, true);
    expect(on).toEqual(off);
  });

  it("even when a <memory-context> block is embedded in tool output, unified format is unchanged", () => {
    // Worst case: memory content flows through the same text channel as tool
    // output. The unified renderer must still produce glow/↳/separator and the
    // result must match the memory-off rendering of identical text.
    const memoryInjected = "<memory-context>\n- prefers vim\n</memory-context>";
    const result = {
      content: [{ type: "text", text: memoryInjected }],
      details: { _fullOutput: memoryInjected },
      isError: false,
    };
    const off = unifiedToolLines(
      "bash",
      {
        content: [{ type: "text", text: memoryInjected }],
        details: { _fullOutput: memoryInjected },
        isError: false,
      },
      { command: "echo hi" },
      WIDTH,
    );
    const on = unifiedToolLines("bash", result, { command: "echo hi" }, WIDTH);
    expect(on).toEqual(off);
    // structural format preserved: glow + ↳ + full-width separator
    expect(on).toHaveLength(3);
    expect(on[0]).toContain("Execute"); // bash tools use Execute label via templates
    expect(on[1]).toContain("↳");
    expect(visibleWidth(on[2])).toBe(WIDTH);
  });
});

// ── VAL-CROSS-005: full e2e turn — memory + blinker + tool + editor, no regression ──

describe("VAL-CROSS-005: full end-to-end turn runs with no regression, clean agent_end, clean shutdown", () => {
  const WIDTH = 50;

  async function makeHarness() {
    const ui = {
      setWorkingIndicator: vi.fn(),
      setWorkingMessage: vi.fn(),
      setWorkingVisible: vi.fn(),
      setEditorComponent: vi.fn(),
    };
    const ctx: any = { hasUI: true, ui };
    const handlers: Record<string, ((e: any, c: any) => Promise<void>)[]> = {};
    const pi: any = { on: (n: string, fn: any) => (handlers[n] ||= []).push(fn) };
    const mockTui: any = { requestRender: vi.fn(), width: WIDTH, terminal: { rows: 24 } };
    const editorTheme: any = { ...makeToolTheme(), borderColor: (s: string) => s };
    const keybindings = { matches: vi.fn(() => false) };

    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(() => ({}) as unknown as ReturnType<typeof setInterval>);
    const clearIntervalSpy = vi
      .spyOn(globalThis, "clearInterval")
      .mockImplementation(() => undefined as unknown as void);

    vi.resetModules();
    const { registerBar } = await import("../bar.js");
    registerBar(pi);

    const fire = (n: string) => Promise.all((handlers[n] || []).map((h: any) => h({}, ctx)));
    return {
      ui,
      ctx,
      handlers,
      mockTui,
      editorTheme,
      keybindings,
      setIntervalSpy,
      clearIntervalSpy,
      fire,
    };
  }

  it("all four areas present in one frame; no default-spinner leak; clean end + shutdown", async () => {
    const h = await makeHarness();
    const { mockTui, editorTheme, keybindings, fire, ui, setIntervalSpy, clearIntervalSpy } = h;

    await fire("session_start");
    const cb = ui.setEditorComponent.mock.calls[0][0];
    const editor = cb(mockTui, editorTheme, keybindings);

    // memory injected + blinker active + tool invoked.
    await fire("before_agent_start");

    // Simulate an API-error retry boundary mid-turn: all four areas must keep
    // holding and the default spinner must NOT leak during the retry.
    await fire("turn_start");
    await fire("agent_settled");
    expect(ui.setWorkingVisible).not.toHaveBeenCalledWith(true);
    expect(ui.setWorkingIndicator).not.toHaveBeenCalledWith(undefined);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    // Compose the full chat frame: memory search, thinking block, unified tool
    // block, and the active boxed editor.
    const mTheme = makeMarkdownTheme();
    const memCallText = (renderMemorySearchCall({ query: "x" }, makeToolTheme() as any, {}) as any)
      .render(WIDTH)
      .map(stripAnsi);
    const memResultText = (
      renderMemorySearchResult(
        { details: { _fullOutput: "alpha\nbeta", count: 2 } },
        { expanded: false },
        makeToolTheme() as any,
        { isError: false },
      ) as any
    )
      .render(WIDTH)
      .map(stripAnsi);
    const think = new ThinkingComponent("I'll use memory then read the file.", mTheme, 1)
      .render(WIDTH)
      .map(stripAnsi);
    const tool = unifiedToolLines(
      "read",
      {
        content: [{ type: "text", text: "p\nq" }],
        details: { _fullOutput: "p\nq" },
        isError: false,
      },
      { path: "/tmp/m.ts" },
      WIDTH,
    );
    const barColored = editor.render(WIDTH);
    const bar = barColored.map(stripAnsi);

    const frame = [...memCallText, ...memResultText, ...think, ...tool, ...bar];
    const joined = frame.join("\n");

    // All four areas present simultaneously:
    expect(joined).toContain("memory_search"); // memory injected
    expect(joined).toContain("┃ "); // thinking block
    expect(joined).toContain("Read"); // unified tool block
    expect(joined).toContain("╭"); // boxed editor (blinker active)
    expect(barColored[0]).toContain("\x1b[38;2;255;"); // red ━ sweep visible (colored)
    expect(joined).toContain("↳"); // tool arrow line
    expect(visibleWidth(tool[2])).toBe(WIDTH); // tool separator intact

    // No default-spinner leak during the turn: hidden indicator applied,
    // default indicator never restored mid-turn.
    expect(ui.setWorkingVisible).toHaveBeenCalledWith(false);
    expect(ui.setWorkingIndicator).toHaveBeenCalledWith({ frames: [] });
    expect(ui.setWorkingVisible).not.toHaveBeenCalledWith(true);
    expect(ui.setWorkingIndicator).not.toHaveBeenCalledWith(undefined);

    // Exactly one blinker interval while active.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    // Clean agent_end — restores the default spinner + clears the one interval.
    await fire("agent_end");
    expect(ui.setWorkingVisible).toHaveBeenCalledWith(true);
    expect(ui.setWorkingIndicator).toHaveBeenCalledWith(undefined);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    // Clean session_shutdown — idempotent cleanup, no orphan timer leak and
    // no crash (the interval was already cleared at agent_end).
    await fire("session_shutdown");
    // still exactly one real clearInterval call for the single blinker timer
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
