/**
 * Minimal subagents extension.
 *
 * Registers a single `subagent` tool with agents loaded from .md files.
 * Supports single and parallel execution.
 *
 * The model used for subagents is set via the `/sub` command — agents
 * CANNOT specify a model themselves.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter, truncateHead, withFileMutationQueue, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

// ── Self-contained CompactToolBox + emptyComponent (no dependency on betterui) ──
interface _CBOpts {
	toolName: string;
	argsLine: string;
	footer?: string;
	state: "pending" | "done" | "error";
	previewLines?: string[];
	expanded?: boolean;
	footerAlways?: boolean;
	suffix?: string;
	duration?: number;
}

class CompactToolBox implements Component {
	private opts: _CBOpts;
	private cachedWidth?: number;
	private cachedLines?: string[];
	constructor(opts: _CBOpts) { this.opts = opts; }
	invalidate(): void { this.cachedWidth = undefined; this.cachedLines = undefined; }
	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const { toolName, argsLine, suffix, footer, state, previewLines, expanded, footerAlways, duration } = this.opts;
		const lines: string[] = [];
		const star = "";
		const DIM = "\x1b[38;2;140;140;140m";
		const RESET = "\x1b[39m";
		const GREEN = "\x1b[38;2;120;220;120m";
		const INDENT = " ";
		let header = `\x1b[38;2;255;165;0m${toolName}\x1b[0m`;
		if (suffix) header += ` ${suffix}`;
		lines.push(truncateToWidth(header, width));
		if (expanded) {
			const padding = " ".repeat(toolName.length + 1);
			const CONTENT_INDENT = padding + "\u2502 ";
			if (argsLine) lines.push(truncateToWidth(INDENT + CONTENT_INDENT + argsLine, width));
			if (previewLines) for (const pl of previewLines) lines.push(truncateToWidth(INDENT + CONTENT_INDENT + pl, width));
			if (footer) lines.push(truncateToWidth(INDENT + CONTENT_INDENT + DIM + footer + RESET, width));
			// Show finished status for completed state
			if (state === "done") {
				lines.push(truncateToWidth(INDENT + CONTENT_INDENT + "\x1b[97m Finished." + RESET, width));
			}
			// Footer with duration and ctrl+o hint
			if (duration !== undefined && duration >= 0) {
				lines.push(truncateToWidth(INDENT + padding + "\u2514 " + DIM + `Took ${formatDuration(duration)} [ctrl+o to hide]` + RESET, width));
			} else {
				lines.push(truncateToWidth(INDENT + padding + "\u2514 " + DIM + "[ctrl+o to hide]" + RESET, width));
			}
		} else {
			// Single-line compact mode
			const parts: string[] = [`[${truncateToWidth(argsLine, Math.max(10, width - 26))}]`, "(ctrl+o to expand)"];
			header += ` ${parts.join(" ")}`;
			lines[0] = truncateToWidth(header, width);
		}
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}

const emptyComponent = { render: () => [] as string[], invalidate() {}, handleInput() {} };
import { Type } from "typebox";

// ── Subagent Model Storage ──────────────────────────────────────────────
// Stored globally so the /sub command and the subagent tool share state.

const SUBAGENT_MODEL_KEY = "__pi_subagent_model_v1";

function getSubagentModel(): string | undefined {
	return (globalThis as any)[SUBAGENT_MODEL_KEY];
}

function setSubagentModel(model: string): void {
	(globalThis as any)[SUBAGENT_MODEL_KEY] = model;
}

// ── Types ──────────────────────────────────────────────────────────────

export interface AgentConfig {
	name: string;
	description: string;
	tools: string[];
	systemPrompt: string;
	filePath: string;
}

interface ToolEvent {
	tool: string;
	args: string;
}

interface AgentProgress {
	agent: string;
	status: "pending" | "running" | "completed" | "failed";
	task: string;
	currentTool?: string;
	currentToolArgs?: string;
	recentTools: ToolEvent[];
	toolCount: number;
	tokens: number;
	durationMs: number;
	lastMessage: string;
	error?: string;
}

interface AgentResult {
	agent: string;
	task: string;
	output: string;
	exitCode: number;
	progress: AgentProgress;
	model?: string;
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; turns: number };
}

interface Details {
	mode: "single" | "parallel";
	results: AgentResult[];
}

// ── Config ─────────────────────────────────────────────────────────────

interface ExtensionConfig {
	maxConcurrency?: number;
}

const EXT_DIR = path.dirname(
	os.platform() === "win32"
		? new URL(import.meta.url).pathname.replace(/^\//, "")
		: new URL(import.meta.url).pathname,
);
const AGENTS_DIR = path.join(EXT_DIR, "agents");
const TOOLS_DIR = path.join(EXT_DIR, "tools");
const CONFIG_PATH = path.join(EXT_DIR, "config.json");
const DEFAULT_MAX_CONCURRENCY = 4;

// Set from config in the default export; gates concurrent background child processes.
let maxConcurrency = DEFAULT_MAX_CONCURRENCY;

// Captured in the default export so detached background jobs can ping the agent.
let piApi: ExtensionAPI | null = null;

function loadConfig(): ExtensionConfig {
	try {
		if (fs.existsSync(CONFIG_PATH)) {
			return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as ExtensionConfig;
		}
	} catch {}
	return {};
}

// Built-in tools that pi provides natively (no extension needed)
const BUILTIN_TOOLS = new Set(["read", "write", "edit", "bash", "grep", "find", "ls"]);

// Subagent-specific tools that live in the tools/ directory (not shared extensions).
const SUBAGENT_TOOLS: Record<string, string> = {
	safe_bash: path.join(TOOLS_DIR, "safe-bash.ts"),
};

// Dynamically discover all extensions from agent/extensions/.
// Every directory with an index.ts is auto-included, so newly added extensions
// are immediately available to all subagents without any explicit registration.
const EXTENSIONS_DIR = path.resolve(EXT_DIR, "..");

// Extensions with heavy UI side effects (rendering, status bars, spinners, overlays)
// should NOT be loaded into subagent child processes — they conflict with the
// parent's own instances and waste resources. This list is intentionally small
// and only blocks extensions that register global UI components on load.
const EXTENSION_BLOCKLIST = new Set(["compactui", "statusline", "spinner", "header"]); 

let _extCache: { result: string[]; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function discoverAllExtensions(): Promise<string[]> {
	const now = Date.now();
	if (_extCache && (now - _extCache.ts) < CACHE_TTL_MS) {
		return _extCache.result;
	}

	const paths: string[] = [];
	try {
		await fs.promises.access(EXTENSIONS_DIR);
	} catch {
		return paths;
	}

	const entries = await fs.promises.readdir(EXTENSIONS_DIR);
	for (const entry of entries) {
		// Skip blocklisted extensions (heavy UI side effects)
		if (EXTENSION_BLOCKLIST.has(entry)) continue;

		const extPath = path.join(EXTENSIONS_DIR, entry);
		let stat: fs.Stats;
		try {
			stat = await fs.promises.stat(extPath);
		} catch (err) {
			console.debug("[subagents] extension discovery skipped:", entry, (err as Error).message);
			continue;
		}
		if (!stat.isDirectory()) continue;

		// Skip subagents itself to avoid recursion
		if (entry === "subagents") continue;

		// Only load extensions that have an index.ts or index.js file
		const candidates = ["index.ts", "index.js"];
		for (const candidate of candidates) {
			const indexPath = path.join(extPath, candidate);
			try {
				await fs.promises.access(indexPath);
				// Validate via realpath to resolve symlinks correctly
				const realPath = fs.realpathSync(indexPath);
				paths.push(realPath);
				break;
			} catch (err) {
				console.debug("[subagents] extension discovery skipped:", entry, candidate, (err as Error).message);
			}
		}
	}

	const sorted = paths.sort();
	_extCache = { result: sorted, ts: Date.now() };
	return sorted;
}

// ── Agent Discovery & Registration ────────────────────────────────────

let agents: AgentConfig[] = [];

export function registerAgent(config: AgentConfig): void {
	if (agents.find((a) => a.name === config.name)) {
		throw new Error(`Agent already registered: ${config.name}`);
	}
	agents.push(config);
}

export function unregisterAgent(name: string): void {
	agents = agents.filter((a) => a.name !== name);
}

// Expose registration functions globally so other extensions loaded via jiti
// (which creates separate module instances) can access the shared agents array.
(globalThis as any).__pi_subagents = { registerAgent, unregisterAgent };

function loadAgentFiles(agentDir: string, existingNames: Set<string>): AgentConfig[] {
	const agents: AgentConfig[] = [];
	if (!fs.existsSync(agentDir)) return agents;
	for (const entry of fs.readdirSync(agentDir)) {
		if (!entry.endsWith(".md")) continue;
		const filePath = path.join(agentDir, entry);
		const content = fs.readFileSync(filePath, "utf-8");
		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
		if (!frontmatter.name) continue;
		if (existingNames.has(frontmatter.name)) continue;
		const tools = (frontmatter.tools || "")
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		agents.push({
			name: frontmatter.name,
			description: frontmatter.description || "",
			tools,
			systemPrompt: body,
			filePath,
		});
		existingNames.add(frontmatter.name);
	}
	return agents;
}

function loadAgents(): AgentConfig[] {
	const agents: AgentConfig[] = [];
	const registeredNames = new Set<string>();

	// Load agents from the extension's own agents directory
	for (const a of loadAgentFiles(AGENTS_DIR, registeredNames)) {
		agents.push(a);
	}

	return agents;
}

// ── Pi Binary Resolution ──────────────────────────────────────────────

function resolvePiBinary(): { command: string; baseArgs: string[] } {
	// Resolve the pi entry point from process.argv[1]
	const entry = process.argv[1];
	if (entry) {
		try {
			const realEntry = fs.realpathSync(entry);
			if (/\.(?:mjs|cjs|js)$/i.test(realEntry)) {
				return { command: process.execPath, baseArgs: [realEntry] };
			}
		} catch {}
	}
	return { command: "pi", baseArgs: [] };
}

// ── Formatting Utilities ──────────────────────────────────────────────

function formatTokens(n: number): string {
	return n < 1000 ? String(n) : n < 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
	return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// ── Resolve the model to use for a subagent ──────────────────────────

function resolveSubagentModel(parentModel: string | undefined): string {
	// 1. User-set model via /sub command
	const stored = getSubagentModel();
	if (stored && stored !== "auto") return stored;

	// 2. Parent session's model
	if (parentModel) return parentModel;

	// 3. Fallback
	return "auto";
}

// ── Subagent Execution ────────────────────────────────────────────────

async function buildPiArgs(
	agent: AgentConfig,
	task: string,
	cwd: string,
	model: string,
): Promise<{ args: string[]; tempDir: string }> {
	const piBin = resolvePiBinary();
	const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-sub-"));

	// Write system prompt to temp file
	const promptPath = path.join(tempDir, `${agent.name}.md`);
	await withFileMutationQueue(promptPath, async () => {
		await fs.promises.writeFile(promptPath, agent.systemPrompt, { encoding: "utf-8", mode: 0o600 });
	});

	const args = [...piBin.baseArgs, "--mode", "json", "-p", "--no-session", "--no-skills"];

	// --no-extensions disables default auto-loading; we add all extensions back explicitly
	args.push("--no-extensions");

	// Builtin tools the agent's frontmatter opts into
	const builtinTools: string[] = [];
	for (const tool of agent.tools) {
		if (BUILTIN_TOOLS.has(tool)) {
			builtinTools.push(tool);
		}
	}
	if (builtinTools.length > 0) {
		args.push("--tools", builtinTools.join(","));
	} else {
		// No builtin tools needed — disable defaults so only extension tools are available
		args.push("--no-tools");
	}

	// Auto-discover and load extensions from agent/extensions/.
	// Every extension with an index.ts (or index.js) is included, minus blocklisted ones.
	for (const extPath of await discoverAllExtensions()) {
		args.push("--extension", extPath);
	}

	// Subagent-specific tools that live in the tools/ directory
	for (const [, extPath] of Object.entries(SUBAGENT_TOOLS)) {
		if (fs.existsSync(extPath)) {
			args.push("--extension", extPath);
		}
	}

	args.push("--models", model);
	args.push("--append-system-prompt", promptPath);

	// Handle long tasks by writing to file
	const TASK_LIMIT = 8000;
	if (task.length > TASK_LIMIT) {
		const taskPath = path.join(tempDir, "task.md");
		await withFileMutationQueue(taskPath, async () => {
			await fs.promises.writeFile(taskPath, `Task: ${task}`, { encoding: "utf-8", mode: 0o600 });
		});
		args.push(`@${taskPath}`);
	} else {
		args.push(`Task: ${task}`);
	}

	return { args: [piBin.command, ...args], tempDir };
}

function extractTextFromContent(content: unknown): string {
	if (!content) return "";
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("\n");
	}
	return "";
}

function extractToolArgsPreview(args: Record<string, unknown>): string {
	if (args.command) return String(args.command).slice(0, 100);
	if (args.path) return String(args.path);
	if (args.query) return `"${String(args.query).slice(0, 80)}"`;
	if (args.url) return String(args.url);
	if (args.pattern) return String(args.pattern);
	const s = JSON.stringify(args);
	return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

async function runSubagent(
	agent: AgentConfig,
	task: string,
	cwd: string,
	model: string,
	signal: AbortSignal | undefined,
	onUpdate?: (progress: AgentProgress) => void,
): Promise<AgentResult> {
	const { args, tempDir } = await buildPiArgs(agent, task, cwd, model);
	const command = args[0];
	const spawnArgs = args.slice(1);

	const result: AgentResult = {
		agent: agent.name,
		task,
		output: "",
		exitCode: 0,
		model,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		progress: {
			agent: agent.name,
			status: "running",
			task,
			recentTools: [],
			toolCount: 0,
			tokens: 0,
			durationMs: 0,
			lastMessage: "",
		},
	};

	const startTime = Date.now();
	const progress = result.progress;

	const fireUpdate = throttle(() => {
		progress.durationMs = Date.now() - startTime;
		onUpdate?.(progress);
	}, 150);

	// Timer removed: We no longer display a live duration in the UI,
	// so periodic UI updates are unnecessary and cause terminal ghost frames.

	const exitCode = await new Promise<number>((resolve) => {
		const proc = spawn(command, spawnArgs, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let buf = "";
		let stderrBuf = "";

		const processLine = (line: string) => {
			if (!line.trim()) return;
			try {
				const evt = JSON.parse(line) as any;
				progress.durationMs = Date.now() - startTime;

				if (evt.type === "tool_execution_start") {
					progress.toolCount++;
					progress.currentTool = evt.toolName;
					progress.currentToolArgs = extractToolArgsPreview((evt.args || {}) as Record<string, unknown>);
					fireUpdate();
				}

				if (evt.type === "tool_execution_end") {
					if (progress.currentTool) {
						progress.recentTools.push({
							tool: progress.currentTool,
							args: progress.currentToolArgs || "",
						});
						// Keep last 20
						if (progress.recentTools.length > 20) {
							progress.recentTools.splice(0, progress.recentTools.length - 20);
						}
					}
					progress.currentTool = undefined;
					progress.currentToolArgs = undefined;
					fireUpdate();
				}

				if (evt.type === "tool_result_end") {
					fireUpdate();
				}

				if (evt.type === "message_end" && evt.message) {
					if (evt.message.role === "assistant") {
						result.usage.turns++;
						const u = evt.message.usage;
						if (u) {
							result.usage.input += u.input || 0;
							result.usage.output += u.output || 0;
							result.usage.cacheRead += u.cacheRead || 0;
							result.usage.cacheWrite += u.cacheWrite || 0;
							result.usage.cost += u.cost?.total || 0;
							progress.tokens = result.usage.input + result.usage.output;
						}
						if (evt.message.model) result.model = evt.message.model;
						if (evt.message.errorMessage) progress.error = evt.message.errorMessage;

						const text = extractTextFromContent(evt.message.content);
						if (text) {
							result.output = text;
							// Extract just the prose "thinking" text — skip code blocks
							const proseLines: string[] = [];
							let inCodeBlock = false;
							for (const line of text.split("\n")) {
								if (line.trimStart().startsWith("```")) {
									inCodeBlock = !inCodeBlock;
									continue;
								}
								if (!inCodeBlock && line.trim()) {
									proseLines.push(line.trim());
								}
							}
							if (proseLines.length > 0) {
								progress.lastMessage = proseLines.slice(0, 3).join(" ");
							}
						}
					}

					fireUpdate();
				}
			} catch {
				// Non-JSON lines are expected
			}
		};

		proc.stdout.on("data", (d: Buffer) => {
			buf += d.toString();
			const lines = buf.split("\n");
			buf = lines.pop() || "";
			lines.forEach(processLine);
		});

		proc.stderr.on("data", (d: Buffer) => {
			stderrBuf += d.toString();
		});

		proc.on("close", (code) => {
			if (buf.trim()) processLine(buf);
			if (code !== 0 && stderrBuf.trim() && !progress.error) {
				progress.error = stderrBuf.trim();
			}
			resolve(code ?? 1);
		});

		proc.on("error", () => resolve(1));

		if (signal) {
			const kill = () => {
				proc.kill("SIGTERM");
				setTimeout(() => !proc.killed && proc.kill("SIGKILL"), 3000);
			};
			if (signal.aborted) kill();
			else signal.addEventListener("abort", kill, { once: true });
		}
	});

	// Timer interval cleared

	// Cleanup temp dir
	try {
		fs.rmSync(tempDir, { recursive: true, force: true });
	} catch {}

	result.exitCode = exitCode;
	progress.status = exitCode === 0 && !progress.error ? "completed" : "failed";
	progress.durationMs = Date.now() - startTime;
	if (progress.error) result.output = result.output || `Error: ${progress.error}`;

	// Truncate output if very large
	if (result.output.length > DEFAULT_MAX_BYTES) {
		const trunc = truncateHead(result.output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
		result.output = trunc.content;
		if (trunc.truncated) {
			result.output += "\n\n[Output truncated]";
		}
	}

	return result;
}

// ── Throttle ──────────────────────────────────────────────────────────

function throttle<T extends (...args: any[]) => void>(fn: T, ms: number): T {
	let lastCall = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	return ((...args: any[]) => {
		const now = Date.now();
		const remaining = ms - (now - lastCall);
		if (remaining <= 0) {
			lastCall = now;
			if (timer) { clearTimeout(timer); timer = undefined; }
			fn(...args);
		} else if (!timer) {
			timer = setTimeout(() => {
				lastCall = Date.now();
				timer = undefined;
				fn(...args);
			}, remaining);
		}
	}) as T;
}

// ── Parallel Execution with Concurrency Limit ─────────────────────────

async function mapConcurrent<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < items.length) {
			const i = nextIndex++;
			results[i] = await fn(items[i], i);
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}

// ── Background Job Registry ────────────────────────────────────────────
// Subagent tool calls are always launched as detached background jobs. The
// tool returns immediately with an acknowledgment; when a job (or a batch of
// parallel jobs) finishes, the agent is pinged via a follow-up user message
// carrying the full output. Modeled on the tasks extension.

type JobStatus = "running" | "completed" | "failed";

interface SubagentJob {
	id: number;
	batchId: number;
	agent: string;
	task: string;
	status: JobStatus;
	startedAt: number;
	completedAt?: number;
	controller: AbortController;
	result?: AgentResult;
}

let jobs: SubagentJob[] = [];
let jobCounter = 0;
let batchCounter = 0;
const MAX_JOBS_KEPT = 100;

// pi core reads __pi_subagent_running_count to know work is in flight; keep it
// accurate across the detached job lifecycle (increment at launch, decrement
// at true completion — NOT when the tool call returns).
function incRunningCount(): void {
	(globalThis as any).__pi_subagent_running_count = ((globalThis as any).__pi_subagent_running_count ?? 0) + 1;
}
function decRunningCount(): void {
	(globalThis as any).__pi_subagent_running_count = Math.max(0, ((globalThis as any).__pi_subagent_running_count ?? 1) - 1);
}

// Global concurrency gate shared across all background jobs.
let activeSlots = 0;
const slotWaiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
	if (activeSlots < maxConcurrency) {
		activeSlots++;
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => slotWaiters.push(resolve));
}

function releaseSlot(): void {
	const next = slotWaiters.shift();
	if (next) {
		// Hand the occupied slot directly to the next waiter.
		next();
	} else {
		activeSlots = Math.max(0, activeSlots - 1);
	}
}

function trimJobs(): void {
	const finished = jobs.filter((j) => j.status !== "running");
	if (finished.length > MAX_JOBS_KEPT) {
		const excess = finished.length - MAX_JOBS_KEPT;
		const toRemove = new Set(finished.slice(0, excess).map((j) => j.id));
		jobs = jobs.filter((j) => !toRemove.has(j.id));
	}
}

function buildJobOutput(job: SubagentJob): string {
	const icon = job.status === "completed" ? "✅" : "❌";
	const header = `${icon} Subagent job #${job.id} (${job.agent})`;
	const body = job.result?.output || (job.status === "failed" ? "(failed — no output)" : "(no output)");
	return `${header}\n\n${body}`;
}

// Sent once per batch, when the LAST job in the batch finishes.
function sendBatchPing(batchJobs: SubagentJob[], hasUI: boolean, ctx: ExtensionContext): void {
	const ids = batchJobs.map((j) => `#${j.id}`).join(", ");
	const ok = batchJobs.filter((j) => j.status === "completed").length;
	const summary =
		batchJobs.length === 1
			? `Background subagent job ${ids} (${batchJobs[0].agent}) finished.`
			: `${batchJobs.length} background subagent jobs (${ids}) finished — ${ok}/${batchJobs.length} succeeded.`;
	const msg = `${summary}\n\n${batchJobs.map(buildJobOutput).join("\n\n---\n\n")}`;

	if (piApi?.sendUserMessage) {
		try {
			const res = piApi.sendUserMessage(msg, { deliverAs: "followUp" }) as unknown;
			if (res && typeof (res as Promise<void>).then === "function") {
				(res as Promise<void>).catch(() => {});
			}
		} catch {}
	}

	if (hasUI) {
		try {
			ctx.ui.notify?.(`Subagent ${ok}/${batchJobs.length} job(s) finished (${ids})`, ok === batchJobs.length ? "info" : "warning");
		} catch {}
	}
}

// Launch a batch of jobs detached. Returns the job records immediately.
function launchBatch(
	entries: { agent: AgentConfig; task: string; cwd: string }[],
	model: string,
	hasUI: boolean,
	ctx: ExtensionContext,
): SubagentJob[] {
	const batchId = ++batchCounter;
	const batchJobs: SubagentJob[] = entries.map((e) => {
		const job: SubagentJob = {
			id: ++jobCounter,
			batchId,
			agent: e.agent.name,
			task: e.task,
			status: "running",
			startedAt: Date.now(),
			controller: new AbortController(),
		};
		jobs.push(job);
		incRunningCount();
		return job;
	});

	let remaining = batchJobs.length;

	batchJobs.forEach((job, idx) => {
		const entry = entries[idx];
		void (async () => {
			await acquireSlot();
			try {
				const result = await runSubagent(entry.agent, entry.task, entry.cwd, model, job.controller.signal);
				job.result = result;
				job.status = result.exitCode === 0 && !result.progress.error ? "completed" : "failed";
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				job.status = "failed";
				job.result = {
					agent: job.agent,
					task: job.task,
					output: `Error: ${message}`,
					exitCode: 1,
					model,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
					progress: {
						agent: job.agent,
						status: "failed",
						task: job.task,
						recentTools: [],
						toolCount: 0,
						tokens: 0,
						durationMs: Date.now() - job.startedAt,
						lastMessage: "",
						error: message,
					},
				};
			} finally {
				job.completedAt = Date.now();
				releaseSlot();
				decRunningCount();
			}

			remaining--;
			if (remaining === 0) sendBatchPing(batchJobs, hasUI, ctx);
		})();
	});

	trimJobs();
	return batchJobs;
}

// ── Load known models for autocomplete suggestions ───────────────────
// Merge enabledModels (settings.json) + all provider models (models.json).
// This is best-effort — user can still type any model name.

const AGENT_DIR = getAgentDir();

function loadSuggestions(modelRegistry?: ModelRegistry): string[] {
	const models = new Set<string>();

	// 1. All available models from model registry (built-in + custom)
	if (modelRegistry) {
		try {
			const available = modelRegistry.getAvailable();
			for (const m of available) {
				models.add(`${m.provider}/${m.id}`);
			}
		} catch {}
	}

	// 2. enabledModels from settings.json (covers packages)
	try {
		const sp = path.join(AGENT_DIR, "settings.json");
		if (fs.existsSync(sp)) {
			const raw = JSON.parse(fs.readFileSync(sp, "utf-8"));
			const enabled = raw.enabledModels;
			if (Array.isArray(enabled)) {
				for (const m of enabled) {
					if (typeof m === "string") models.add(m);
				}
			}
		}
	} catch {}

	// 3. All provider models from models.json (covers provider configs)
	try {
		const mp = path.join(AGENT_DIR, "models.json");
		if (fs.existsSync(mp)) {
			const raw = JSON.parse(fs.readFileSync(mp, "utf-8"));
			const providers = raw.providers;
			if (providers && typeof providers === "object") {
				for (const [pid, pv] of Object.entries(providers)) {
					const pModels = (pv as any).models;
					if (!Array.isArray(pModels)) continue;
					for (const m of pModels) {
						if (m && typeof m.id === "string") {
							models.add(`${pid}/${m.id}`);
						}
					}
				}
			}
		}
	} catch {}

	return [...models].sort();
}

// ── Autocomplete Component ────────────────────────────────────────────
// Text input with live-filtered model suggestions.

const MAX_VISIBLE_SUGGESTIONS = 8;

class SubagentAutocompleteComponent {
	private readonly input: Input;
	private readonly allModels: string[];
	private filtered: string[] = [];
	private selectedIdx = 0;
	private lastInputValue = "";
	public onDone: ((result: string | null) => void) | undefined;
	private currentModel: string;

	constructor(
		private readonly tui: { requestRender: () => void },
		private readonly theme: {
			fg: (name: string, text: string) => string;
			bold: (text: string) => string;
		},
		initialValue: string,
		modelRegistry?: ModelRegistry,
		currentModel?: string,
	) {
		this.currentModel = currentModel || "";
		this.allModels = loadSuggestions(modelRegistry);
		this.input = new Input();
		this.input.setValue(initialValue);
		this.lastInputValue = initialValue;
		this.input.onSubmit = (value) => {
			// If there's a highlighted suggestion, use it
			if (this.filtered.length > 0 && this.selectedIdx < this.filtered.length) {
				this.onDone?.(this.filtered[this.selectedIdx]);
			} else {
				const trimmed = value.trim();
				if (trimmed) {
					this.onDone?.(trimmed);
				}
			}
		};
		this.input.onEscape = () => {
			this.onDone?.(null);
		};
		this.updateFilter();
	}

	get focused(): boolean {
		return this.input.focused;
	}

	set focused(v: boolean) {
		this.input.focused = v;
	}

	private updateFilter(): void {
		const query = this.input.value.toLowerCase();
		if (!query) {
			this.filtered = [];
		} else {
			this.filtered = this.allModels.filter((m) => m.toLowerCase().includes(query));
		}
		this.selectedIdx = 0;
	}

	handleInput(data: string): void {
		// ↑↓ navigate suggestions (don't set input value)
		if (matchesKey(data, Key.down)) {
			if (this.filtered.length > 0) {
				this.selectedIdx = Math.min(this.filtered.length - 1, this.selectedIdx + 1);
				this.tui.requestRender();
			}
			return;
		}
		if (matchesKey(data, Key.up)) {
			if (this.filtered.length > 0) {
				this.selectedIdx = Math.max(0, this.selectedIdx - 1);
				this.tui.requestRender();
			}
			return;
		}

		// Let Input handle text entry, backspace, enter, escape
		this.input.handleInput(data);

		// If value changed, update filter
		if (this.input.value !== this.lastInputValue) {
			this.lastInputValue = this.input.value;
			this.updateFilter();
		}

		this.tui.requestRender();
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const add = (text: string) => lines.push(truncateToWidth(text, width));
		const arrow = this.theme.fg("accent", "─".repeat(Math.max(0, width - 1)));

		add(arrow);
		const title = this.currentModel 
			? this.theme.fg("accent", this.theme.bold(` Subagent Model: ${this.currentModel}`))
			: this.theme.fg("accent", this.theme.bold(" Subagent Model"));
		add(title);
		lines.push("");

		// Input field
		if (this.input.value) {
			const inputLines = this.input.render(Math.max(8, width - 4));
			for (const line of inputLines) {
				add(` ${line}`);
			}
		} else {
			add(`> ${this.theme.fg("dim", "Type to search model...")}`);
		}

		// Suggestions
		if (this.filtered.length > 0) {
			lines.push("");
			const total = this.filtered.length;
			const half = Math.floor(MAX_VISIBLE_SUGGESTIONS / 2);
			const start = Math.max(0, Math.min(this.selectedIdx - half, total - MAX_VISIBLE_SUGGESTIONS));
			const end = Math.min(total, start + MAX_VISIBLE_SUGGESTIONS);

			if (start > 0) {
				add(this.theme.fg("dim", ` ↑ ${start} more...`));
			}
			for (let i = start; i < end; i++) {
				const selected = i === this.selectedIdx;
				const marker = selected ? this.theme.fg("accent", "▸ ") : "  ";
				const label = selected
					? this.theme.fg("accent", this.filtered[i])
					: this.theme.fg("text", this.filtered[i]);
				add(`${marker}${label}`);
			}
			if (end < total) {
				add(this.theme.fg("dim", ` ↓ ${total - end} more...`));
			}
		} else if (this.input.value.trim()) {
			lines.push("");
			add(this.theme.fg("dim", " (no matching models)"));
		}

		lines.push("");
		add(this.theme.fg("dim", "Type to filter · ↑↓ navigate · Enter select · Esc cancel"));
		add(arrow);
		return lines;
	}

	invalidate(): void {
		this.input.invalidate();
	}
}

// ── Extension ─────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// Capture the API so detached background jobs can ping the agent on completion.
	piApi = pi;

	// Self-register in global feature registry
	(globalThis as any).__pi_extension_features?.push({
		name: "subagents",
		description: "Run isolated child pi processes in the background; results are delivered as a follow-up message when each finishes",
		tools: ["subagent"],
		commands: ["/sub", "/jobs"],
	});

	const config = loadConfig();
	maxConcurrency = config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
	agents = loadAgents();

	// Kill any in-flight background jobs when the session shuts down.
	pi.on("session_shutdown", () => {
		for (const j of jobs) {
			if (j.status === "running") {
				try { j.controller.abort(); } catch {}
			}
		}
	});

	// ── Command: /sub ────────────────────────────────
	pi.registerCommand("sub", {
		description: "Set model for subagents. /sub <model> to set, /sub alone opens interactive picker.",
		handler: async (_args, ctx) => {
			const current = getSubagentModel() || "";
			const args = typeof _args === "string" ? _args.trim() : "";

			if (args) {
				setSubagentModel(args);
				ctx.ui.notify?.(`Subagents will use: ${args}`, "success");
				return;
			}

			if (!ctx.hasUI) {
				const sessionModel = ctx.model
					? `${(ctx.model as any).provider}/${(ctx.model as any).id}`
					: "unknown";
				ctx.ui.notify?.(
					`Subagent model: ${current} (session: ${sessionModel}). Usage: /sub <model>`,
					"info",
				);
				return;
			}

			// Interactive mode: open autocomplete dialog
			while (true) {
				const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
					const component = new SubagentAutocompleteComponent(tui, theme, "", ctx.modelRegistry, current);
					component.onDone = done;
					component.focused = true;
					return component;
				});

				if (result === null) {
					ctx.ui.notify?.("Subagent model unchanged.", "info");
					return;
				}

				const trimmed = result.trim();
				if (!trimmed) {
					ctx.ui.notify?.("Model cannot be empty.", "error");
					continue;
				}

				setSubagentModel(trimmed);
				ctx.ui.notify?.(`Subagents will use: ${trimmed}`, "success");
				return;
			}
		},
	});

	// ── Command: /jobs ───────────────────────────────
	// List background subagent jobs, or `/jobs <id>` to show one job's output.
	pi.registerCommand("jobs", {
		description: "List background subagent jobs and their status. /jobs <id> shows a job's full output.",
		handler: async (_args, ctx) => {
			const arg = (typeof _args === "string" ? _args : "").trim().replace(/^#/, "");

			if (arg) {
				const id = parseInt(arg, 10);
				const job = Number.isNaN(id) ? undefined : jobs.find((j) => j.id === id);
				if (!job) {
					ctx.ui.notify?.(`No subagent job #${arg}.`, "warning");
					return;
				}
				const dur = formatDuration((job.completedAt ?? Date.now()) - job.startedAt);
				const out = job.result?.output || (job.status === "running" ? "(still running…)" : "(no output)");
				ctx.ui.notify?.(`#${job.id} ${job.agent} [${job.status}] · ${dur}\n\n${out.slice(0, 4000)}`, "info");
				return;
			}

			if (jobs.length === 0) {
				ctx.ui.notify?.("No subagent jobs yet.", "info");
				return;
			}

			const running = jobs.filter((j) => j.status === "running").length;
			const lines = jobs.slice(-20).map((j) => {
				const icon = j.status === "completed" ? "✓" : j.status === "failed" ? "✗" : "⟳";
				const dur = formatDuration((j.completedAt ?? Date.now()) - j.startedAt);
				const task = j.task.replace(/\s+/g, " ").slice(0, 50);
				return `${icon} #${j.id} ${j.agent} [${j.status}] · ${dur} — ${task}`;
			});
			const head = `Subagent jobs (${running} running, ${jobs.length} total) — /jobs <id> for full output`;
			ctx.ui.notify?.(`${head}\n${lines.join("\n")}`, "info");
		},
	});

	// ── Tool: subagent ─────────────────────────────
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description:
			"Launch a subagent to complete a task IN THE BACKGROUND. The call returns immediately with a job id; the subagent's full output arrives later as a follow-up message when it finishes. Do NOT wait or poll for it — continue with other work. " +
			"Subagents have NO context from the current conversation — include all necessary context in the task description. " +
			"The model for subagents is set via the /sub command — the agent cannot override it.",
		promptSnippet: "Delegate tasks to background subagents",
		promptGuidelines: [
			"Subagents run in the BACKGROUND: the tool returns a job id right away and you are pinged with the full output via a follow-up message when the job finishes. Never wait or poll — launch the job, then keep working. Use /jobs to inspect status.",
			"When you have 2+ independent subagent tasks, ALWAYS use parallel mode with a SINGLE subagent call (tasks: [...]), never multiple separate subagent calls. A parallel batch delivers one consolidated follow-up message when all jobs finish.",
			"Parallel tool calls are your primary parallelism mechanism — put multiple independent read/fetch/search calls in one function_calls block. Don't use subagents to parallelize simple I/O.",
			"Use subagent to delegate *reasoning and decisions*: codebase exploration (scout), web research (researcher), or isolated code changes (worker)",
			"Subagents have NO context from the current conversation — include ALL necessary context in the task description",
			"The model for subagents is set via the /sub command and cannot be overridden in the tool call.",
		],
		parameters: Type.Object({
			agent: Type.Optional(
				Type.String({ description: "Name of the agent to invoke (SINGLE mode)" }),
			),
			task: Type.Optional(Type.String({ description: "Task description (SINGLE mode)" })),

			tasks: Type.Optional(
				Type.Array(
					Type.Object({
						agent: Type.String({ description: "Name of the agent to invoke" }),
						task: Type.String({ description: "Task description" }),
						cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
					}),
					{ description: "PARALLEL mode: array of {agent, task} objects" },
				),
			),
			cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
		}),

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cwd = ctx.cwd;
			const parentModel = ctx.model ? `${(ctx.model as any).provider}/${ctx.model.id}` : undefined;
			const resolvedModel = resolveSubagentModel(parentModel);
			const available = agents.map((a) => a.name).join(", ") || "none";

			// Build the batch of {agent, task, cwd} entries from either mode.
			let entries: { agent: AgentConfig; task: string; cwd: string }[];
			if (params.tasks && params.tasks.length > 0) {
				entries = params.tasks.map((t) => {
					const agent = agents.find((a) => a.name === t.agent);
					if (!agent) throw new Error(`Unknown agent: ${t.agent}. Available agents: ${available}`);
					return { agent, task: t.task, cwd: t.cwd ?? cwd };
				});
			} else if (params.agent && params.task) {
				const agent = agents.find((a) => a.name === params.agent);
				if (!agent) throw new Error(`Unknown agent: ${params.agent}. Available agents: ${available}`);
				entries = [{ agent, task: params.task, cwd: params.cwd ?? cwd }];
			} else {
				throw new Error("Provide either (agent + task) for single mode, or tasks[] for parallel mode.");
			}

			// Launch detached; return immediately. Completion is delivered as a
			// follow-up user message (the "ping") from launchBatch → sendBatchPing.
			const launched = launchBatch(entries, resolvedModel, ctx.hasUI, ctx);
			const ids = launched.map((j) => `#${j.id}`).join(", ");
			const ack =
				launched.length === 1
					? `Started background subagent job ${ids} (${launched[0].agent}). It runs in the background — you will receive a follow-up message with its full output when it finishes. Do not wait or poll; continue with other work. Use /jobs to check status.`
					: `Started ${launched.length} background subagent jobs (${ids}). They run in the background — you will receive a follow-up message with their full output once all finish. Do not wait or poll; continue with other work. Use /jobs to check status.`;

			return { content: [{ type: "text", text: ack }] };
		},

		renderShell: "self",

		// ── Render: tool call header ──
		renderCall() { return emptyComponent; },

		// ── Render: result ──
		renderResult(result, { isPartial, expanded }) {
			if (isPartial) {
			const details = result.details as Details | undefined;

			if (details?.mode === "parallel" && details.results.length > 1) {
				const done = details.results.filter((r) => r.progress?.status === "completed").length;
				const argsLine = `${done}/${details.results.length} tasks`;
				return new CompactToolBox({
					toolName: "subagent",
					argsLine,
					state: "pending",
				});
			}

			const r = details?.results?.[0];
			const agentName = r?.agent || "subagent";
			let statusText = "working";
			if (r?.progress?.currentTool) {
				statusText = r.progress.currentTool; // Show actual tool name like "bash", "edit"
			} else if (r?.progress?.lastMessage) {
				statusText = "thinking";
			}

			return new CompactToolBox({
				toolName: "subagent",
				argsLine: `${agentName}: ${statusText}`,
				state: "pending",
			});
		}
			const details = result.details as Details | undefined;
			if (!details?.results?.length) {
				const t = result.content[0];
				const text = t?.type === "text" ? t.text : "(no output)";
				const isError = result.isError || text.startsWith("Error");
				let argsLine = text.split("\n")[0];
				if (!expanded && argsLine.length > 80) argsLine = argsLine.slice(0, 77) + "...";
				
				let previewLines: string[] | undefined;
				if (expanded) {
					previewLines = text.split("\n").slice(1).map((l) => l.length > 120 ? l.slice(0, 117) + "..." : l);
				}
				
				return new CompactToolBox({
					toolName: "subagent",
					argsLine,
					state: isError ? "error" : "done",
					duration: 0,
					previewLines,
					expanded,
				});
			}

			const results = details.results;
			const hasErrors = results.some((r) => r.exitCode !== 0 || !!r.progress?.error);
			const isRunning = results.some((r) => r.progress?.status === "running");

			let state: "pending" | "done" | "error";
			if (isRunning) state = "pending";
			else if (hasErrors) state = "error";
			else state = "done";

			if (details.mode === "parallel") {
				// Parallel: one-line summary
				const agentNames = results.map((r) => r.agent).join(", ");
				const ok = results.filter((r) => r.exitCode === 0).length;
				const totalDuration = Math.max(...results.map((r) => r.progress?.durationMs || 0));
				const totalTokens = results.reduce((s, r) => s + (r.progress?.tokens || 0), 0);
				const argsLine = `${ok}/${results.length} tasks: ${agentNames.length > 50 ? agentNames.slice(0, 47) + "..." : agentNames}`;
				const footer = `${ok}/${results.length} completed · ${formatTokens(totalTokens)} tok · ${formatDuration(totalDuration)}`;
				let previewLines: string[] | undefined;
				if (expanded) {
					previewLines = results.map((r) => {
						const icon = r.exitCode === 0 ? "✓" : r.progress?.status === "running" ? "⟳" : "✗";
						const dur = r.progress?.durationMs ? formatDuration(r.progress.durationMs) : "";
						return `${icon} ${r.agent} — ${r.progress?.toolCount || 0} tools · ${formatTokens(r.progress?.tokens || 0)} tok${dur ? " · " + dur : ""}`;
					});
				}
				const parDuration = Math.max(...results.map((r) => r.progress?.durationMs || 0));
				return new CompactToolBox({ toolName: "subagent", argsLine, state, previewLines, footer, expanded, footerAlways: true, duration: parDuration });
			} else {
				// Single agent
				const r = results[0];
				const taskPreview = r.task.length > 60 ? r.task.slice(0, 60) + "…" : r.task.replace(/\n/g, " ");
				const footer = `${r.progress?.toolCount || 0} tools · ${formatTokens(r.progress?.tokens || 0)} tok · ${formatDuration(r.progress?.durationMs || 0)}`;
				let previewLines: string[] | undefined;
				if (expanded) {
					const lines: string[] = [];
					// Show recent tools (most recent first), up to 3
					const tools = r.progress?.recentTools || [];
					for (let i = tools.length - 1; i >= 0 && lines.length < 3; i--) {
						lines.push(`  ${tools[i].tool}: ${tools[i].args}`);
					}
					// Show last message/thinking, up to 1 line
					if (r.progress?.lastMessage && lines.length < 5) {
						lines.push(r.progress.lastMessage);
					}
					// Show output to fill remaining (up to 5 total)
					if (r.output && !isRunning) {
						const out = r.output.split("\n").filter((l) => l.trim());
						const remaining = 5 - lines.length;
						for (let i = 0; i < Math.min(remaining, out.length); i++) {
							lines.push(out[i].length > 120 ? out[i].slice(0, 117) + "..." : out[i]);
						}
					}
					if (r.progress?.error) {
						lines.push(`Error: ${r.progress.error}`);
					}
					previewLines = lines.slice(0, 5).map((l) => l.length > 120 ? l.slice(0, 117) + "..." : l);
				}
				return new CompactToolBox({
					toolName: "subagent",
					argsLine: `${r.agent}: ${taskPreview}`,
					state,
					duration: r.progress?.durationMs || 0,
					previewLines,
					footer,
					expanded,
					footerAlways: true,
				});
			}
		},
	});

	// ── Inject agent list into system prompt ───
	pi.on("before_agent_start", async (_event, ctx) => {
		const currentModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "default";
		const subagentModel = getSubagentModel() || `inherited (${currentModel})`;
		const list = agents
			.map((a) => {
				return `- ${a.name}: ${a.description}`;
			})
			.join("\n");
		return {
			systemPrompt:
				_event.systemPrompt +
				`\n\n## Available Subagents\nUse the \`subagent\` tool to delegate tasks to these specialized agents:\n${list}\n\nSubagents run with the model set via the \`/sub\` command (current: ${subagentModel}). Agents cannot specify their own model.\n\nIMPORTANT: Subagents run in the BACKGROUND. The \`subagent\` tool returns a job id immediately and you receive the full output later as a follow-up message when the job finishes — do NOT wait or poll, just continue with other work. Check status any time with \`/jobs\`.\n\nFor multiple independent tasks, always use a SINGLE subagent call with tasks:[] (parallel mode), never multiple separate subagent calls; a parallel batch sends one consolidated follow-up message when all jobs finish.`,
		};
	});
}
