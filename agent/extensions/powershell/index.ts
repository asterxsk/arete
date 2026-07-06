import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { spawn } from "child_process";

// ── Compact UI helpers (matches compactui style) ─────────────────────
const INDENT = "";
const HINT = " (ctrl+o to expand)";
const DIM_GREY = "\x1b[38;2;140;140;140m";

function compactLine(text: string): Component {
	return {
		render(width) {
			return [visibleWidth(text) <= width ? text : truncateToWidth(text, width, "...")];
		},
		invalidate() {},
	};
}

function noOp(): Component {
	return {
		render() { return []; },
		invalidate() {},
	};
}

function orange(theme: any, text: string): string {
	return `\x1b[38;2;250;179;135m${text}\x1b[39m`;
}

function compactCall(toolName: string, argsStr: string, theme: any): Component {
	let display = argsStr.split("\n")[0] ?? argsStr;
	const maxDisplay = 40;
	if (display.length > maxDisplay) display = display.slice(0, maxDisplay - 3) + "...";
	else if (display.length < argsStr.length) display += "...";
	return compactLine(INDENT + orange(theme, toolName) + " [" + display + "]" + DIM_GREY + HINT + "\x1b[39m");
}

function getCommandName(cmd: string): string {
	cmd = cmd.trim();
	let firstArg = "";
	if (cmd.startsWith('"')) {
		const endQuote = cmd.indexOf('"', 1);
		firstArg = endQuote !== -1 ? cmd.slice(1, endQuote) : cmd;
	} else if (cmd.startsWith("'")) {
		const endQuote = cmd.indexOf("'", 1);
		firstArg = endQuote !== -1 ? cmd.slice(1, endQuote) : cmd;
	} else {
		firstArg = cmd.split(/\s+/)[0] || "";
	}
	let base = firstArg.split(/[\\/]/).pop() || "";
	base = base.replace(/\.(exe|cmd|bat|sh|ps1)$/i, "");
	return base || "command";
}

function compactSummary(theme: any, summary: string, count: number, unit: string, fullOutput?: string): Component {
	const PREVIEW_LINES = 3;
	const lines = fullOutput ? fullOutput.split("\n").filter(l => l.trim()) : [];
	const showPreview = lines.length > 0;
	const previewLines = lines.slice(0, PREVIEW_LINES);
	const remaining = count > PREVIEW_LINES ? count - PREVIEW_LINES : 0;

	const components: Component[] = [];

	if (showPreview) {
		for (let i = 0; i < previewLines.length; i++) {
			const prefix = i === 0 ? INDENT + DIM_GREY + "\u23bf  " : INDENT + "   ";
			const lineText = previewLines[i];
			const maxLen = 80;
			const truncated = visibleWidth(lineText) > maxLen ? lineText.slice(0, maxLen - 3) + "..." : lineText;
			components.push(compactLine(prefix + "\x1b[97m" + truncated + "\x1b[39m"));
		}
		if (remaining > 0) {
			components.push(compactLine(INDENT + "  " + DIM_GREY + "... " + remaining + " more lines (ctrl+o to expand)\x1b[39m"));
		}
	} else {
		const countStr = count > 0 ? `${count} ${unit}${count !== 1 ? "s" : ""}` : "no output";
		components.push(compactLine(INDENT + DIM_GREY + "\u23bf " + countStr + " of output\x1b[39m"));
	}

	return {
		render(width: number) {
			return components.flatMap(c => c.render(width));
		},
		invalidate() {},
	};
}

function formatDur(s: number): string {
	if (s < 0.01) return "0.0s";
	if (s < 60) return s.toFixed(1) + "s";
	return Math.floor(s / 60) + "m " + Math.floor(s % 60) + "s";
}

