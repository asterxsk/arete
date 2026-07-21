import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Lifecycle tests for the input-bar blinker hardening in bar.ts.
// We drive the public registerBar(pi) with a mock pi that records event
// handlers and spy on the working-indicator UI methods. We spy on the global
// setInterval/clearInterval so the blinker interval is fully tracked (no real
// 60ms timers) and we can assert exactly one interval exists while active and
// that it is cleared on shutdown. Each test re-imports bar.js with a fresh
// module state (via vi.resetModules) so no animation flag leaks across tests.

function makeCtx() {
  const ui = {
    setWorkingIndicator: vi.fn(),
    setWorkingMessage: vi.fn(),
    setWorkingVisible: vi.fn(),
    setEditorComponent: vi.fn(),
  };
  return {
    hasUI: true,
    ui,
  };
}

function makePi(ctx: any) {
  const handlers: Record<string, ((e: any, c: any) => Promise<void>)[]> = {};
  const pi: any = {
    on: (name: string, fn: (e: any, c: any) => Promise<void>) => {
      (handlers[name] ||= []).push(fn);
    },
    handlers,
  };
  return pi;
}

function fire(pi: any, name: string, ctx: any) {
  const hs = pi.handlers[name] || [];
  return Promise.all(hs.map((h: any) => h({}, ctx)));
}

describe("bar blinker lifecycle (VAL-BLINK)", () => {
  let ctx: any;
  let pi: any;
  let setIntervalSpy: any;
  let clearIntervalSpy: any;

  beforeEach(() => {
    ctx = makeCtx();
    pi = makePi(ctx);
    vi.resetModules();
    setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(() => ({}) as unknown as ReturnType<typeof setInterval>);
    clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it("VAL-BLINK-005: agent_start re-applies hidden indicator + starts sweep (single interval)", async () => {
    const { registerBar } = await import("../bar.js");
    registerBar(pi);
    await fire(pi, "session_start", ctx);
    await fire(pi, "agent_start", ctx);

    expect(ctx.ui.setWorkingVisible).toHaveBeenCalledWith(false);
    expect(ctx.ui.setWorkingIndicator).toHaveBeenCalledWith({ frames: [] });
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("VAL-BLINK-005: two agent_start calls produce exactly one interval", async () => {
    const { registerBar } = await import("../bar.js");
    registerBar(pi);
    await fire(pi, "session_start", ctx);
    await fire(pi, "agent_start", ctx);
    await fire(pi, "agent_start", ctx);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    // hidden indicator re-applied on both starts (idempotent re-apply)
    expect(ctx.ui.setWorkingVisible).toHaveBeenCalledWith(false);
  });

  it("idempotent startAnimation: double before_agent_start yields one interval", async () => {
    const { registerBar } = await import("../bar.js");
    registerBar(pi);
    await fire(pi, "session_start", ctx);
    await fire(pi, "before_agent_start", ctx);
    await fire(pi, "before_agent_start", ctx);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("VAL-BLINK-004: single interval while active, cleared on session_shutdown", async () => {
    const { registerBar } = await import("../bar.js");
    registerBar(pi);
    await fire(pi, "session_start", ctx);
    await fire(pi, "before_agent_start", ctx);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(0);

    await fire(pi, "session_shutdown", ctx);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    // default indicator restored on shutdown
    expect(ctx.ui.setWorkingVisible).toHaveBeenLastCalledWith(true);
    expect(ctx.ui.setWorkingIndicator).toHaveBeenLastCalledWith(undefined);
  });

  it("VAL-BLINK-002: retry (turn_start / agent_settled) re-applies hidden indicator, default never restored mid-turn", async () => {
    const { registerBar } = await import("../bar.js");
    registerBar(pi);
    await fire(pi, "session_start", ctx);
    await fire(pi, "agent_start", ctx);
    ctx.ui.setWorkingVisible.mockClear();
    ctx.ui.setWorkingIndicator.mockClear();

    await fire(pi, "turn_start", ctx);
    await fire(pi, "agent_settled", ctx);

    // hidden indicator re-applied on the retry boundary
    expect(ctx.ui.setWorkingVisible).toHaveBeenCalledWith(false);
    expect(ctx.ui.setWorkingIndicator).toHaveBeenCalledWith({ frames: [] });
    // default spinner must NOT be restored mid-turn
    expect(ctx.ui.setWorkingVisible).not.toHaveBeenCalledWith(true);
    expect(ctx.ui.setWorkingIndicator).not.toHaveBeenCalledWith(undefined);
    // sweep keeps running (still exactly one interval, no new create)
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("VAL-BLINK-003: default spinner restored only on true agent_end, hidden before it", async () => {
    const { registerBar } = await import("../bar.js");
    registerBar(pi);
    await fire(pi, "session_start", ctx);
    await fire(pi, "agent_start", ctx);
    ctx.ui.setWorkingVisible.mockClear();
    ctx.ui.setWorkingIndicator.mockClear();

    // mid-turn must remain hidden
    expect(ctx.ui.setWorkingVisible).not.toHaveBeenCalledWith(true);

    await fire(pi, "agent_end", ctx);
    expect(ctx.ui.setWorkingVisible).toHaveBeenCalledWith(true);
    expect(ctx.ui.setWorkingIndicator).toHaveBeenCalledWith(undefined);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("VAL-BLINK-002/003: API-error interrupt path — retry keeps hidden, only agent_end restores", async () => {
    const { registerBar } = await import("../bar.js");
    registerBar(pi);
    await fire(pi, "session_start", ctx);
    await fire(pi, "before_agent_start", ctx); // turn 1 starts

    // Simulate an API error + retry: host fires a re-settle while animating.
    await fire(pi, "turn_start", ctx);
    await fire(pi, "agent_settled", ctx);

    expect(ctx.ui.setWorkingVisible).not.toHaveBeenCalledWith(true);

    // Now the turn genuinely ends.
    await fire(pi, "agent_end", ctx);
    expect(ctx.ui.setWorkingVisible).toHaveBeenCalledWith(true);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
