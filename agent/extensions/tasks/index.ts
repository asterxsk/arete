/**
 * toolkit/tasks — background terminal tasks with output capture.
 *
 * Inspired by Antigravity CLI's subagent/background task system.
 *
 * The agent can spawn a terminal command in the background, do other work,
 * set a timer to come back, and check the output when ready.
 *
 * User commands:
 *   /task                              — Show task summary
 *   /task start <command>              — Run a command in the background
 *   /task list                         — List all tasks with status
 *   /task ls                           — Alias for list
 *   /task check <id>                   — Show captured output of a task
 *   /task wait <id> [seconds]          — Wait for a task to finish (with timeout)
 *   /task cancel <id>                  — Kill a running task
 *   /task clear <id>                   — Remove a completed/failed task
 *   /task clear-all                    — Remove all completed tasks
 *   /task stats                        — Show task statistics
 *
 * LLM tool:
 *   tasks action=start command="npm run build" label="Build project"
 *   tasks action=check id=1
 *   tasks action=list
 *   tasks action=wait id=1 timeout=300
 *   tasks action=cancel id=1
 *   tasks action=clear id=1
 *   tasks action=clear_all
 *   tasks action=stats
 *
 * Typical usage with timer:
 *   1. Agent starts a long build: tasks action=start command="npm run build" label="build"
 *   2. Agent sets a timer: timers action=set duration=300 label="check build"
 *   3. Agent continues working on something else
 *   4. Timer fires → agent checks task: tasks action=check id=1
 *   5. If done, agent reads output and continues
 *   6. If still running, sets another timer
 */

import { spawn } from "node:child_process";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";



// ── Types ──────────────────────────────────────────────────────────────

type TaskStatus = "running" | "completed" | "failed" | "cancelled";

interface TaskEntry {
	id: string;
	label: string;
	command: string;
	status: TaskStatus;
	startedAt: number;
	completedAt?: number;
	exitCode?: number;
	stdout: string;
	stderr: string;
	cwd: string;
	pid?: number;
	proc?: ReturnType<typeof spawn>;
}

