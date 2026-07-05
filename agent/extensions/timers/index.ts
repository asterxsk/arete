/**
 * toolkit/timer — enhanced timer with command, tool, widget, and overlay.
 *
 * User commands: * /timer                           — Show timer status
 * /timer set <seconds> [label]     — Set a one-shot timer
 * /timer repeat <seconds> [label]  — Set a repeating interval timer
 * /timer list                      — List all timers
 * /timer clear <id>                — Cancel a timer
 * /timer clear-all                 — Cancel all active timers
 * /timer stats                     — Show timer statistics
 * /timer browse                    — Open interactive browser overlay
 *
 * LLM tool:
 *   timers action=set duration=300 label="check download"
 *   timers action=set_interval duration=60 label="heartbeat" repeat=5
 *   timers action=check
 *   timers action=list
 *   timers action=clear id=1
 *   timers action=clear_all
 *   timers action=stats

 */

import { Type } from "typebox";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";



// ── Types ──────────────────────────────────────────────────────────────

type TimerStatus = "active" | "repeating";

interface TimerEntry {
	id: number;
	label: string;
	durationMs: number;
	status: TimerStatus;
	startedAt: number;
	repeatCount?: number; // For repeating timers: how many times it's fired
	maxRepeats?: number;  // For repeating timers: max times to fire (0 = infinite)
	intervalId?: ReturnType<typeof setInterval>;
	timeoutId?: ReturnType<typeof setTimeout>;
}

