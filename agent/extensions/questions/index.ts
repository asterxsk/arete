import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
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
	theme?: any;
}

class CompactResult implements Component {
	private opts: _CBOpts;
	private cachedWidth?: number;
	private cachedLines?: string[];
	constructor(opts: _CBOpts) { this.opts = opts; }
	invalidate(): void { this.cachedWidth = undefined; this.cachedLines = undefined; }
	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const { toolName, argsLine, suffix, footer, state, previewLines, expanded, footerAlways, theme } = this.opts;
		const lines: string[] = [];
		const dot = '';
		let header = theme ? theme.fg("toolTitle", theme.bold(toolName)) : ` \x1b[38;2;255;165;0m${toolName}\x1b[0m`;
		if (suffix) header += ` ${suffix}`;
		lines.push(truncateToWidth(header, width));
		if (expanded) {
			if (argsLine) lines.push(truncateToWidth(`  │ ${theme ? theme.fg("toolOutput", argsLine) : argsLine}`, width));
			if (previewLines) for (const pl of previewLines) lines.push(truncateToWidth(`  │ ${theme ? theme.fg("toolOutput", pl) : pl}`, width));
			if (footer) lines.push(truncateToWidth(`  └ ${theme ? theme.fg("muted", footer) : footer}`, width));
		} else {
			// Single-line compact mode
			const parts: string[] = [`(${truncateToWidth(argsLine, Math.max(10, width - 26))})`, "(ctrl+o to expand)"];
			header += ` ${parts.join(" ")}`;
			lines[0] = truncateToWidth(header, width);
		}
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}

class SimpleComponent implements Component {
	private cachedWidth?: number;
	private cachedLines?: string[];
	constructor(private readonly getLines: (width: number) => string[]) {}
	invalidate() {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const rendered = this.getLines(width);
		this.cachedWidth = width;
		this.cachedLines = rendered;
		return rendered;
	}
}

const emptyComponent = Object.freeze({ render: () => [] as string[], invalidate() {}, handleInput() {} });

interface QuestionOptionInput {
	value: string;
	label: string;
	description?: string;
}

interface QuestionInput {
	id: string;
	label?: string;
	prompt: string;
	sketch?: string;
	options?: QuestionOptionInput[];
	isMultiSelect?: boolean;
	allowWriteIn?: boolean;
}

interface QuestionOption {
	value: string;
	label: string;
	description?: string;
}

interface Question {
	id: string;
	label: string;
	prompt: string;
	sketch?: string;
	options: QuestionOption[];
	isMultiSelect?: boolean;
	allowWriteIn?: boolean;
}

type AnswerSource = "option" | "custom";

interface Answer {
	questionId: string;
	questionLabel: string;
	value: string;
	label: string;
	source: AnswerSource;
	optionIndex?: number;
	optionValue?: string;
}

interface QuestionsResult {
	questions: Question[];
	answers: Answer[];
	cancelled: boolean;
	submitted: boolean;
}

const QuestionOptionSchema = Type.Object({
	value: Type.String({ description: "Short internal identifier for the option (e.g. 'opt1' or 'sqlite')" }),
	label: Type.String({ description: "Display text for this option shown to the user" }),
	description: Type.Optional(Type.String({ description: "Optional helper text to explain the option in more detail" })),
});

const QuestionSchema = Type.Object({
	id: Type.String({ description: "Short unique identifier for this question" }),
	label: Type.Optional(
		Type.String({
			description: "Short 1-2 word tab label, e.g. 'Scope' or 'Auth'",
		}),
	),
	prompt: Type.String({ description: "Full question text shown above options" }),
	sketch: Type.Optional(
		Type.String({ description: "Optional ASCII sketch, diagram, or wireframe to help answer the question. Do not use it to restate answer options or render them in square brackets." }),
	),
	options: Type.Optional(Type.Array(QuestionOptionSchema, {
		maxItems: 10,
		description: "Provide at least 2 preset options for multiple choice. Omit for open-ended questions. The UI appends 'Type your own answer' as last option.",
	})),
	isMultiSelect: Type.Optional(Type.Boolean({ description: "Set to true ONLY if the user can select multiple options simultaneously." })),
	allowWriteIn: Type.Optional(Type.Boolean({ description: "If false, removes the 'Type your own answer' fallback option. Default is true." })),
});

const QuestionsParams = Type.Object({
	questions: Type.Array(QuestionSchema, { minItems: 1, description: "A list of questions to ask the user" }),
});