interface TaskStats {
	total: number;
	running: number;
	completed: number;
	failed: number;
	cancelled: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const MAX_OUTPUT_CHARS = 50000; // Cap stored output to prevent memory issues
const BRIDGE_KEY = "__pi_task_state";

// ── State ──────────────────────────────────────────────────────────────

let tasks: TaskEntry[] = [];
let piApi: { sendUserMessage: (text: string, opts?: { deliverAs: string }) => Promise<void> | void } | null = null;

// ── Persistence ────────────────────────────────────────────────────────

function persistState(): void {
	// Don't persist running tasks (can't serialize process refs)
	const persisted = tasks.map((t) => {
		if (t.status === "running")
			return { ...t, status: "failed" as const, proc: undefined, completedAt: Date.now(), exitCode: -1 };
		const { proc, ...rest } = t;
		return rest;
	});
	(globalThis as any)[BRIDGE_KEY] = { tasks: persisted };
}

function restoreState(): void {
	try {
		const saved = (globalThis as any)[BRIDGE_KEY] as { tasks: TaskEntry[] } | undefined;
		if (saved?.tasks) {
			tasks = saved.tasks.map((t) => ({ ...t, proc: undefined }));
		}
	} catch {
		tasks = [];
	}
}

// ── Task completion bridge ─────────────────────────────────────────────
// Allows other extensions (e.g. timers) to listen for task completions
// without importing this extension directly.
type TaskCompletionListener = (taskId: string, status: TaskStatus, exitCode: number | undefined) => void;
const taskCompletionListeners: TaskCompletionListener[] = [];

function notifyTaskCompletion(taskId: string, status: TaskStatus, exitCode: number | undefined): void {
	// Notify the agent via user message injection
	if (piApi?.sendUserMessage && status !== "cancelled") {
		const icon = exitCode === 0 ? "" : "";
		const msg = `${icon} Task ${taskId} finished (exit ${exitCode})`;
		try {
			const result = piApi.sendUserMessage(msg, { deliverAs: "nextTurn" });
			if (result && typeof result.then === "function") {
				result.catch(() => {});
			}
		} catch {}
	}
	// Notify any registered listeners (e.g. timers for TimerCondition)
	for (const listener of taskCompletionListeners) {
		try { listener(taskId, status, exitCode); } catch {}
	}
}

function registerTaskCompletionListener(fn: TaskCompletionListener): () => void {
	taskCompletionListeners.push(fn);
	return () => {
		const idx = taskCompletionListeners.indexOf(fn);
		if (idx >= 0) taskCompletionListeners.splice(idx, 1);
	};
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

function getStats(): TaskStats {
	return {
		total: tasks.length,
		running: tasks.filter((t) => t.status === "running").length,
		completed: tasks.filter((t) => t.status === "completed").length,
		failed: tasks.filter((t) => t.status === "failed").length,
		cancelled: tasks.filter((t) => t.status === "cancelled").length,
	};
}

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const STATUS_ICONS: Record<TaskStatus, string> = {
	running: `${GREEN}●${RESET}`,
	completed: "●",
	failed: `${RED}●${RESET}`,
	cancelled: `${DIM}●${RESET}`,
};

function formatTaskLine(t: TaskEntry): string {
	const icon = STATUS_ICONS[t.status];
	const elapsed = Math.round((Date.now() - t.startedAt) / 1000);
	const duration = t.completedAt
		? formatDuration(Math.round((t.completedAt - t.startedAt) / 1000))
		: formatDuration(elapsed);
	const runningMark = t.status === "running" ? ` ${elapsed}s` : "";		return ` ${icon} #${t.id}: ${truncate(t.label || t.command, 50)} (${duration})${runningMark}`;
}

function formatTaskDetail(t: TaskEntry): string {
	const lines: string[] = [];
	const icon = STATUS_ICONS[t.status];
	const elapsed = Math.round((Date.now() - t.startedAt) / 1000);
	const duration = t.completedAt
		? formatDuration(Math.round((t.completedAt - t.startedAt) / 1000))
		: formatDuration(elapsed);		lines.push(`${icon} #${t.id}: ${t.label || "(unnamed)"}`);
	lines.push(`   Command: ${t.command}`);
	lines.push(`   Status: ${t.status}  |  Duration: ${duration}  |  CWD: ${t.cwd}`);
	if (t.exitCode != null) lines.push(`   Exit code: ${t.exitCode}`);
	if (t.pid) lines.push(`   PID: ${t.pid}`);

	if (t.stdout.trim()) {
		const out = t.stdout.length > 2000 ? t.stdout.slice(-2000) : t.stdout;
		lines.push("");
		lines.push("   ── stdout ──");
		lines.push(
			out
				.split("\n")
				.map((l) => `   ${l}`)
				.join("\n"),
		);
	}

	if (t.stderr.trim()) {
		const err = t.stderr.length > 1000 ? t.stderr.slice(-1000) : t.stderr;
		lines.push("");
		lines.push("   ── stderr ──");
		lines.push(
			err
				.split("\n")
				.map((l) => `   ${l}`)
				.join("\n"),
		);
	}

	return lines.join("\n");
}

// ── Widget (removed per user request) ───────────────────────────────

function refreshWidget(_ctx: any): void {
	// No-op: tasks widget hidden, spinner shows todos right-aligned
}

// ── Task execution ────────────────────────────────────────────────────

function startTask(command: string, label: string, cwd: string, ctx?: any): TaskEntry {
	const randomNum = Math.floor(10000000 + Math.random() * 90000000);
	const taskId = `powershell(${randomNum})`;

	const entry: TaskEntry = {
		id: taskId,
		label: label || command,
		command,
		status: "running",
		startedAt: Date.now(),
		stdout: "",
		stderr: "",
		cwd,
	};

	tasks.push(entry);

	// Spawn the process
	try {
		const proc = spawn(command, [], {
			cwd,
			shell: true,
			stdio: ["ignore", "pipe", "pipe"],
		});

		entry.pid = proc.pid;
		entry.proc = proc;

		let stdoutBuf = "";
		let stderrBuf = "";

		proc.stdout.on("data", (data: Buffer) => {
			const text = data.toString();
			stdoutBuf += text;
			// Cap to prevent memory issues
			if (stdoutBuf.length > MAX_OUTPUT_CHARS) {
				stdoutBuf = stdoutBuf.slice(-MAX_OUTPUT_CHARS);
			}
		});

		proc.stderr.on("data", (data: Buffer) => {
			const text = data.toString();
			stderrBuf += text;
			if (stderrBuf.length > MAX_OUTPUT_CHARS) {
				stderrBuf = stderrBuf.slice(-MAX_OUTPUT_CHARS);
			}
		});

		proc.on("close", (exitCode) => {
			entry.stdout = stdoutBuf;
			entry.stderr = stderrBuf;
			entry.exitCode = exitCode;
			entry.completedAt = Date.now();
			// Don't overwrite if already cancelled by cancelTask()
			if (entry.status === "running") {
				entry.status = exitCode === 0 ? "completed" : "failed";
			}
			entry.proc = undefined;

			notifyTaskCompletion(taskId, entry.status, exitCode ?? undefined);

			if (entry.status !== "cancelled" && ctx?.hasUI) {
				const icon = exitCode === 0 ? "" : "";
				ctx.ui.notify(
					`${icon} ${taskId} finished (exit ${exitCode}): ${truncate(label || command, 60)}`,
					"info",
				);
			}

			if (ctx) refreshWidget(ctx);
		});

		proc.on("error", (err) => {
			entry.stdout = stdoutBuf;
			entry.stderr = stderrBuf + `\nError: ${err.message}`;
			entry.exitCode = -1;
			entry.completedAt = Date.now();
			entry.status = "failed";
			entry.proc = undefined;

			notifyTaskCompletion(taskId, "failed", -1);

			if (ctx?.hasUI) {
				ctx.ui.notify(` ${taskId} error: ${truncate(err.message, 60)}`, "warning");
			}

			if (ctx) refreshWidget(ctx);
		});
	} catch (err) {
		entry.status = "failed";
		entry.completedAt = Date.now();
		entry.exitCode = -1;
		entry.stderr = `Failed to spawn: ${err instanceof Error ? err.message : String(err)}`;
		if (ctx?.hasUI) {
			ctx.ui.notify(` ${taskId} failed to start`, "warning");
		}
	}

	persistState();
	if (ctx) refreshWidget(ctx);
	return entry;
}

function cancelTask(id: string): boolean {
	const task = tasks.find((t) => t.id === id);
	if (!task || task.status !== "running") return false;

	// Set status immediately so the close callback doesn't overwrite it
	task.status = "cancelled";
	task.completedAt = Date.now();
	task.exitCode = -1;

	// Grab ref before clearing so SIGKILL fallback still works
	const proc = task.proc;
	task.proc = undefined;

	if (proc && !proc.killed) {
		proc.kill("SIGTERM");
		// Force kill after 3s if still alive
		setTimeout(() => {
			if (proc && !proc.killed) {
				proc.kill("SIGKILL");
			}
		}, 3000);
	}
	persistState();
	return true;
}

async function waitForTask(id: string, timeoutSec: number): Promise<TaskEntry | null> {
	const task = tasks.find((t) => t.id === id);
	if (!task) return null;
	if (task.status !== "running") return task;

	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			resolve(task); // Return as-is, still running
		}, timeoutSec * 1000);