interface TimerStats {
	total: number;
	active: number;
	repeating: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

const STATUS_ICONS: Record<TimerStatus, string> = {
	active: `${GREEN}●${RESET}`,
	repeating: `${GREEN}●${RESET}`,
};

const BRIDGE_KEY = "__pi_timer_state";

// ── State ──────────────────────────────────────────────────────────────

let timers: TimerEntry[] = [];
let nextTimerId = 1;
let piApi: { sendUserMessage: (text: string, opts?: { deliverAs: string }) => Promise<void> | void } | null = null;

// Pending notifications for the LLM — fired timers the LLM hasn't seen yet
// These are surfaced silently at the top of the next timers tool call response
const pendingTimerNotifications: string[] = [];

// ── Persistence ────────────────────────────────────────────────────────

// Wraps tool output with any pending timer notifications so the LLM always sees fired timers
function formatWithNotification(baseText: string): Array<{ type: "text"; text: string }> {
	const pending = pendingTimerNotifications.splice(0);
	if (pending.length === 0) return [{ type: "text", text: baseText }];
	const header = pending.length === 1
					? ` Timer Fired! ${pending[0]}`
					: ` ${pending.length} Timers Fired!\n${pending.map((m) => `  ${m}`).join("\n")}`;
			return [{ type: "text", text: `${header}\n\n---\n${baseText}` }];
}

function persistState(): void {
	// Don't persist the actual setTimeout/setInterval references
	(globalThis as any)[BRIDGE_KEY] = {
		nextId: nextTimerId,
	};
	// Expose pending notifications globally so other tools/extensions can check them
	(globalThis as any).__pi_pending_timer_notifications = pendingTimerNotifications;
}

function restoreState(): void {
	try {
		const saved = (globalThis as any)[BRIDGE_KEY] as
			{ nextId: number } | undefined;
		if (saved) {
			if (typeof saved.nextId === "number") nextTimerId = saved.nextId;
		}
	} catch {}
}

// ── Helpers ────────────────────────────────────────────────────────────

function truncate(s: string, maxLen: number): string {
	if (s.length <= maxLen) return s;
	return s.slice(0, maxLen - 1) + "…";
}

function formatDuration(totalSeconds: number): string {
	if (totalSeconds >= 3600) {
		const h = Math.floor(totalSeconds / 3600);
		const m = Math.floor((totalSeconds % 3600) / 60);
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}
	if (totalSeconds >= 60) {
		const m = Math.floor(totalSeconds / 60);
		const s = totalSeconds % 60;
		return s > 0 ? `${m}m ${s}s` : `${m}m`;
	}
	return `${totalSeconds}s`;
}

function getStats(): TimerStats {
	return {
		total: timers.length,
		active: timers.filter((t) => t.status === "active").length,
		repeating: timers.filter((t) => t.status === "repeating").length,
	};
}

function buildProgressBar(elapsed: number, total: number, segments = 8): string {
	if (total <= 0) return "[" + "░".repeat(segments) + "]";
	const fraction = Math.min(1, Math.max(0, (total - elapsed) / total));
	const f = Math.round(fraction * segments);
	return "[" + "█".repeat(f) + "░".repeat(segments - f) + "]";
}

function formatTimerEntry(t: TimerEntry): string {
	const icon = STATUS_ICONS[t.status];
	const elapsed = Math.round((Date.now() - t.startedAt) / 1000);
	const total = Math.round(t.durationMs / 1000);
	const remaining = Math.max(0, total - elapsed);
	const bar = buildProgressBar(elapsed, total);

	if (t.status === "repeating") {
		const count = t.repeatCount ?? 0;
		const max = t.maxRepeats ?? 0;
		const repeatInfo = max > 0 ? ` (${count}/${max})` : ` (${count})`;
		return `  ${icon} #${t.id}: ${truncate(t.label, 40)} ${bar} ${formatDuration(remaining)} remaining${repeatInfo}`;
	}
	return `  ${icon} #${t.id}: ${truncate(t.label, 40)} ${bar} ${formatDuration(remaining)} remaining`;
}

function formatTimerList(): string {
	if (timers.length === 0) return "No timers set.";

	const lines: string[] = [];
	let currentStatus: TimerStatus | null = null;

	for (const t of timers) {
		const statusLabel: Record<TimerStatus, string> = {
			active: "Active:",
			repeating: "Repeating:",
		};
		if (t.status !== currentStatus) {
			currentStatus = t.status;
			lines.push("");
			lines.push(`  ${statusLabel[t.status]}`);
		}
		lines.push(formatTimerEntry(t));
	}

	return lines.join("\n");
}

function formatStatsSummary(): string {
	const stats = getStats();
	const lines: string[] = [
		`${GREEN}●${RESET} ${stats.active} active  |  ${GREEN}●${RESET} ${stats.repeating} repeating`,
	];

	if (timers.length > 0) {
		lines.push("");
		for (const t of timers) {
			lines.push(formatTimerEntry(t));
		}
	}

	return lines.join("\n");
}

// ── Timer setup helpers ────────────────────────────────────────────────

function setupOneShotTimer(t: TimerEntry, ctx?: any, timerCondition?: string): void {
	const ms = Math.max(0, t.durationMs - (Date.now() - t.startedAt));
	t.timeoutId = setTimeout(() => {
		// Inject a user message to wake the LLM up
		const msg = ` Timer #${t.id} fired: "${t.label}"`;
		pendingTimerNotifications.push(msg);
		if (piApi?.sendUserMessage) {
			try {
				const result = piApi.sendUserMessage(msg, { deliverAs: "nextTurn" });
				if (result && typeof result.then === "function") {
					result.catch(() => {});
				}
			} catch {}
		}
		// Remove the timer from the array — it's done
		const idx = timers.indexOf(t);
		if (idx >= 0) timers.splice(idx, 1);
		persistState();
	}, ms);

	// TimerCondition: if set to a task ID, cancel this timer when that task completes
	if (timerCondition && timerCondition !== "never") {
		const registerListener = (globalThis as any).__pi_task_on_complete as
			((fn: (taskId: string, status: string, exitCode: number | undefined) => void) => () => void) | undefined;
		if (registerListener) {
			const unsubscribe = registerListener((taskId, _status, _exitCode) => {
				const shouldCancel = timerCondition === "any" || taskId === timerCondition;
				if (shouldCancel) {
					// Task finished before timer — cancel the timer
					if (t.timeoutId) clearTimeout(t.timeoutId);
					const idx = timers.indexOf(t);
					if (idx >= 0) timers.splice(idx, 1);
					unsubscribe();
					persistState();
				}
			});
		}
	}
}

function setupRepeatingTimer(t: TimerEntry, intervalMs: number, ctx?: any): void {
	const fire = () => {
		t.repeatCount = (t.repeatCount ?? 0) + 1;

		const msg = ` Timer #${t.id} fired (${t.repeatCount}/${t.maxRepeats ?? "∞"}): "${t.label}"`;
		pendingTimerNotifications.push(msg);
		// Only inject user message on first fire to wake the LLM
		if (t.repeatCount === 1 && piApi?.sendUserMessage) {
			try {
				const result = piApi.sendUserMessage(msg, { deliverAs: "nextTurn" });
				if (result && typeof result.then === "function") {
					result.catch(() => {});
				}
			} catch {}
		}
		persistState();

		// Check if max repeats reached — remove the timer
		if (t.maxRepeats && t.repeatCount >= t.maxRepeats) {
			if (t.intervalId) clearInterval(t.intervalId);
			const idx = timers.indexOf(t);
			if (idx >= 0) timers.splice(idx, 1);
		}
	};

	// Fire immediately on start, then on interval
	fire();
	t.intervalId = setInterval(fire, intervalMs);
}

// ── Widget ─────────────────────────────────────────────────────────────

function getTimerCountdown(t: TimerEntry): string {
	const elapsed = Math.round((Date.now() - t.startedAt) / 1000);
	const total = Math.round(t.durationMs / 1000);
	const remaining = Math.max(0, total - elapsed);
	return formatDuration(remaining);
}

function buildTimersSummary(): string {
	if (timers.length === 0) return "";
	// Find the nearest timer for countdown display
	const nearest = timers.reduce((a, b) => {
		const aRem = Math.max(0, a.durationMs - (Date.now() - a.startedAt));
		const bRem = Math.max(0, b.durationMs - (Date.now() - b.startedAt));
		return aRem < bRem ? a : b;
	});
	const countdown = getTimerCountdown(nearest);
	return `${countdown}`;
}

function renderWidget(_tui: any) {
	return {
		dispose() {},
		invalidate() {},
		render(_width: number): string[] {
			// Store timer countdown for the todos widget to read
			(globalThis as any).__pi_timers_summary = timers.length > 0 ? buildTimersSummary() : "";
			// Hidden — timers are shown on the same line as spinner/todos
			return [];
		},
	};
}

function refreshWidget(ctx: any): void {
	if (ctx?.hasUI) {
		ctx.ui.setWidget("toolkit-timers", renderWidget, {
			order: 71,
			placement: "aboveInput",
		});
	}
}


// ── Cleanup on shutdown ───────────────────────────────────────────────

function clearAllTimers(): void {
	for (const t of timers) {
		if (t.intervalId) clearInterval(t.intervalId);
		if (t.timeoutId) clearTimeout(t.timeoutId);
	}
	timers = [];
}

// ── Extension entry ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// Self-register in global feature registry
	(globalThis as any).__pi_extension_features?.push({
		name: "timers",
		description: "Run one-shot and repeating timers with notifications and an interactive overlay",
		commands: ["/schedule"],
		tools: ["schedule"],
	});