function wrapWithPrefix(rl: string, width: number): string[] {
	const visible = rl.replace(/\x1b\[[0-9;]*m/g, "");
	const match = visible.match(/^(\s*(?:│|└|\[)?\s*(?:\s*\d+\s*(?:│|\+|\-)?\s*)?)/);
	if (!match || match[1].length === 0) return wrapTextWithAnsi(rl, width);

	const prefixLen = match[1].length;
	let ansiPrefix = "";
	let contentStr = "";
	let visibleCount = 0;
	let i = 0;
	while (i < rl.length) {
		if (rl[i] === '\x1b') {
			const end = rl.indexOf('m', i);
			if (end !== -1) {
				if (visibleCount < prefixLen) ansiPrefix += rl.slice(i, end + 1);
				else contentStr += rl.slice(i, end + 1);
				i = end + 1;
				continue;
			}
		}
		if (visibleCount < prefixLen) ansiPrefix += rl[i];
		else contentStr += rl[i];
		visibleCount++;
		i++;
	}

	const contentWidth = Math.max(10, width - prefixLen);
	const wrappedContent = wrapTextWithAnsi(contentStr, contentWidth);
	if (wrappedContent.length === 0) return [ansiPrefix];

	const result = [ansiPrefix + wrappedContent[0]];
	const subsequentPrefixStr = match[1].replace(/[^\s│]/g, " ");
	for (let j = 1; j < wrappedContent.length; j++) {
		result.push(subsequentPrefixStr + wrappedContent[j]);
	}
	return result;
}

function expandedBox(theme: any, headerName: string, argsLine: string, lines: string[], durationS: number, limit: number): Component {
	const show = lines.slice(0, limit);
	const hasMore = lines.length > limit;
	const raw: string[] = [];

	// Header line
	raw.push(INDENT + orange(theme, headerName) + " [" + argsLine + "]");

	// Output lines with │ prefix aligned under [
	const padding = " ".repeat(headerName.length + 1);
	const CONTENT_INDENT = padding + "│ ";
	for (const line of show) {
		raw.push(INDENT + CONTENT_INDENT + theme.fg("text", line));
	}

	if (hasMore) {
		raw.push(INDENT + CONTENT_INDENT + DIM_GREY + "... " + (lines.length - limit) + " more\x1b[39m");
	}

	// Footer with duration
	if (durationS >= 0) {
		raw.push(INDENT + padding + "└ " + DIM_GREY + "Took " + formatDur(durationS) + " [ctrl+o to hide]\x1b[39m");
	}

	return {
		render(width) {
			const result: string[] = [];
			for (const rl of raw) {
				if (!rl) result.push("");
				else if (visibleWidth(rl) <= width) result.push(rl);
				else {
					result.push(...wrapWithPrefix(rl, width));
				}
			}
			return result;
		},
		invalidate() {},
	};
}


export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "powershell",
		label: "PowerShell",
		renderShell: "self",
		description:
			"Execute PowerShell commands on the local Windows system. Supports any cmdlet, script, or PowerShell command. " +
			"Results include stdout, stderr, and exit code.",
		promptSnippet: "Run PowerShell commands for system administration, file operations, registry, WMI, and Windows automation",
		promptGuidelines: [
			"Use this for any Windows system administration, file operations, registry access, WMI/CIM queries, process management, service control, or .NET interop",
			"Multi-line scripts work as written — the tool handles encoding automatically via -EncodedCommand",
			"Avoid cd/chdir — use Set-Location or pass full paths instead",
			"Use `| Out-String` to ensure output is captured as text",
			"The tool runs from your current working directory",
		],
		parameters: Type.Object({
			command: Type.String({ description: "PowerShell command or script to execute" }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const start = Date.now();
			const command = (params as { command: string }).command;
			const encodedCommand = Buffer.from(command, "utf16le").toString("base64");

			return new Promise((resolve) => {
				const child = spawn(
					"powershell.exe",
					["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand],
					{ windowsHide: true, cwd: ctx.cwd || process.cwd() },
				);

				let stdout = "";
				let stderr = "";

				child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
				child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

				child.on("close", (code) => {
					const elapsed = (Date.now() - start) / 1000;
					const text = stdout.trim() || stderr.trim();
					const output = text || "(no output)";
					const baseDetails = { exitCode: code, stderr, stdout, _durationS: elapsed, command };
					if (code !== 0 && stderr.trim()) {
						return resolve({
							content: [{ type: "text", text: output }],
							details: { ...baseDetails, _fullOutput: output },
							isError: true,
						});
					}
					return resolve({
						content: [{ type: "text", text: output }],
						details: { ...baseDetails, _fullOutput: output },
					});
				});

				child.on("error", (err) => {
					resolve({
						content: [{ type: "text", text: "Failed to start PowerShell: " + err.message }],
						details: { _durationS: (Date.now() - start) / 1000 },
						isError: true,
					});
				});

				if (signal) {
					const abort = () => { if (!child.killed) child.kill(); };
					if (signal.aborted) abort();
					else signal.addEventListener("abort", abort, { once: true });
				}
			});
		},

		renderCall(args, theme, context) {
			if (context.expanded) return noOp();
			return compactCall("powershell", getCommandName(args.command ?? "?"), theme);
		},

		renderResult(result, { expanded, isPartial }, theme, _context) {
			if (isPartial) return compactLine(INDENT + theme.fg("warning", "Running..."));

			const details = result.details as Record<string, unknown> | undefined;
			const full = (details?._fullOutput as string) || result.content?.[0]?.text || "";
			const lines = full.split("\n");
			const durationS = (details?._durationS as number) ?? -1;

			if (!expanded) {
				if (result.isError) return compactLine(INDENT + DIM_GREY + "\u23bf failed tool call" + "\x1b[39m");
				return compactSummary(theme, "Output", lines.length, "line", full);
			}

			return expandedBox(theme, "powershell", getCommandName(_context.args.command || ""), lines, durationS, 40);
		},
	});
}