import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	isEditToolResult,
	isToolCallEventType,
	isWriteToolResult,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { createRequire } from "node:module";

// Check that npm dependency 'diff' is installed — avoid crash on missing deps
const _require = createRequire(import.meta.url);
let _diffCreateTwoFilesPatch: ((oldFile: string, newFile: string, oldStr: string, newStr: string, oldHeader: string, newHeader: string, opts?: { context?: number }) => string) | undefined;
try {
	const diffModule = _require("diff");
	_diffCreateTwoFilesPatch = diffModule.createTwoFilesPatch;
} catch {
	console.warn("[filechanges] Missing npm dep 'diff'. Run `npm install` in agent/extensions/filechanges/. File diff features disabled.");
}

// Custom session entry types
// New name: filechanges
const ENTRY_BASELINE = "filechanges:baseline";
const ENTRY_CLEAR = "filechanges:clear";
const ENTRY_UNTRACK = "filechanges:untrack";

type Baseline = {
	path: string; // normalized path relative to ctx.cwd where possible
	absPath: string;
	originalContent: string | null; // null => file did not exist (created)
	createdAt: number;
};

type TrackedFile = {
	path: string;
	absPath: string;
	displayPath: string;
	originalContent: string | null;
	currentContent: string;
	diff: string;
	added: number;
	removed: number;
	kind: "new" | "edited";
	updatedAt: number;
};

type PendingSnapshot = {
	path: string;
	absPath: string;
	before: string | null;
};

function stripAtPrefix(p: string): string {
	return p.startsWith("@") ? p.slice(1) : p;
}

function normalizeToolPath(cwd: string, raw: string): { absPath: string; relPath: string } {
	const cleaned = stripAtPrefix(raw);
	const absPath = resolve(cwd, cleaned);
	// Use relative path for storage/UI when possible. If it escapes cwd, keep the cleaned input.
	const rel = relative(cwd, absPath);
	const relPath = rel && !rel.startsWith("..") && rel !== "" ? rel : cleaned;
	return { absPath, relPath };
}

async function readTextOrNull(absPath: string): Promise<string | null> {
	try {
		return await readFile(absPath, "utf-8");
	} catch {
		return null;
	}
}

function countDiffLines(unifiedDiff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of unifiedDiff.split("\n")) {
		if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@")) continue;
		if (line.startsWith("+")) added++;
		else if (line.startsWith("-")) removed++;
	}
	return { added, removed };
}

function formatAddedRemovedPlain(added: number, removed: number): string {
	return `(+${added}/-${removed})`;
}


function formatStatus(tracked: Map<string, TrackedFile>, theme?: any): string | undefined {
	if (tracked.size === 0) return undefined;
	let edited = 0;
	let created = 0;
	for (const t of tracked.values()) {
		if (t.kind === "new") created++;
		else edited++;
	}
	if (!theme) {
			return `Δ ${edited}  + ${created}`;
		}
	return theme.fg("muted", `Δ ${edited}  + ${created}`);
}

function buildWidgetLines(tracked: Map<string, TrackedFile>, theme?: any): string[] | undefined {
	if (tracked.size === 0) return undefined;
	const items = [...tracked.values()].sort((a, b) => b.updatedAt - a.updatedAt);
	const max = 8;
	const lines: string[] = [];

	// Separator between chat history and this widget (widget renders above the editor).
	//const sep = "─".repeat(60);
	//lines.push(theme ? theme.fg("borderMuted", sep) : sep);

	for (const t of items.slice(0, max)) {
		const tag = t.kind === "new" ? "+" : "Δ";

		if (!theme) {
			lines.push(`${tag} ${t.displayPath} ${formatAddedRemovedPlain(t.added, t.removed)}`);
			continue;
		}

		const prefix = theme.fg("muted", `${tag} `) + theme.fg("muted", `${t.displayPath} `);
		let counts: string;
		const plus = t.added === 0 ? theme.fg("text", `+${t.added}`) : theme.fg("success", `+${t.added}`);
		const minus = t.removed === 0 ? theme.fg("text", `-${t.removed}`) : theme.fg("error", `-${t.removed}`);
		counts = theme.fg("text", "(") + plus + theme.fg("text", "/") + minus + theme.fg("text", ")");

		lines.push(prefix + counts);
	}
	if (items.length > max) {
		lines.push(theme ? theme.fg("dim", `…and ${items.length - max} more`) : `…and ${items.length - max} more`);
	}
	return lines;
}

function patchFromBaseline(displayPath: string, original: string | null, current: string): string {
	if (!_diffCreateTwoFilesPatch) return "// diff unavailable — install 'diff' npm package";
	return _diffCreateTwoFilesPatch(
		displayPath,
		displayPath,
		original ?? "",
		current,
		"",
		"",
		{ context: 3 }
	);
}

