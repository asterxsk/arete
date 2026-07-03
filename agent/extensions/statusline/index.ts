/**
 * toolkit/statusline — status line footer with provider, model, context usage, and file changes.
 *
 * Renders a footer:
 *   Line 1: <provider> × <model · N req>           <↑input ↓output · ※ tokens/window>
 *   Line 2: <~/path>                             <branch (worktree) filechanges>
 */

import { existsSync, statSync, readFileSync } from "fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── Theme colour helpers ──────────────────────────────────────────────

function toHex(rgb: [number, number, number]): string {
	return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

const RESET = "\x1b[0m";
const C = {
	blue:   toHex([142, 202, 230]),  // #8ecae6
	purple: toHex([187, 136, 221]),  // #bb88dd
	orange: toHex([240, 160,  80]),  // #f0a050
	gold:   toHex([248, 204, 133]),  // #f8cc85
	green:  toHex([120, 224, 160]),  // #78e0a0
	red:    toHex([224, 120, 128]),  // #e07880
};

function paint(clr: string, text: string): string {
	return text ? `${clr}${text}${RESET}` : "";
}

// ── Token formatter ────────────────────────────────────────────────

function formatTokens(n: number): string {
	if (!Number.isFinite(n) || n < 0) return "0";
	if (n >= 1_000_000) {
		return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
	}
	if (n >= 1_000) {
		return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
	}
	return String(n);
}

interface ContextInfo {
	percent: number;
	tokens: number;
	window: number;
}

function getContextSafe(ctx: any): ContextInfo {
	const fallback: ContextInfo = { percent: 0, tokens: 0, window: 0 };
	try {
		const usage =
			typeof ctx?.getContextUsage === "function"
				? ctx.getContextUsage()
				: typeof ctx?.sessionManager?.getContextUsage === "function"
					? ctx.sessionManager.getContextUsage()
					: undefined;
		if (usage == null) return fallback;
		if (typeof usage === "number") return { percent: Number.isFinite(usage) ? usage : 0, tokens: 0, window: 0 };
		return {
			percent: typeof usage.percent === "number" && Number.isFinite(usage.percent) ? usage.percent : 0,
			tokens: typeof usage.tokens === "number" && Number.isFinite(usage.tokens) ? Math.round(usage.tokens) : 0,
			window: typeof usage.contextWindow === "number" && Number.isFinite(usage.contextWindow) ? Math.round(usage.contextWindow) : 0,
		};
	} catch { /* ignore */ }
	return fallback;
}

const WHITE = toHex([255, 255, 255]);
const DIM = toHex([128, 128, 130]);

// ── Model name shortener ──────────────────────────────────────────────

function shortModel(raw: string): string {
	const stripped = raw.replace(/^[^/]+\//, "");
	if (stripped.length > 18) {
		return stripped.replace(/^deepseek-/, "ds-").replace(/^anthropic-/, "cl-");
	}
	return stripped;
}

// ── Git helpers ──────────────────────────────────────────────────────

interface GitInfo {
	branch: string | null;
	worktree: string | null;
}

function getGitInfo(cwd: string): GitInfo {
	const result: GitInfo = { branch: null, worktree: null };
	try {
		// Find .git
		let dir = cwd;
		let gitPath = "";
		for (;;) {
			const candidate = dir + "/.git";
			if (!existsSync(candidate)) {
				const parent = dir.substring(0, dir.lastIndexOf("/"));
				if (parent === dir || !parent) break;
				dir = parent;
				continue;
			}
			gitPath = candidate;
			const stat = statSync(gitPath);
			if (stat.isFile()) {
				// Linked worktree — parse gitdir to extract worktree name
				const content = readFileSync(gitPath, "utf8").trim();
				const m = content.match(/^gitdir:\s*(.+)$/m);
				if (m) {
					const linkedDir = m[1]!;
					const wtMatch = linkedDir.match(/worktrees\/([^/]+)$/);
					if (wtMatch) result.worktree = wtMatch[1]!;
					// Read linked HEAD
					const headPath = linkedDir + "/HEAD";
					if (existsSync(headPath)) {
						const head = readFileSync(headPath, "utf8").trim();
						if (head.startsWith("ref: refs/heads/")) result.branch = head.slice(16);
					}
				}
			} else if (stat.isDirectory()) {
				const headPath = gitPath + "/HEAD";
				if (existsSync(headPath)) {
					const head = readFileSync(headPath, "utf8").trim();
					if (head.startsWith("ref: refs/heads/")) result.branch = head.slice(16);
				}
			}
			break;
		}
	} catch { /* ignore */ }
	return result;
}

// ── Extension entry ──────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	(globalThis as any).__pi_extension_features?.push({
		name: "statusline",
		description: "Status line with provider, model, context usage, token counts, and file changes",
	});

	let provider = "";
	let model = "";
	let contextPercent = 0;
	let contextTokens = 0;
	let contextWindow = 0;
	let cwd = "";
	let inputTokens = 0;
	let outputTokens = 0;
	let requestCount = 0;
	let branchLen = 0; // track branch length for incremental request counting
	let gitBranch: string | null = null;
	let gitWorktree: string | null = null;
	let requestRender: (() => void) | undefined;
	let throttleTimer: ReturnType<typeof setTimeout> | undefined;
	let throttlePending = false;

	// ── Home-dir shorthand ───────────────────────────────────────────────
	function shortenPath(p: string): string {
		if (!p) return "";
		// Normalize to forward slashes for matching
		const norm = p.replace(/\\/g, "/");
		// Match common home dir patterns on Windows and Unix
		const homePatterns = [
			/^[A-Z]:\/Users\/[^/]+/i,   // Windows C:\Users\username
			/^\/home\/[^/]+/,           // Unix /home/username
			/^\/Users\/[^/]+/,          // macOS /Users/username
		];
		for (const pat of homePatterns) {
			const m = norm.match(pat);
			if (m) return "~" + norm.slice(m[0].length);
		}
		return p;
	}

	function refreshModel(ctx: any): void {
		if (!ctx?.model) return;
		provider = ctx.model.provider || "";
		const raw = ctx.model.display_name || ctx.model.id || "";
		model = shortModel(raw);
	}

	/** Full accumulation — used on init, refresh, message_end. */
	function accumulateUsage(ctx: any): void {
		try {
			const branch = ctx.sessionManager?.getBranch?.();
			if (!branch) return;
			let totalIn = 0;
			let totalOut = 0;
			let count = 0;
			for (const entry of branch) {
				if (entry.type === "message" && entry.message?.role === "assistant") {
					count++;
					const usage = entry.message.usage;
					if (usage) {
						totalIn += usage.input || 0;
						totalOut += usage.output || 0;
					}
				}
			}
			inputTokens = totalIn;
			outputTokens = totalOut;
			requestCount = count;
			branchLen = branch.length;
		} catch { /* ignore */ }
	}

	/** Incremental update — only counts new assistant messages since last check. */
	function updateUsageIncremental(ctx: any): void {
		try {
			const branch = ctx.sessionManager?.getBranch?.();
			if (!branch) return;
			const prevLen = branchLen;
			const newLen = branch.length;
			if (newLen <= prevLen) return; // no new entries
			branchLen = newLen;
			const slice = branch.slice(prevLen);
			for (const entry of slice) {
				if (entry.type === "message" && entry.message?.role === "assistant") {
					requestCount++;
					const usage = entry.message.usage;
					if (usage) {
						inputTokens += usage.input || 0;
						outputTokens += usage.output || 0;
					}
				}
			}
		} catch { /* ignore */ }
	}

	function refresh(ctx: any): void {
		refreshModel(ctx);
		const info = getContextSafe(ctx);
		contextPercent = info.percent;
		contextTokens = info.tokens;
		contextWindow = info.window;
		cwd = ctx.cwd || "";
		accumulateUsage(ctx);
		const gi = getGitInfo(cwd);
		gitBranch = gi.branch;
		gitWorktree = gi.worktree;
		requestRender?.();
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		refresh(ctx);

		ctx.ui.setFooter((tui: any) => {
			requestRender = () => tui.requestRender();
			return {
				dispose() { requestRender = undefined; },
				invalidate() {},
				render(width: number): string[] {
					// ── Line 1 left: provider × model · N req ────────
					let left1 = "";
					if (provider && model) {
						left1 = paint(WHITE, provider) + " × " + model;
						if (requestCount > 0) {
							left1 += " · " + paint(C.orange, requestCount + " req");
						}
					} else if (provider) {
						left1 = paint(WHITE, provider);
					} else if (model) {
						left1 = model;
					}

					// ── Line 1 right: ↑input ↓output ※ tokens/window ─
					let line1Right = "";
					const hasTokens = inputTokens > 0 || outputTokens > 0;
					const hasContext = contextWindow > 0 || contextTokens > 0;
					if (hasTokens) {
						if (inputTokens > 0) {
							line1Right += paint(C.blue, "↑" + formatTokens(inputTokens));
						}
						if (outputTokens > 0) {
							if (line1Right) line1Right += " ";
							line1Right += paint(C.purple, "↓" + formatTokens(outputTokens));
						}
					}
					if (hasContext) {
						if (line1Right) line1Right += " · ";
						const tokenStr = contextWindow > 0
							? `${formatTokens(contextTokens)}/${formatTokens(contextWindow)}`
							: `${formatTokens(contextTokens)}`;
						const ctxColor = contextPercent > 60 ? C.gold : WHITE;
						line1Right += paint(WHITE, "※ ") + paint(ctxColor, tokenStr);
						if (contextPercent > 90) {
							line1Right += paint(C.red, " ●");
						}
					}

					// ── File changes ────────────────────────────────
					const counts = (globalThis as any).__pi_filechanges_counts as
						{ edited: number; created: number } | undefined;
					let fcParts: string[] = [];
					if (gitBranch) {
						const wt = gitWorktree ? paint(DIM, "(" + gitWorktree + ")") : "";
						fcParts.push(paint(WHITE, gitBranch) + wt);
					}
					if (counts) {
						if (counts.edited > 0) fcParts.push(paint(C.orange, " " + counts.edited));
						if (counts.created > 0) fcParts.push(paint(C.green, " " + counts.created));
					}
					const line2Right = fcParts.length > 0 ? " " + fcParts.join(" ") : "";

					// ── Align lines ─────────────────────────────────
					const lines: string[] = [];
					if (left1 || line1Right) {
						const rightW = visibleWidth(line1Right);
						const avail = width - rightW - 1;
						const l = truncateToWidth(left1, Math.max(0, avail), "", true);
						lines.push(l + line1Right);
					}
					if (line2Right || cwd) {
						const rightW = visibleWidth(line2Right);
						const avail = width - rightW - 1;
						const pathStr = cwd ? paint(C.blue, shortenPath(cwd)) : "";
						const l = truncateToWidth(pathStr, Math.max(0, avail), "", true);
						lines.push((l || "") + line2Right);
					}
					return lines;
				},
			};
		});
	});

	// ── Alt+C: compact cue shortcut ───────────────────────────────
	pi.registerShortcut("alt+c", {
		description: "Run /compact to reduce context usage when above 90%",
		handler: async (ctx) => {
			const pct = getContextSafe(ctx).percent;
			if (pct <= 90) {
				ctx.ui.notify?.("Context only at " + pct + "% — no need to compact yet.", "info");
				return;
			}
			ctx.ui.notify?.("Compacting context...", "info");
			try {
				ctx.sendUserMessage("/compact", { deliverAs: "followUp" });
			} catch (e) {
				ctx.ui.notify?.(
					"Failed to compact: " + (e instanceof Error ? e.message : String(e)),
					"error"
				);
			}
		},
	});

	pi.on("model_select", (_event, ctx) => refresh(ctx));
	pi.on("message_update", (_event, ctx) => {
		const info = getContextSafe(ctx);
		contextPercent = info.percent;
		contextTokens = info.tokens;
		contextWindow = info.window;
		updateUsageIncremental(ctx);
		if (!throttlePending) {
			throttlePending = true;
			throttleTimer = setTimeout(() => {
				throttlePending = false;
				requestRender?.();
			}, 120);
		}
	});
	pi.on("message_end", (_event, ctx) => {
		if (throttleTimer) {
			clearTimeout(throttleTimer);
			throttleTimer = undefined;
		}
		throttlePending = false;
		refresh(ctx);
	});
	pi.on("session_compact", () => requestRender?.());
}

// ponytail: minimal self-check for the pure helpers
function demo(): void {
	console.assert(formatTokens(1_234_567) === "1.2M", "1.2M");
	console.assert(formatTokens(12_300) === "12.3k", "12.3k");
	console.assert(formatTokens(999) === "999", "999");
	console.assert(shortModel("openai/gpt-4o-mini") === "gpt-4o-mini", "shortModel keeps short names");
	console.assert(shortModel("deepseek/deepseek-reasoner-model-v4-flash") === "ds-reasoner-model-v4-flash", "deepseek shortens");
}
// demo(); // uncomment to run