	piApi = pi;

	pi.on("session_start", async (_event, ctx) => {
		restoreState();
		// Keep existing timers — they persist across /new in the same session
		if (ctx.hasUI) refreshWidget(ctx);
	});

	pi.on("session_shutdown", () => {
		for (const t of timers) {
			if (t.timeoutId) clearTimeout(t.timeoutId);
			if (t.intervalId) clearInterval(t.intervalId);
		}
		timers = [];
		persistState();
	});

	// ── /timer command (user-facing) ────────────────────────────────────

	pi.registerCommand("schedule", {
		description:
			"Manage timers. Subcommands: set, repeat, list, clear, clear-all, stats, browse",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();

			if (!trimmed) {
				if (!ctx.hasUI) {
					ctx.ui.notify("Interactive mode required for UI.", "warning");
					return;
				}
				await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
					return new TimersUIComponent(tui, theme, done);
				});
				return;
			}

			const firstSpace = trimmed.search(/\s/);
			const subcmd = firstSpace === -1 ? trimmed.toLowerCase() : trimmed.slice(0, firstSpace).toLowerCase();
			const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

			switch (subcmd) {
				case "set": {
					const parts = rest.split(/\s+/);
					const duration = parseFloat(parts[0] ?? "");
					if (!isFinite(duration) || duration <= 0) {
						ctx.ui.notify("Usage: /timer set <seconds> [label]", "warning");
						return;
					}
					const label = parts.slice(1).join(" ") || `Timer #${nextTimerId}`;
					const timerId = nextTimerId++;
					const durationMs = Math.round(duration * 1000);

					const entry: TimerEntry = {
						id: timerId,
						label,
						durationMs,
						status: "active",
						startedAt: Date.now(),
					};
					timers.push(entry);
					setupOneShotTimer(entry, ctx);
					refreshWidget(ctx);					ctx.ui.notify(` Timer #${timerId} set for ${formatDuration(Math.round(duration))}: ${truncate(label, 60)}`,
						"info",
					);
					return;
				}

				case "repeat": {
					const parts = rest.split(/\s+/);
					const interval = parseFloat(parts[0] ?? "");
					if (!isFinite(interval) || interval <= 0) {
						ctx.ui.notify("Usage: /timer repeat <seconds> [label] [repeats=N]", "warning");
						return;
					}
					let label = "";
					let maxRepeats = 0; // 0 = infinite
					for (const p of parts.slice(1)) {
						const repMatch = p.match(/^repeats=(\d+)$/i);
						if (repMatch) {
							maxRepeats = parseInt(repMatch[1]!, 10);
						} else {
							label += (label ? " " : "") + p;
						}
					}
					label = label || `Repeat #${nextTimerId}`;
					const timerId = nextTimerId++;
					const intervalMs = Math.round(interval * 1000);

					const entry: TimerEntry = {
						id: timerId,
						label,
						durationMs: intervalMs,
						status: "repeating",
						startedAt: Date.now(),
						repeatCount: 0,
						maxRepeats: maxRepeats || undefined,
					};
					timers.push(entry);
					setupRepeatingTimer(entry, intervalMs, ctx);
					refreshWidget(ctx);
					const repInfo = maxRepeats > 0 ? ` (${maxRepeats} repeats)` : " (infinite)";
					ctx.ui.notify(
						` Repeat #${timerId} every ${formatDuration(Math.round(interval))}: ${truncate(label, 50)}${repInfo}`,
						"info",
					);
					return;
				}

			case "check": {
				if (timers.length === 0) {
					ctx.ui.notify("No timers set.", "info");
					return;
				}
				return { result: formatTimerList() };
			}

				case "list":
				case "ls": {
					return { result: formatTimerList() };
				}

				case "clear": {
					const id = parseInt(rest, 10);
					if (isNaN(id)) {
						ctx.ui.notify("Usage: /timer clear <id>", "warning");
						return;
					}
					const idx = timers.findIndex((t) => t.id === id);
					if (idx < 0) {
						ctx.ui.notify(`Timer #${id} not found.`, "warning");
						return;
					}
					const timer = timers[idx];
					if (timer.intervalId) clearInterval(timer.intervalId);
					if (timer.timeoutId) clearTimeout(timer.timeoutId);
					timers.splice(idx, 1);
					persistState();
					refreshWidget(ctx);
					ctx.ui.notify(` Cleared timer #${id}: ${truncate(timer.label, 60)}`, "info");
					return;
				}

				case "clear-all":
				case "clear_all": {
					const count = timers.length;
					clearAllTimers();
					refreshWidget(ctx);
					ctx.ui.notify(`Cleared ${count} timer(s).`, "info");
					return;
				}

				case "stats": {
					return { result: formatStatsSummary() };
				}



				default: {
					ctx.ui.notify(
						`Unknown subcommand: ${subcmd}. Try: set, repeat, check, list, clear, clear-all, stats, history, browse`,
						"warning",
					);
					return;
				}
			}
		},
	});

	// ── schedule tool (LLM-callable) ──────────────────────────────────────

	const scheduleTool = {
		name: "schedule",
		label: "Schedule",
		description: "Schedule a one-shot timer or a recurring cron job that sends notifications in the background.",
		promptSnippet: "Schedule a timer. Fired timer notifications appear silently at the top of the next tool response.",
		parameters: Type.Object({
			DurationSeconds: Type.Optional(Type.String({ description: "Duration in seconds (e.g. '300')" })),
			CronExpression: Type.Optional(Type.String({ description: "Not supported natively. Use DurationSeconds." })),
			MaxIterations: Type.Optional(Type.String({ description: "Optional max repeats." })),
			Prompt: Type.String({ description: "The message content to include when it fires." }),
			TimerCondition: Type.Optional(Type.String()),
		}),

		async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
			const _execute = async () => {
				const { DurationSeconds, CronExpression, MaxIterations, Prompt, TimerCondition } = params as {
				DurationSeconds?: string;
				CronExpression?: string;
				MaxIterations?: string;
				Prompt: string;
				TimerCondition?: string;
			};

			const refresh = () => refreshWidget(ctx);

			if (DurationSeconds) {
				const duration = parseFloat(DurationSeconds);
				if (!isFinite(duration) || duration <= 0) {
					return {
						content: formatWithNotification("Error: DurationSeconds must be a valid positive number"),
						details: {},
						isError: true,
					};
				}
				const timerId = nextTimerId++;
				const durationMs = Math.round(duration * 1000);

				const entry: TimerEntry = {
					id: timerId,
					label: Prompt,
					durationMs,
					status: "active",
					startedAt: Date.now(),
				};
				timers.push(entry);
				setupOneShotTimer(entry, ctx, TimerCondition);
				refresh();
				return {
					content: formatWithNotification(` Timer #${timerId} set for ${formatDuration(Math.round(duration))}: ${Prompt}`),
					details: { timerId, duration, label: Prompt },
				};
			} else if (CronExpression) {
				return {
					content: formatWithNotification("Error: CronExpression is not supported by this simple extension. Please use DurationSeconds for one-shot timers."),
					details: {},
					isError: true,
				};
			}

			return {
				content: formatWithNotification(`Error: You must specify DurationSeconds.`),
				details: {},
				isError: true,
			};
			};
			const res = await _execute();
			(res as any).details = { ...(res.details || {}), _callArgs: params };
			return res;
		},
	};
	if ((globalThis as any).__pi_patchTool) (globalThis as any).__pi_patchTool(scheduleTool);
	pi.registerTool(scheduleTool);
}