		const checkInterval = setInterval(() => {
			const current = tasks.find((t) => t.id === id);
			if (!current || current.status !== "running") {
				clearTimeout(timeout);
				clearInterval(checkInterval);
				resolve(current);
			}
		}, 200);

		// Also handle process-level completion
		if (task.proc) {
			task.proc.on("close", () => {
				clearTimeout(timeout);
				clearInterval(checkInterval);
				const current = tasks.find((t) => t.id === id);
				resolve(current ?? task);
			});
		}
	});
}

// ── Extension entry ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	piApi = pi;

	// Expose task completion listener bridge for other extensions (e.g. timers)
	(globalThis as any).__pi_task_on_complete = registerTaskCompletionListener;

	// Self-register in global feature registry
	(globalThis as any).__pi_extension_features?.push({
		name: "tasks",
		description: "Run terminal commands in the background, capture output, check status, and cancel",
		commands: ["/manage_task"],
		tools: ["manage_task", "run_command"],
	});

	const onProcessExit = () => {
		for (const t of tasks) {
			if (t.status === "running" && t.proc && !t.proc.killed) {
				try {
					t.proc.kill("SIGKILL");
				} catch {}
			}
		}
	};
	process.on("exit", onProcessExit);
	
	const sigIntHandler = () => { onProcessExit(); process.exit(130); };
	const sigTermHandler = () => { onProcessExit(); process.exit(143); };
	
	process.on("SIGINT", sigIntHandler);
	process.on("SIGTERM", sigTermHandler);

	pi.on("session_start", async (_event, ctx) => {
		restoreState();
		if (ctx.hasUI) refreshWidget(ctx);
	});

	pi.on("session_shutdown", () => {
		// Cancel any running tasks
		for (const t of tasks) {
			if (t.status === "running" && t.proc && !t.proc.killed) {
				t.proc.kill("SIGTERM");
			}
		}
		persistState();
		process.off("exit", onProcessExit);
		process.off("SIGINT", sigIntHandler);
		process.off("SIGTERM", sigTermHandler);
	});

	// ── /task command (user-facing) ─────────────────────────────────────

	pi.registerCommand("manage_task", {
		description:
			"Show all background tasks with status indicators (●=done, ●=running, ●=failed). Subcommands: start, list, check, wait, cancel, clear, clear-all, stats",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();

			if (!trimmed) {
				if (!ctx.hasUI) {
					ctx.ui.notify("Interactive mode required for UI.", "warning");
					return;
				}
				await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
					return new TasksUIComponent(tui, theme, done);
				});
				return;
			}

			const firstSpace = trimmed.search(/\s/);
			const subcmd = firstSpace === -1 ? trimmed.toLowerCase() : trimmed.slice(0, firstSpace).toLowerCase();
			const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

			switch (subcmd) {
				case "start": {
					if (!rest) {
						ctx.ui.notify("Usage: /tasks start <command>", "warning");
						return;
					}
					const entry = startTask(rest, rest, ctx.cwd || process.cwd(), ctx);
					ctx.ui.notify(`⟳ ${entry.id} started: ${truncate(rest, 60)}`, "info");
					return;
				}

				case "list":
				case "ls": {
					if (tasks.length === 0) {
						ctx.ui.notify("No tasks.", "info");
						return;
					}
					const lines: string[] = ["Tasks:"];
					for (const t of tasks) {
						lines.push(formatTaskLine(t));
					}
					return { result: lines.join("\n") };
				}

				case "check": {
					const id = rest;
					if (!id) {
						ctx.ui.notify("Usage: /tasks check <id>", "warning");
						return;
					}
					const task = tasks.find((t) => t.id === id);
					if (!task) {
						ctx.ui.notify(`${id} not found.`, "warning");
						return;
					}
					return { result: formatTaskDetail(task) };
				}

				case "wait": {
					const parts = rest.split(/\s+/);
					const id = parts[0] ?? "";
					const timeout = parseInt(parts[1] ?? "", 10) || 60;
					if (!id) {
						ctx.ui.notify("Usage: /tasks wait <id> [timeout_seconds]", "warning");
						return;
					}
					const task = tasks.find((t) => t.id === id);
					if (!task) {
						ctx.ui.notify(`${id} not found.`, "warning");
						return;
					}
					if (task.status !== "running") {
						return { result: formatTaskDetail(task) };
					}
					ctx.ui.notify(` Waiting for ${id} (max ${formatDuration(timeout)})...`, "info");
					const result = await waitForTask(id, timeout);
					if (!result) {
						ctx.ui.notify(`${id} not found after wait.`, "warning");
						return;
					}
					if (result.status === "running") {
					ctx.ui.notify(
						` ${id} still running after ${formatDuration(timeout)}. Check again.`,
						"info",
					);
					}
					return { result: formatTaskDetail(result) };
				}

				case "cancel":
				case "kill": {
					const id = rest;
					if (!id) {
						ctx.ui.notify("Usage: /tasks cancel <id>", "warning");
						return;
					}
					if (cancelTask(id)) {
						refreshWidget(ctx);
						ctx.ui.notify(`⊘ Cancelled ${id}`, "info");
					} else {
						ctx.ui.notify(`${id} not found or not running.`, "warning");
					}
					return;
				}

				case "clear": {
					const id = rest;
					if (!id) {
						ctx.ui.notify("Usage: /tasks clear <id>", "warning");
						return;
					}
					const idx = tasks.findIndex((t) => t.id === id);
					if (idx === -1) {
						ctx.ui.notify(`${id} not found.`, "warning");
						return;
					}
					const t = tasks[idx]!;
					if (t.status === "running") {
						cancelTask(id);
					}
					tasks.splice(idx, 1);
					refreshWidget(ctx);
					ctx.ui.notify(` Removed ${id}`, "info");
					return;
				}

				case "clear-all":
				case "clear_all": {
					// Cancel running tasks
					for (const t of tasks) {
						if (t.status === "running" && t.proc && !t.proc.killed) {
							t.proc.kill("SIGTERM");
						}
					}
					tasks = [];
					refreshWidget(ctx);
					ctx.ui.notify("Cleared all tasks.", "info");
					return;
				}

				case "stats": {
					const stats = getStats();
					const lines: string[] = [
						"=== Task Stats ===",
						`Total: ${stats.total}`,
						`  Running:   ${stats.running}`,
						`  Completed: ${stats.completed}`,
						`  Failed:    ${stats.failed}`,
						`  Cancelled: ${stats.cancelled}`,
					];
					return { result: lines.join("\n") };
				}

				default: {					ctx.ui.notify(`Unknown subcommand: ${subcmd}. Try: start, list, check, wait, cancel, clear, clear-all, stats`,
						"warning",
					);
					return;
				}
			}
		},
	});

	// ── run_command tool (LLM-callable) ────────────────────────────────

	const runCommandTool = {
		name: "run_command",
		label: "Run Command",
		description: "PROPOSE a command to run on behalf of the user. " +
			"If the step doesn't return the command output, it means that the command was sent to the background as a task. " +
			"You will receive messages with the command's output as it runs. " +
			"To interact with a running command, use the manage_task tool.",
		promptSnippet: "Run a terminal command (optionally sending it to the background).",
		parameters: Type.Object({
			CommandLine: Type.String({ description: "The exact command line string to execute." }),
			Cwd: Type.Optional(Type.String({ description: "The current working directory for the command" })),
			WaitMsBeforeAsync: Type.Optional(Type.Number({ description: "Milliseconds to wait before sending to background" })),
		}),

		async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
			const { CommandLine, Cwd, WaitMsBeforeAsync } = params as {
				CommandLine: string;
				Cwd?: string;
				WaitMsBeforeAsync?: number;
			};

			const entry = startTask(CommandLine, CommandLine, Cwd || ctx.cwd || process.cwd(), ctx);
			const waitMs = WaitMsBeforeAsync || 0;

			if (waitMs > 0) {
				const result = await waitForTask(entry.id, waitMs / 1000);
				if (result && result.status !== "running") {
					return {
						content: [{ type: "text", text: formatTaskDetail(result) }],
						details: { exitCode: result.exitCode, _callArgs: params },
					};
				}
			}

			return {
				content: [
					{
						type: "text",
						text: `Command sent to background as task '${entry.id}'. Use manage_task Action=status TaskId='${entry.id}' to check on it.`,
					},
				],
				details: { taskId: entry.id, _callArgs: params },
			};
		},
	};
	if ((globalThis as any).__pi_patchTool) (globalThis as any).__pi_patchTool(runCommandTool);
	pi.registerTool(runCommandTool);

	// ── manage_task tool (LLM-callable) ────────────────────────────────

	const manageTaskTool = {
		name: "manage_task",
		label: "Manage Task",
		description: "Manage background tasks. Use this tool to list running tasks or interact with tasks that were sent to the background.\n" +
			"Actions: 'list', 'kill', 'status', 'send_input'.",
		promptSnippet: "Interact with background tasks using list, kill, status, or send_input.",
		parameters: Type.Object({
			Action: Type.String({ description: "The action to perform: 'list', 'kill', 'status', 'send_input'" }),
			TaskId: Type.Optional(Type.String({ description: "The task ID to manage." })),
			Input: Type.Optional(Type.String({ description: "The input to send to the task (for 'send_input')." })),
		}),

		async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
			const _execute = async () => {
				const { Action, TaskId, Input } = params as {
					Action: string;
					TaskId?: string;
					Input?: string;
				};

			const refresh = () => refreshWidget(ctx);

			switch (Action) {
				case "list": {
					if (tasks.length === 0) {
						return { content: [{ type: "text", text: "No background tasks running." }], details: {} };
					}
					const lines: string[] = ["Tasks:"];
					for (const t of tasks) lines.push(formatTaskLine(t));
					return { content: [{ type: "text", text: lines.join("\n") }], details: { count: tasks.length } };
				}

				case "kill": {
					if (!TaskId) return { content: [{ type: "text", text: "Error: TaskId required for 'kill'" }], details: {}, isError: true };
					if (cancelTask(TaskId)) {
						refresh();
						return { content: [{ type: "text", text: `Cancelled task '${TaskId}'` }], details: {} };
					}
					return { content: [{ type: "text", text: `Task '${TaskId}' not found or not running.` }], details: {}, isError: true };
				}

				case "status": {
					if (!TaskId) return { content: [{ type: "text", text: "Error: TaskId required for 'status'" }], details: {}, isError: true };
					const task = tasks.find((t) => t.id === TaskId);
					if (!task) return { content: [{ type: "text", text: `Task '${TaskId}' not found.` }], details: {}, isError: true };
					return { content: [{ type: "text", text: formatTaskDetail(task) }], details: { status: task.status } };
				}

				case "send_input": {
					if (!TaskId) return { content: [{ type: "text", text: "Error: TaskId required for 'send_input'" }], details: {}, isError: true };
					const task = tasks.find((t) => t.id === TaskId);
					if (!task || task.status !== "running" || !task.proc) {
						return { content: [{ type: "text", text: `Task '${TaskId}' not found or not running.` }], details: {}, isError: true };
					}
					if (task.proc.stdin) {
						task.proc.stdin.write((Input || "") + "\n");
						return { content: [{ type: "text", text: `Sent input to task '${TaskId}'` }], details: {} };
					}
					return { content: [{ type: "text", text: `Task '${TaskId}' does not accept input.` }], details: {}, isError: true };
				}

				default:
					return { content: [{ type: "text", text: `Unknown Action: ${Action}` }], details: {}, isError: true };
				}
			};
			const res = await _execute();
			(res as any).details = { ...(res.details || {}), _callArgs: params };
			return res;
		},
	};
	if ((globalThis as any).__pi_patchTool) (globalThis as any).__pi_patchTool(manageTaskTool);
	pi.registerTool(manageTaskTool);
}

