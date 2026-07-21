import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "child_process";


export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "powershell",
		label: "PowerShell",
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
	});
}