class TimersUIComponent {
	private mode: "menu" | "view_timer" = "menu";
	private optionIndex = 0;
	private input: Input;
	private selectedTimer: TimerEntry | null = null;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(
		private readonly tui: any,
		private readonly theme: any,
		private readonly done: () => void,
	) {
		this.input = new Input();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			if (this.mode !== "menu") {
				this.mode = "menu";
				this.optionIndex = 0;
				this.invalidate();
				this.tui.requestRender();
			} else {
				this.done();
			}
			return;
		}

		const options = this.getOptions();
		if (matchesKey(data, Key.up)) {
			this.optionIndex = Math.max(0, this.optionIndex - 1);
			this.invalidate();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.optionIndex = Math.min(options.length - 1, this.optionIndex + 1);
			this.invalidate();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const selected = options[this.optionIndex];
			if (selected) {
				selected.action();
				this.optionIndex = 0;
				this.invalidate();
				this.tui.requestRender();
			}
			return;
		}
	}

	private getOptions() {
		if (this.mode === "menu") {
			const opts = [];
			for (const t of timers) {
				opts.push({
					label: `${STATUS_ICONS[t.status]} Timer #${t.id} - ${truncate(t.label, 30)} [${getTimerCountdown(t)}]`,
					action: () => { this.selectedTimer = t; this.mode = "view_timer"; }
				});
			}
			if (timers.length > 0) {
				opts.push({ label: `${RED}Clear all timers${RESET}`, action: () => { clearAllTimers(); } });
			}
			return opts;
		} else if (this.mode === "view_timer") {
			return [
				{ label: "Back to menu", action: () => { this.mode = "menu"; } },
				{ label: `${RED}Cancel/Clear Timer${RESET}`, action: () => {
					if (this.selectedTimer) {
						if (this.selectedTimer.intervalId) clearInterval(this.selectedTimer.intervalId);
						if (this.selectedTimer.timeoutId) clearTimeout(this.selectedTimer.timeoutId);
						const idx = timers.indexOf(this.selectedTimer);
						if (idx >= 0) timers.splice(idx, 1);
					}
					this.mode = "menu";
				}}
			];
		}
		return [];
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const lines: string[] = [];
		const add = (text: string) => lines.push(truncateToWidth(text, width));

		add(this.theme.fg("accent", "─".repeat(Math.max(0, width))));

		if (this.mode === "menu") {
			add(this.theme.fg("text", " Manage Timers"));
			lines.push("");
			const options = this.getOptions();
			for (let i = 0; i < options.length; i++) {
				const selected = i === this.optionIndex;
				const prefix = selected ? this.theme.fg("accent", "> ") : "  ";
				const label = options[i].label;
				add(prefix + (selected ? this.theme.fg("accent", label) : this.theme.fg("text", label)));
			}
		} else if (this.mode === "view_timer" && this.selectedTimer) {
			add(this.theme.fg("text", ` Timer Details: #${this.selectedTimer.id}`));
			lines.push("");
			add(` Label:   ${this.theme.fg("accent", this.selectedTimer.label)}`);
			add(` Rem:     ${getTimerCountdown(this.selectedTimer)}`);
			const options = this.getOptions();
			lines.push("");
			for (let i = 0; i < options.length; i++) {
				const selected = i === this.optionIndex;
				const prefix = selected ? this.theme.fg("accent", "> ") : "  ";
				const label = options[i].label;
				add(prefix + (selected ? this.theme.fg("accent", label) : this.theme.fg("text", label)));
			}
		}

		lines.push("");
		const help = " ↑↓ options • Enter select • Esc back/close";
		add(this.theme.fg("dim", help));
		add(this.theme.fg("accent", "─".repeat(Math.max(0, width))));

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.input.invalidate();
	}
}