class TasksUIComponent {
	private mode: "menu" | "view_task" = "menu";
	private optionIndex = 0;
	private input: Input;
	private selectedTask: TaskEntry | null = null;
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
			for (const t of tasks) {
				opts.push({
					label: `${STATUS_ICONS[t.status]} ${t.id} - ${truncate(t.label, 30)}`,
					action: () => { this.selectedTask = t; this.mode = "view_task"; }
				});
			}
			if (tasks.length > 0) {
				opts.push({ label: `${RED}Clear all tasks${RESET}`, action: () => { 
					for (const t of tasks) if (t.status === "running") cancelTask(t.id);
					tasks.length = 0; 
				} });
			}
			return opts;
		} else if (this.mode === "view_task") {
			return [
				{ label: "Back to menu", action: () => { this.mode = "menu"; } },
				{ label: `${RED}Cancel/Clear Task${RESET}`, action: () => {
					if (this.selectedTask) {
						if (this.selectedTask.status === "running") cancelTask(this.selectedTask.id);
						const idx = tasks.indexOf(this.selectedTask);
						if (idx >= 0) tasks.splice(idx, 1);
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
			add(this.theme.fg("text", " Manage Tasks"));
			lines.push("");
			const options = this.getOptions();
			for (let i = 0; i < options.length; i++) {
				const selected = i === this.optionIndex;
				const prefix = selected ? this.theme.fg("accent", "> ") : "  ";
				const label = options[i].label;
				add(prefix + (selected ? this.theme.fg("accent", label) : this.theme.fg("text", label)));
			}
		} else if (this.mode === "view_task" && this.selectedTask) {
			add(this.theme.fg("text", ` Task Details: #${this.selectedTask.id}`));
			lines.push("");
			add(` Status:  ${this.selectedTask.status}`);
			add(` Command: ${this.selectedTask.command}`);
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