function normalizeLabel(label: string | undefined, fallback: string): string {
	const source = (label || fallback).replace(/\s+/g, " ").trim();
	if (!source) return fallback;
	const words = source
		.replace(/[\[\](){},.:;!?]+/g, " ")
		.split(" ")
		.filter(Boolean)
		.slice(0, 2)
		.join(" ");
	return truncateToWidth(words || fallback, 16, "");
}

function buildQuestions(questions: QuestionInput[]): Question[] {
	return questions.map((q, index) => ({
		id: q.id,
		label: normalizeLabel(q.label, q.prompt || `Q${index + 1}`),
		prompt: q.prompt,
		sketch: q.sketch?.trim() ? q.sketch : undefined,
		options: (q.options || []).map((opt) => ({
			value: opt.value,
			label: opt.label,
			description: opt.description,
		})),
		isMultiSelect: q.isMultiSelect,
		allowWriteIn: q.allowWriteIn,
	}));
}

function formatAnswer(answer: Answer): string {
	if (answer.source === "custom") {
		return `${answer.questionLabel}: (wrote) ${answer.value}`;
	}
	const prefix = typeof answer.optionIndex === "number" ? `${answer.optionIndex}. ` : "";
	return `${answer.questionLabel}: ${prefix}${answer.label}`;
}

function makeResult(questions: Question[], answers: Answer[], cancelled: boolean, submitted: boolean): QuestionsResult {
	return { questions, answers, cancelled, submitted };
}