async function ensureParentDir(absPath: string): Promise<void> {
	await mkdir(dirname(absPath), { recursive: true });
}

export default function (pi: ExtensionAPI) {
	// Bail out if npm dependencies are missing
	if (!_diffCreateTwoFilesPatch) {
		console.warn("[filechanges] Extension disabled: missing npm dependency 'diff'.");
		(globalThis as any).__pi_extension_features?.push({
			name: "filechanges",
			description: "File change tracking (DISABLED — missing dep 'diff')",
			status: "disabled",
		});
		return;
	}

	// Self-register in global feature registry
	(globalThis as any).__pi_extension_features?.push({
		name: "filechanges",
		description: "Track file modifications (edits, writes) per session with diff viewing, accept, and decline",
		commands: ["/filechanges", "/filechanges-accept", "/filechanges-decline"],
	});

	// In-memory state (reconstructed on session_start from custom entries)
	const baselines = new Map<string, Baseline>(); // key: relPath
	const tracked = new Map<string, TrackedFile>(); // key: relPath

	// Per-tool-call snapshot, only committed on successful tool_result
	const pendingByToolCallId = new Map<string, PendingSnapshot>();

	let widgetHidden = true;

	function updateUi(ctx: any) {
		if (!ctx?.hasUI) return;

		// Expose raw counts for the statusline extension
		let edited = 0, created = 0;
		for (const t of tracked.values()) {
			if (t.kind === "new") created++;
			else edited++;
		}
		(globalThis as any).__pi_filechanges_counts = { edited, created };

		// Expose file changes lines for the todos widget — respect widgetHidden
		(globalThis as any).__pi_filechanges_lines = widgetHidden ? [] : (buildWidgetLines(tracked, ctx.ui.theme) ?? []);

		const fcStatus = formatStatus(tracked, ctx.ui.theme);
		ctx.ui.setStatus("filechanges", fcStatus);

		// File changes now rendered by todos widget
		ctx.ui.setWidget("filechanges", undefined);
	}

	async function recomputeTrackedFile(ctx: any, relPath: string) {
		const baseline = baselines.get(relPath);
		if (!baseline) return;

		const current = await readTextOrNull(baseline.absPath);
		if (baseline.originalContent === null) {
			// file was created
			if (current === null) {
				tracked.delete(relPath);
				return;
			}
			const displayPath = baseline.path;
			const diff = patchFromBaseline(displayPath, null, current);
			const { added, removed } = countDiffLines(diff);
			tracked.set(relPath, {
				path: baseline.path,
				absPath: baseline.absPath,
				displayPath,
				originalContent: null,
				currentContent: current,
				diff,
				added,
				removed,
				kind: "new",
				updatedAt: Date.now(),
			});
			return;
		}

		// file existed before
		if (current === null) {
			// Deleted outside of tracked tools (or manually). Still track as edited; diff will show removal.
			const displayPath = baseline.path;
			const diff = patchFromBaseline(displayPath, baseline.originalContent, "");
			const { added, removed } = countDiffLines(diff);
			tracked.set(relPath, {
				path: baseline.path,
				absPath: baseline.absPath,
				displayPath,
				originalContent: baseline.originalContent,
				currentContent: "",
				diff,
				added,
				removed,
				kind: "edited",
				updatedAt: Date.now(),
			});
			return;
		}

		if (current === baseline.originalContent) {
			// back to original; untrack
			tracked.delete(relPath);
			return;
		}

		const displayPath = baseline.path;
		const diff = patchFromBaseline(displayPath, baseline.originalContent, current);
		const { added, removed } = countDiffLines(diff);
		tracked.set(relPath, {
			path: baseline.path,
			absPath: baseline.absPath,
			displayPath,
			originalContent: baseline.originalContent,
			currentContent: current,
			diff,
			added,
			removed,
			kind: "edited",
			updatedAt: Date.now(),
		});
	}

	async function clearLog(ctx: ExtensionCommandContext, reason: "accept" | "decline") {
		baselines.clear();
		tracked.clear();
		pendingByToolCallId.clear();
		pi.appendEntry(ENTRY_CLEAR, { timestamp: Date.now(), reason });
		updateUi(ctx);
	}

	async function declineAll(ctx: ExtensionCommandContext, force: boolean) {
		await ctx.waitForIdle();

		if (tracked.size === 0) {
			if (ctx.hasUI) ctx.ui.notify("filechanges: nothing to decline.", "info");
			return;
		}

		if (ctx.hasUI && !force) {
			const ok = await ctx.ui.confirm(
				"Decline pi changes?",
				"This will revert ALL currently logged pi changes (overwrite files / delete created files)."
			);
			if (!ok) return;
		} else if (!ctx.hasUI && !force) {
			throw new Error("Decline requires confirmation. Run: /filechanges-decline force");
		}

		const items = [...tracked.values()].sort((a, b) => b.updatedAt - a.updatedAt);
		let reverted = 0;
		const errors: string[] = [];

		for (const item of items) {
			try {
				if (item.originalContent === null) {
					// created file
					await rm(item.absPath, { force: true });
				} else {
					await ensureParentDir(item.absPath);
					await writeFile(item.absPath, item.originalContent, "utf-8");
				}
				reverted++;
			} catch (e: any) {
				errors.push(`${item.displayPath}: ${e?.message ?? String(e)}`);
			}
		}

		await clearLog(ctx, "decline");

		if (ctx.hasUI) {
			if (errors.length === 0) {
				ctx.ui.notify(`filechanges: declined changes for ${reverted} file(s).`, "success");
			} else {
				ctx.ui.notify(
					`filechanges: declined with ${errors.length} error(s). Run /filechanges to inspect; see console for details.`,
					"warning"
				);
				console.warn("[filechanges] decline errors:\n" + errors.join("\n"));
			}
		}
	}

	async function acceptAll(ctx: ExtensionCommandContext, force: boolean) {
		// Accept is safe during a turn — it only clears the log, no file modifications.

		if (tracked.size === 0) {
			if (ctx.hasUI) ctx.ui.notify("filechanges: nothing to accept.", "info");
			return;
		}

		if (ctx.hasUI && !force) {
			const ok = await ctx.ui.confirm(
				"Accept pi changes?",
				"This will keep current files as-is and clear the modification log."
			);
			if (!ok) return;
		} else if (!ctx.hasUI && !force) {
			throw new Error("Accept requires confirmation. Run: /filechanges-accept force");
		}

		const count = tracked.size;
		await clearLog(ctx, "accept");
		if (ctx.hasUI) ctx.ui.notify(`filechanges: accepted changes for ${count} file(s).`, "success");
	}

	function parseCommandArgs(args: string | undefined): string[] {
		if (!args) return [];
		return args
			.split(/\s+/g)
			.map((s) => s.trim())
			.filter(Boolean);
	}

	function buildFullView(tracked: Map<string, TrackedFile>, theme?: any): string[] {
		if (tracked.size === 0) return ["No file changes tracked."];

		const items = [...tracked.values()].sort((a, b) => b.updatedAt - a.updatedAt);
		const lines: string[] = [];

		for (const t of items) {
			const tag = t.kind === "new" ? "+NEW" : "EDIT";
			const tagStr = theme ? theme.fg(t.kind === "new" ? "success" : "accent", tag) : tag;
			const pathStr = theme ? theme.fg("default", t.displayPath) : t.displayPath;
			const stats = `(+${t.added}/-${t.removed})`;

			lines.push(`${tagStr} ${pathStr} ${stats}`);

			// Show first few lines of diff
			if (t.diff) {
				const diffLines = t.diff.split("\n").slice(0, 12);
				for (const dl of diffLines) {
					if (dl.startsWith("@@") || dl.startsWith("+++") || dl.startsWith("---")) continue;
					if (dl.startsWith("+")) {
						lines.push(theme ? theme.fg("success", `  ${dl}`) : `  ${dl}`);
					} else if (dl.startsWith("-")) {
						lines.push(theme ? theme.fg("error", `  ${dl}`) : `  ${dl}`);
					} else if (dl.startsWith(" ")) {
						lines.push(theme ? theme.fg("dim", `  ${dl}`) : `  ${dl}`);
					}
				}
				const totalDiffLines = t.diff.split("\n").length;
				if (totalDiffLines > 12) {
					lines.push(theme ? theme.fg("dim", `  ... ${totalDiffLines - 12} more diff lines (ctrl+o to expand)`) : `  ... ${totalDiffLines - 12} more diff lines`);
				}
			}
			lines.push("");
		}

		return lines;
	}

	// Commands
	pi.registerCommand("filechanges", {
		description: "Show full file changes view. Usage: /filechanges [hide | show | diff]",
		handler: async (_args, ctx) => {
			const args = (_args ?? "").trim().toLowerCase();

			if (args === "hide") {
				widgetHidden = true;
				updateUi(ctx);
				ctx.ui.notify("Filechanges widget hidden. Run /filechanges show to unhide.", "info");
				return;
			}

			if (args === "show") {
				widgetHidden = false;
				updateUi(ctx);
				ctx.ui.notify("Filechanges widget shown.", "info");
				return;
			}

			if (args === "diff" || args === "view" || args === "" || !args) {
				// Show full view of all tracked changes
				if (tracked.size === 0) {
					ctx.ui.notify("No file changes tracked.", "info");
					return;
				}

				const lines = buildFullView(tracked, ctx.ui.theme);

				// Build a custom component for the full view
				const component = {
					render(width: number) {
						const result: string[] = [];
						for (const l of lines) {
							if (!l) { result.push(""); continue; }
							if (visibleWidth(l) <= width) result.push(l);
							else result.push(truncateToWidth(l, width, "..."));
						}
						return result;
					},
					invalidate() {},
					handleInput() {},
				};

				ctx.ui.setWidget("filechanges-full", component);
				// Auto-hide after 30 seconds
				setTimeout(() => {
					ctx.ui.setWidget("filechanges-full", undefined);
				}, 30000);
				return;
			}

			if (args) {
				ctx.ui.notify("Usage: /filechanges [hide | show | diff]", "warning");
				return;
			}
		},
	});

	pi.registerCommand("filechanges-accept", {
		description: "Accept pi-made changes (keeps files, clears log)",
		handler: async (args, ctx) => {
			await acceptAll(ctx, parseCommandArgs(args).includes("force"));
		},
	});

	pi.registerCommand("filechanges-decline", {
		description: "Decline pi-made changes (reverts files, clears log)",
		handler: async (args, ctx) => {
			await declineAll(ctx, parseCommandArgs(args).includes("force"));
		},
	});

	async function rebuildFromSession(ctx: any): Promise<void> {
		baselines.clear();
		tracked.clear();
		pendingByToolCallId.clear();

		// Replay custom entries on current branch
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom") continue;

			if (entry.customType === ENTRY_CLEAR) {
				baselines.clear();
				tracked.clear();
				continue;
			}

			if (entry.customType === ENTRY_BASELINE) {
				const data = entry.data as any;
				if (!data?.path) continue;
				const { absPath, relPath } = normalizeToolPath(ctx.cwd, data.path);
				baselines.set(relPath, {
					path: relPath,
					absPath,
					originalContent: typeof data.originalContent === "string" ? data.originalContent : null,
					createdAt: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
				});
				continue;
			}

			if (entry.customType === ENTRY_UNTRACK) {
				const data = entry.data as any;
				if (!data?.path) continue;
				const { relPath } = normalizeToolPath(ctx.cwd, data.path);
				baselines.delete(relPath);
				tracked.delete(relPath);
				continue;
			}
		}

		// Compute current diffs
		for (const relPath of baselines.keys()) {
			await recomputeTrackedFile(ctx, relPath);
		}

		updateUi(ctx);
	}

	// Rebuild state on any session/branch navigation events
	pi.on("session_start", async (_event, ctx) => {
		await rebuildFromSession(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		await rebuildFromSession(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		await rebuildFromSession(ctx);
	});

	pi.on("session_fork", async (_event, ctx) => {
		await rebuildFromSession(ctx);
	});

	// Capture before snapshots for edit/write
	pi.on("tool_call", async (event, ctx) => {
		if (isToolCallEventType("edit", event) || isToolCallEventType("write", event)) {
			const { absPath, relPath } = normalizeToolPath(ctx.cwd, event.input.path);
			const before = await readTextOrNull(absPath);
			pendingByToolCallId.set(event.toolCallId, { path: relPath, absPath, before });
		}
	});

	// Commit on successful results
	pi.on("tool_result", async (event, ctx) => {
		if (event.isError) {
			pendingByToolCallId.delete(event.toolCallId);
			return;
		}

		if (!isEditToolResult(event) && !isWriteToolResult(event)) return;

		const pending = pendingByToolCallId.get(event.toolCallId);
		pendingByToolCallId.delete(event.toolCallId);
		if (!pending) return;

		// If no baseline exists yet for this file, create one now from the successful call's snapshot.
		if (!baselines.has(pending.path)) {
			baselines.set(pending.path, {
				path: pending.path,
				absPath: pending.absPath,
				originalContent: pending.before,
				createdAt: Date.now(),
			});
			pi.appendEntry(ENTRY_BASELINE, {
				path: pending.path,
				originalContent: pending.before,
				timestamp: Date.now(),
			});
		}

		// Recompute cumulative diff against baseline
		await recomputeTrackedFile(ctx, pending.path);

		// If file is back to baseline, untrack + persist
		const baseline = baselines.get(pending.path);
		const current = await readTextOrNull(pending.absPath);
		if (baseline) {
			const backToOriginal =
				(baseline.originalContent !== null && current === baseline.originalContent) ||
				(baseline.originalContent === null && current === null);

			if (backToOriginal) {
				baselines.delete(pending.path);
				tracked.delete(pending.path);
				pi.appendEntry(ENTRY_UNTRACK, { path: pending.path, timestamp: Date.now() });
			}
		}

		updateUi(ctx);
	});
}

