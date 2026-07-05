import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

export default function init(pi: ExtensionAPI) {
	(globalThis as any).__pi_extension_features?.push({
		name: "perms",
		description: "Manage extension permissions and enter plan mode",
		commands: ["/extensions", "/plan"],
		tools: ["plan"],
	});

	let isPlanMode = false;
	let planInstructions = "";
	let prePlanModeTools: string[] | null = null;
	const writeTools = ["write", "edit", "bash", "write_to_file", "replace_file_content", "multi_replace_file_content", "run_command"];

	pi.on("before_agent_start", async (_event: any) => {
		if (isPlanMode) {
			let msg = "\n\n======================================================\n";
			msg += "🔴 CURRENT INTERNAL STATE: PLAN MODE IS ACTIVE 🔴\n";
			msg += "======================================================\n";
			msg += "**IGNORE ANY PREVIOUS CHAT HISTORY SAYING YOU EXITED PLAN MODE.**\nYou have just been placed back into Plan Mode by the user. You must only explore the codebase and make a plan. Do NOT modify any code, files, or run destructive commands. When your plan is finalized and you are ready to implement, you must ask the user a question (using the `questions` tool) to request permission to exit plan mode. Only after they agree should you use the `plan` tool with `active: false` to exit.";
			if (planInstructions) {
				msg += "\n\n**Additional Instructions from User:**\n" + planInstructions;
			}
			return {
				systemPrompt: _event.systemPrompt + msg
			};
		} else {
			let msg = "\n\n======================================================\n";
			msg += "🟢 CURRENT INTERNAL STATE: PLAN MODE IS INACTIVE 🟢\n";
			msg += "======================================================\n";
			msg += "**IGNORE ANY PREVIOUS CHAT HISTORY SAYING YOU ARE IN PLAN MODE.**\nYou are in normal implementation mode. You have full permission to write and modify code.";
			return {
				systemPrompt: _event.systemPrompt + msg
			};
		}
	});

	function togglePlanModeState(active: boolean) {
		if (active === isPlanMode) return;
		isPlanMode = active;
		if (isPlanMode) {
			if (typeof (pi as any).getActiveTools === 'function') {
				const activeToolsObj = (pi as any).getActiveTools();
				let isString = false;
				if (activeToolsObj.length > 0 && typeof activeToolsObj[0] === 'string') isString = true;
				
				if (prePlanModeTools === null) {
					prePlanModeTools = activeToolsObj;
				}
				const safeTools = activeToolsObj.filter((t: any) => {
					const name = isString ? t : t.name;
					return !writeTools.includes(name);
				});
				if (typeof (pi as any).setActiveTools === 'function') {
					(pi as any).setActiveTools(safeTools);
				}
			}
		} else {
			if (prePlanModeTools && typeof (pi as any).setActiveTools === 'function') {
				(pi as any).setActiveTools(prePlanModeTools);
			}
			prePlanModeTools = null;
		}
	}

	// Register the /extensions command to toggle tools and permissions
	if (typeof pi.registerCommand === 'function') {
		pi.registerCommand("extensions", {
			description: "Manage allowed extensions and tools via a checklist",
			async handler(args, ctx) {
				if (!ctx.hasUI) {
					return { result: "Error: UI required to manage extensions." };
				}
				
				const fs = await import('fs');
				const path = await import('path');
				const { fileURLToPath } = await import('node:url');
				const extsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
				
				try {
					const dirs = fs.readdirSync(extsDir).filter(e => fs.statSync(path.join(extsDir, e)).isDirectory());
					const exts: { name: string, isEnabled: boolean }[] = [];
					
					for (const dir of dirs) {
						if (dir === '.fallow' || dir === 'perms' || dir === 'header') continue;
						const indexPath = path.join(extsDir, dir, 'index.ts');
						const disabledPath = path.join(extsDir, dir, 'index.ts.disabled');
						const isEnabled = fs.existsSync(indexPath);
						const isDisabled = fs.existsSync(disabledPath);
						
						if (isEnabled || isDisabled) {
							exts.push({ name: dir, isEnabled });
						}
					}

					await ctx.ui.custom((tui, theme, _keybindings, done) => {
						const commit = (updatedExts: { name: string, isEnabled: boolean }[]) => {
							const errors: string[] = [];
							for (const ext of updatedExts) {
								const indexPath = path.join(extsDir, ext.name, 'index.ts');
								const disabledPath = path.join(extsDir, ext.name, 'index.ts.disabled');
								try {
									if (ext.isEnabled && fs.existsSync(disabledPath)) {
										fs.renameSync(disabledPath, indexPath);
									} else if (!ext.isEnabled && fs.existsSync(indexPath)) {
										fs.renameSync(indexPath, disabledPath);
									}
								} catch (e: any) {
									errors.push(`${ext.name}: ${e.message}`);
								}
							}
							if (ctx.hasUI) {
								if (errors.length > 0) {
									ctx.ui.notify(`Failed to update some extensions:\n${errors.join('\n')}`, "warning");
								} else {
									ctx.ui.notify("Extensions updated. Restart required to apply changes fully.", "info");
								}
							}
						};
						return new ExtensionUIComponent(tui, theme, done, exts, commit);
					});

					return;
				} catch (err) {
					return { result: `Error reading extensions: ${err}` };
				}
			}
		});

		// Register the /plan command to toggle plan mode
		pi.registerCommand("plan", {
			description: "Toggle plan mode (agent only explores, no modifications)",
			async handler(args, ctx) {
				if (typeof ctx.isIdle === 'function' && !ctx.isIdle()) {
					if (ctx.hasUI) ctx.ui.notify("Cannot toggle plan mode while agent is generating.", "warning");
					return {};
				}
				
				const newActive = !isPlanMode;
				planInstructions = args.trim();
				togglePlanModeState(newActive);
				
				if (isPlanMode) {
					if (ctx.hasUI) ctx.ui.notify("Plan mode activated", "info");
				} else {
					if (ctx.hasUI) ctx.ui.notify("Plan mode deactivated", "info");
					if (typeof (pi as any).sendUserMessage === 'function') {
						(pi as any).sendUserMessage("Exited plan mode. You may now implement the plan.", { deliverAs: 'user' });
					}
				}
				return {};
			}
		});
	}

	// Register the plan tool
	const planTool = {
		name: "plan",
		label: "Plan Mode",
		description: "Enter or exit plan mode. In plan mode, you must only explore the codebase and make a plan, without modifying anything.",
		promptSnippet: "Use the `plan` tool with active=true to enter plan mode for complex tasks. Use active=false when you are done exploring.",
		parameters: Type.Object({
			active: Type.Boolean({ description: "True to enter plan mode, false to exit." })
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			togglePlanModeState(params.active);
			
			return {
				content: [{ type: "text", text: params.active 
					? "PLAN MODE ACTIVATED: You must now only explore the codebase. Do not modify anything. When the plan is set, use the `plan` tool with active=false to exit." 
					: "Exited plan mode. You may now implement the plan." }]
			};
		},
		renderCall() {
			return { render: () => [], invalidate: () => {}, handleInput: () => {} };
		},
		renderResult(result: any, opts: any, theme: any) {
			const text = result.content?.[0]?.text || '';
			const isEntering = text.includes('PLAN MODE ACTIVATED');
			const bullet = '\u25cf ';
			const lines: string[] = [];
			if (isEntering) {
				lines.push('  ' + bullet + 'Entered plan mode');
				lines.push('  Pi is now exploring and designing an implementation approach.');
			} else {
				lines.push('  ' + bullet + 'Exited plan mode');
				lines.push('  You may now implement the plan.');
			}
			return {
				render: (width: number) => lines.map(l => truncateToWidth(l, width)),
				invalidate: () => {},
				handleInput: () => {}
			};
		}
	};
	if ((globalThis as any).__pi_patchTool) (globalThis as any).__pi_patchTool(planTool);
	pi.registerTool(planTool);
}

class ExtensionUIComponent {
	private selectedIndex = 0;
	private scrollOffset = 0;
	private maxVisible = 5;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	
	constructor(
		private readonly tui: any,
		private readonly theme: any,
		private readonly done: () => void,
		private readonly exts: { name: string, isEnabled: boolean }[],
		private readonly commit: (exts: { name: string, isEnabled: boolean }[]) => void
	) {
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.done();
			return;
		}
		if (this.exts.length === 0) {
			return;
		}
		if (matchesKey(data, Key.up)) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			if (this.selectedIndex < this.scrollOffset) {
				this.scrollOffset = this.selectedIndex;
			}
			this.invalidate();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.selectedIndex = Math.min(this.exts.length - 1, this.selectedIndex + 1);
			if (this.selectedIndex >= this.scrollOffset + this.maxVisible) {
				this.scrollOffset = this.selectedIndex - this.maxVisible + 1;
			}
			this.invalidate();
			this.tui.requestRender();
			return;
		}
		if (data === " ") {
			if (this.selectedIndex >= 0 && this.selectedIndex < this.exts.length) {
				this.exts[this.selectedIndex].isEnabled = !this.exts[this.selectedIndex].isEnabled;
				this.invalidate();
				this.tui.requestRender();
			}
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.commit(this.exts);
			this.done();
			return;
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const lines: string[] = [];
		const add = (text: string) => lines.push(truncateToWidth ? truncateToWidth(text, width) : text.slice(0, width));

		add(this.theme.fg("accent", "─".repeat(Math.max(0, width))));
		add(this.theme.fg("text", " Extension Manager"));
		lines.push("");

		const visibleExts = this.exts.slice(this.scrollOffset, this.scrollOffset + this.maxVisible);
		
		for (let i = 0; i < visibleExts.length; i++) {
			const actualIndex = this.scrollOffset + i;
			const ext = visibleExts[i];
			const selected = actualIndex === this.selectedIndex;
			const prefix = selected ? this.theme.fg("accent", "> ") : "  ";
			const check = ext.isEnabled ? this.theme.fg("accent", "■") : this.theme.fg("accent", "□");
			
			if (selected) {
				add(this.theme.fg("accent", `${prefix}`) + check + this.theme.fg("accent", ` ${ext.name}`));
			} else {
				add(prefix + check + this.theme.fg("text", ` ${ext.name}`));
			}
		}

		lines.push("");
		const help = " ↑↓ move • Space toggle • Enter confirm • Esc cancel";
		add(this.theme.fg("dim", help));
		add(this.theme.fg("accent", "─".repeat(Math.max(0, width))));

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}