class QuestionsComponent {
	private _focused = false;
	public onDone: ((result: QuestionsResult) => void) | undefined;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.syncFocus();
	}

	private readonly questions: Question[];
	private readonly input: Input;
	private readonly answerIndex = new Map<string, Set<number>>();
	private readonly answerValue = new Map<string, Answer[]>();
	private readonly totalTabs: number;
	private tabIndex = 0;
	private optionIndex = 0;
	private mode: "browse" | "custom" = "browse";
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(
		private readonly tui: any,
		private readonly theme: any,
		questions: Question[],
	) {
		this.questions = questions;
		this.totalTabs = questions.length > 1 ? questions.length + 1 : questions.length;
		this.input = new Input();
		this.input.onSubmit = (value) => {
			const question = this.currentQuestion();
			if (!question) return;
			const trimmed = value.trim();
			if (!trimmed) {
				this.mode = "browse";
				this.input.setValue("");
				this.syncFocus();
				this.invalidate();
				this.tui.requestRender();
				return;
			}
			this.saveCustomAnswer(question, trimmed);
			this.mode = "browse";
			this.input.setValue("");
			this.syncFocus();
			if (!question.isMultiSelect) {
				this.advanceAfterAnswer();
			}
			this.tui.requestRender();
		};
		this.input.onEscape = () => {
			this.mode = "browse";
			this.input.setValue("");
			this.syncFocus();
			this.invalidate();
			this.tui.requestRender();
		};
	}

	private currentQuestion(): Question | undefined {
		if (this.questions.length === 0) return undefined;
		if (this.isSubmitTab()) return undefined;
		return this.questions[this.tabIndex];
	}

	private isSubmitTab(): boolean {
		return this.questions.length > 1 && this.tabIndex === this.questions.length;
	}

	private isMulti(): boolean {
		return this.questions.length > 1;
	}

	private currentOptions(): Array<QuestionOption & { isCustom?: boolean, isDone?: boolean }> {
		const question = this.currentQuestion();
		if (!question) return [];
		const opts: Array<QuestionOption & { isCustom?: boolean, isDone?: boolean }> = [
			...question.options,
		];
		if (question.allowWriteIn !== false) {
			opts.push({ value: "__pi_custom_answer__", label: "Type your own answer", isCustom: true });
		}
		return opts;
	}

	private allAnswered(): boolean {
		return this.questions.every((question) => {
			const values = this.answerValue.get(question.id);
			return values && values.length > 0;
		});
	}

	private syncFocus(): void {
		this.input.focused = this.focused && this.mode === "custom";
	}

	private setTab(index: number): void {
		if (this.questions.length === 0) return;
		const max = this.totalTabs - 1;
		this.tabIndex = Math.max(0, Math.min(max, index));
		if (this.isSubmitTab()) {
			this.optionIndex = 0;
			this.mode = "browse";
			this.syncFocus();
			this.invalidate();
			return;
		}
		const question = this.currentQuestion();
		if (!question) return;
		const savedIndices = this.answerIndex.get(question.id);
		this.optionIndex = savedIndices && savedIndices.size > 0 ? Array.from(savedIndices)[0] : 0;
		const savedAnswers = this.answerValue.get(question.id);
		if (savedAnswers?.some(a => a.source === "custom")) {
			this.optionIndex = question.options.length;
		}
		this.mode = "browse";
		this.syncFocus();
		this.invalidate();
	}

	private toggleOptionAnswer(question: Question, index: number): void {
		const option = this.currentOptions()[index];
		if (!option || option.isCustom) return;
		
		const answer: Answer = {
			questionId: question.id,
			questionLabel: question.label,
			value: option.value,
			label: option.label,
			source: "option",
			optionIndex: index + 1,
			optionValue: option.value,
		};
		
		let indices = this.answerIndex.get(question.id);
		if (!indices) {
			indices = new Set();
			this.answerIndex.set(question.id, indices);
		}
		
		let values = this.answerValue.get(question.id);
		if (!values) {
			values = [];
			this.answerValue.set(question.id, values);
		}
		
		if (question.isMultiSelect) {
			if (indices.has(index)) {
				indices.delete(index);
				this.answerValue.set(question.id, values.filter(a => a.optionIndex !== index + 1));
			} else {
				indices.add(index);
				values.push(answer);
			}
		} else {
			this.answerIndex.set(question.id, new Set([index]));
			this.answerValue.set(question.id, [answer]);
		}
	}

	private saveCustomAnswer(question: Question, text: string): void {
		const answer: Answer = {
			questionId: question.id,
			questionLabel: question.label,
			value: text,
			label: text,
			source: "custom",
		};
		this.answerIndex.set(question.id, new Set([question.options.length]));
		this.answerValue.set(question.id, [answer]);
	}

	private advanceAfterAnswer(): void {
		if (!this.isMulti()) {
			this.finish(true);
			return;
		}
		if (this.tabIndex < this.questions.length - 1) {
			this.setTab(this.tabIndex + 1);
			return;
		}
		this.setTab(this.questions.length);
	}

	private finish(submitted: boolean): void {
		const answers = this.questions
			.flatMap((question) => this.answerValue.get(question.id) || []);
		this.onDone?.(makeResult(this.questions, answers, !submitted, submitted));
	}

	private openCustomEditor(prefill: string): void {
		this.mode = "custom";
		this.input.setValue(prefill);
		this.input.invalidate();
		this.syncFocus();
		this.invalidate();
	}

	handleInput(data: string): void {
		if (this.mode === "custom") {
			if (matchesKey(data, Key.escape)) {
				this.mode = "browse";
				this.input.setValue("");
				this.syncFocus();
				this.invalidate();
				this.tui.requestRender();
				return;
			}
			this.input.handleInput(data);
			this.invalidate();
			this.tui.requestRender();
			return;
		}

		if (this.questions.length > 1) {
			if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
				this.setTab((this.tabIndex + 1) % this.totalTabs);
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
				this.setTab((this.tabIndex - 1 + this.totalTabs) % this.totalTabs);
				this.tui.requestRender();
				return;
			}
		}

		if (this.isSubmitTab()) {
			if (matchesKey(data, Key.enter)) {
				if (this.allAnswered()) {
					this.finish(true);
				} else {
					const missing = this.questions.findIndex((question) => {
						const vals = this.answerValue.get(question.id);
						return !vals || vals.length === 0;
					});
					if (missing >= 0) {
						this.setTab(missing);
					}
				}
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, Key.escape)) {
				this.finish(false);
				return;
			}
		}

		const question = this.currentQuestion();
		if (!question) {
			if (matchesKey(data, Key.escape)) {
				this.finish(false);
			}
			return;
		}

		const options = this.currentOptions();
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
		
		if (matchesKey(data, Key.space) && question.isMultiSelect) {
			const selected = options[this.optionIndex];
			if (!selected || selected.isCustom) return;
			this.toggleOptionAnswer(question, this.optionIndex);
			this.invalidate();
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.enter)) {
			const selected = options[this.optionIndex];
			if (!selected) return;
			
			if (selected.isCustom) {
				const current = this.answerValue.get(question.id);
				const customAnswer = current?.find(a => a.source === "custom");
				this.openCustomEditor(customAnswer ? customAnswer.value : "");
				this.tui.requestRender();
				return;
			}
			
			if (question.isMultiSelect) {
				this.advanceAfterAnswer();
			} else {
				this.toggleOptionAnswer(question, this.optionIndex);
				this.advanceAfterAnswer();
			}
			
			this.tui.requestRender();
			return;
		}
		
		if (matchesKey(data, Key.escape)) {
			this.finish(false);
		}
	}

	private renderTab(label: string, active: boolean, completed: boolean, width: number): string {
		const marker = completed ? "■" : "□";
		const text = ` ${marker} ${label} `;
		const colored = active
			? this.theme.bg("selectedBg", this.theme.fg("text", text))
			: this.theme.bg("toolPendingBg", this.theme.fg(completed ? "success" : "muted", text));
		return truncateToWidth(colored, width);
	}

	private renderTabBar(width: number): string {
		const pieces: string[] = [];
		for (let i = 0; i < this.questions.length; i++) {
			const question = this.questions[i];
			const isCompleted = (this.answerValue.get(question.id)?.length || 0) > 0;
			pieces.push(this.renderTab(question.label, i === this.tabIndex, isCompleted, width));
		}
		if (this.isMulti()) {
			pieces.push(this.renderTab("submit", this.isSubmitTab(), this.allAnswered(), width));
		}
		return truncateToWidth(`← ${pieces.join(" ")} →`, width);
	}

	private renderWidthLine(text: string, width: number): string {
		return truncateToWidth(text, width);
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const lines: string[] = [];
		const add = (text: string) => lines.push(this.renderWidthLine(text, width));
		const question = this.currentQuestion();

		add(this.theme.fg("accent", "─".repeat(Math.max(0, width))));

		if (this.isMulti()) {
			add(this.renderTabBar(width));
			lines.push("");
		}

		if (this.isSubmitTab()) {
			add(this.theme.fg("accent", this.theme.bold("Review answers")));
			lines.push("");
			for (const q of this.questions) {
				const answers = this.answerValue.get(q.id);
				if (!answers || answers.length === 0) {
					add(`${this.theme.fg("warning", q.label + ":")} ${this.theme.fg("dim", "(missing)")}`);
					continue;
				}
				const values = answers.map(answer => 
					answer.source === "custom"
						? `${this.theme.fg("muted", "(wrote)")} ${answer.label}`
						: `${answer.optionIndex}. ${answer.label}`
				).join(", ");
				add(`${this.theme.fg("muted", q.label + ":")} ${this.theme.fg("text", values)}`);
			}
			lines.push("");
			if (this.allAnswered()) {
				add(this.theme.fg("dim", " Enter to submit • Tab / Shift+Tab to edit answers • Esc cancel"));
			} else {
				const missing = this.questions.filter((q) => {
					const vals = this.answerValue.get(q.id);
					return !vals || vals.length === 0;
				}).map((q) => q.label).join(", ");
				add(this.theme.fg("warning", `Missing: ${missing}`));
				add(this.theme.fg("dim", "Tab to jump to a question and fix it • Esc cancel"));
			}
		} else if (question) {
			add(this.theme.fg("text", ` ${question.prompt}`));
			lines.push("");

			if (question.sketch) {
				for (const line of question.sketch.split(/\r?\n/)) {
					const sketchLine = line.replace(/\[/g, "").replace(/\]/g, "").replace(/\s+/g, " ").trim();
					add(this.theme.fg("accent", ` ${sketchLine}`));
				}
				lines.push("");
			}

			const options = this.currentOptions();
			const savedIndices = this.answerIndex.get(question.id) || new Set();
			
			for (let i = 0; i < options.length; i++) {
				const opt = options[i];
				const selected = i === this.optionIndex;
				const prefix = selected ? this.theme.fg("accent", "> ") : "  ";
				
				let label = "";
				if (question.isMultiSelect && !opt.isCustom) {
					const checked = savedIndices.has(i);
					label = `${checked ? "■" : "□"} ${opt.label}`;
				} else {
					label = `${i + 1}. ${opt.label}`;
				}
				
				const styled = selected ? this.theme.fg("accent", label) : this.theme.fg("text", label);
				add(prefix + styled);
				if (opt.description) {
					add(`     ${this.theme.fg("muted", opt.description)}`);
				}
			}

			if (this.mode === "custom") {
				lines.push("");
				add(this.theme.fg("muted", " Your answer:"));
				for (const line of this.input.render(Math.max(8, width - 2))) {
					add(` ${line}`);
				}
			}

			lines.push("");
			const help = this.isMulti()
				? (question.isMultiSelect ? " Tab/←→ switch tabs • ↑↓ options • Space check • Enter send • Esc cancel" : " Tab/←→ switch tabs • ↑↓ options • Enter select • Esc cancel")
				: (question.isMultiSelect ? " Space check • Enter send • Esc cancel" : " ↑↓ options • Enter select • Esc cancel");
			add(this.theme.fg("dim", help));
		}

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

export default function (pi: ExtensionAPI) {
	// Self-register in global feature registry
	(globalThis as any).__pi_extension_features?.push({
		name: "questions",
		description: "Ask the user structured questions with preset options, checkboxes, custom-answer fallback, and ASCII sketches",
		tools: ["questions"],
	});

	pi.registerTool({
		name: "questions",
		label: "Questions",
		renderShell: "self",
		description:
			"Ask the user one or more structured questions in an interactive terminal UI. Use when you need preset choices plus a free-text answer, multiple-choice checkboxes, or an optional ASCII sketch.",
		promptSnippet: "Ask structured questions with preset options, checkboxes, a custom-answer fallback, and optional ASCII sketches. Use options for multiple choice; omit options for open-ended text input.",
		promptGuidelines: [
			"CRITICAL: If a question is multiple-choice, you MUST provide at least 2 preset options.",
			"CRITICAL: If a question is open-ended (free text), you MUST OMIT the options array entirely.",
			"Use 1-10 questions in one call when you need to collect multiple related answers.",
			"Set isMultiSelect to true ONLY if the user can select multiple options simultaneously via checkboxes.",
			"Give each question a short 1-2 word tab label.",
			"The UI always adds 'Type your own answer' as the last choice automatically.",
			"Add an ASCII sketch only for layout or flow; do not restate answer options in the sketch or wrap them in square brackets.",
		],
		parameters: QuestionsParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Error: Questions UI requires interactive terminal mode" }],
					details: makeResult([], [], true, false),
				};
			}

			const questions = buildQuestions(params.questions as QuestionInput[]);
			const ids = new Set<string>();
			for (const q of questions) {
				if (ids.has(q.id)) {
					return {
						content: [{ type: "text", text: `Error: Duplicate question id '${q.id}'` }],
						details: makeResult(questions, [], true, false),
					};
				}
				ids.add(q.id);
			}

			// Suppress spinner working-message while the interactive modal is active
			const origSetWorkingMessage = ctx.ui.setWorkingMessage;
			ctx.ui.setWorkingMessage = () => {};
			ctx.ui.setWorkingMessage(undefined);

			let result;
			try {
				result = await ctx.ui.custom<QuestionsResult>((tui, theme, _keybindings, done) => {
					const component = new QuestionsComponent(tui, theme, questions);
					component.onDone = (value) => done(value);
					component.focused = true;
					return component;
				});
			} finally {
				ctx.ui.setWorkingMessage = origSetWorkingMessage;
			}

			if (!result || result.cancelled) {
				return {
					content: [{ type: "text", text: "User cancelled questions" }],
					details: makeResult(questions, result?.answers ?? [], true, false),
				};
			}

			const qLines = questions.map((q, idx) => {
				const qAnswers = result.answers.filter((a) => a.questionId === q.id);
				const prefix = idx === 0 ? "⎿  · " : "   · ";
				const prompt = q.prompt;
				const answerText = qAnswers.length > 0 ? qAnswers.map((a) => a.label).join(", ") : "(no answer)";
				return `${prefix}${prompt} → ${answerText}`;
			});
			const count = questions.length;
			const text = `● User answered ${count} question${count === 1 ? "" : "s"}:\n${qLines.join("\n")}`;
			return {
				content: [{ type: "text", text }],
				details: result,
			};
		},
		renderCall() { return emptyComponent; },
		renderResult(result, { isPartial, expanded }, theme, context) {
			if (isPartial) {
				const questionsCount = context?.args?.questions?.length ?? 0;
				const text = `Asking ${questionsCount} question${questionsCount === 1 ? "" : "s"}...`;
				return new SimpleComponent((width) => [truncateToWidth(text, width)]);
			}
			const content = result.content[0];
			let text = content?.type === "text" ? content.text : "";
			if (result.isError || text.startsWith("Error")) {
				const firstLine = text.split("\n")[0] || "error";
				return new SimpleComponent((width) => [truncateToWidth(firstLine, width)]);
			}
			const details = result.details as QuestionsResult | undefined;
			if (details?.cancelled) {
				return new SimpleComponent((width) => [truncateToWidth("cancelled", width)]);
			}
			if (text.startsWith("● ")) {
				text = text.slice(2);
			}
			const lines = text.split("\n");
			return new SimpleComponent((width) => lines.map((line) => truncateToWidth(line, width)));
		},
	});
}
