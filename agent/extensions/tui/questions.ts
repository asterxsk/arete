// questions component — interactive TUI dialog for structured multi-choice questions

import { Input, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

// ── Types ────────────────────────────────────────────────────────────

export interface QuestionOptionInput {
  value: string;
  label: string;
  description?: string;
}

export interface QuestionInput {
  id: string;
  label?: string;
  prompt: string;
  sketch?: string;
  options?: QuestionOptionInput[];
  isMultiSelect?: boolean;
  allowWriteIn?: boolean;
}

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface Question {
  id: string;
  label: string;
  prompt: string;
  sketch?: string;
  options: QuestionOption[];
  isMultiSelect?: boolean;
  allowWriteIn?: boolean;
}

export type AnswerSource = "option" | "custom";

export interface Answer {
  questionId: string;
  questionLabel: string;
  value: string;
  label: string;
  source: AnswerSource;
  optionIndex?: number;
  optionValue?: string;
}

export interface QuestionsResult {
  questions: Question[];
  answers: Answer[];
  cancelled: boolean;
  submitted: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────

export function normalizeLabel(label: string | undefined, fallback: string): string {
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

export function buildQuestions(questions: QuestionInput[]): Question[] {
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

export function formatAnswer(answer: Answer): string {
  if (answer.source === "custom") {
    return `${answer.questionLabel}: (wrote) ${answer.value}`;
  }
  const prefix = typeof answer.optionIndex === "number" ? `${answer.optionIndex}. ` : "";
  return `${answer.questionLabel}: ${prefix}${answer.label}`;
}

export function makeResult(
  questions: Question[],
  answers: Answer[],
  cancelled: boolean,
  submitted: boolean,
): QuestionsResult {
  return { questions, answers, cancelled, submitted };
}

/** Build the indented answer-summary text shown after a question resolves.
 *  Each line is prefixed with the same grey "┃ " used by ThinkingComponent so
 *  the block aligns flush with assistant thinking lines. */
export function formatAnswerSummary(questions: Question[], result: QuestionsResult): string {
  if (result.cancelled) return "cancelled";
  const qLines = questions.map((q) => {
    const qAnswers = result.answers.filter((a) => a.questionId === q.id);
    const prompt = q.prompt;
    const answerText =
      qAnswers.length > 0 ? qAnswers.map((a) => a.label).join(", ") : "(no answer)";
    return `${"\u238b  \u00b7 "}${prompt} \u2192 ${answerText}`;
  });
  const count = questions.length;
  const header = `User answered ${count} question${count === 1 ? "" : "s"}:`;
  // 1-space indent (no pipe) to align flush with ThinkingComponent lines.
  return [header, ...qLines].map((l) => ` ${l}`).join("\n");
}

// ── Simple Component wrapper ─────────────────────────────────────────

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

// ── Component ────────────────────────────────────────────────────────

export class QuestionsComponent {
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

  private currentOptions(): Array<QuestionOption & { isCustom?: boolean; isDone?: boolean }> {
    const question = this.currentQuestion();
    if (!question) return [];
    const opts: Array<QuestionOption & { isCustom?: boolean; isDone?: boolean }> = [
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
    if (savedAnswers?.some((a) => a.source === "custom")) {
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
        this.answerValue.set(
          question.id,
          values.filter((a) => a.optionIndex !== index + 1),
        );
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
    const answers = this.questions.flatMap((question) => this.answerValue.get(question.id) || []);
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
        const customAnswer = current?.find((a) => a.source === "custom");
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
    const marker = completed ? "\u25a0" : "\u25a1";
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
    return truncateToWidth(`\u2190 ${pieces.join(" ")} \u2192`, width);
  }

  private renderWidthLine(text: string, width: number): string {
    return truncateToWidth(text, width);
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const lines: string[] = [];
    const add = (text: string) => lines.push(this.renderWidthLine(text, width));
    const question = this.currentQuestion();

    add(this.theme.fg("accent", "\u2500".repeat(Math.max(0, width))));

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
        const values = answers
          .map((answer) =>
            answer.source === "custom"
              ? `${this.theme.fg("muted", "(wrote)")} ${answer.label}`
              : `${answer.optionIndex}. ${answer.label}`,
          )
          .join(", ");
        add(`${this.theme.fg("muted", q.label + ":")} ${this.theme.fg("text", values)}`);
      }
      lines.push("");
      if (this.allAnswered()) {
        add(
          this.theme.fg(
            "dim",
            " Enter to submit \u2022 Tab / Shift+Tab to edit answers \u2022 Esc cancel",
          ),
        );
      } else {
        const missing = this.questions
          .filter((q) => {
            const vals = this.answerValue.get(q.id);
            return !vals || vals.length === 0;
          })
          .map((q) => q.label)
          .join(", ");
        add(this.theme.fg("warning", `Missing: ${missing}`));
        add(this.theme.fg("dim", "Tab to jump to a question and fix it \u2022 Esc cancel"));
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
          label = `${checked ? "\u25a0" : "\u25a1"} ${opt.label}`;
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
        ? question.isMultiSelect
          ? " Tab/\u2190\u2192 switch tabs \u2022 \u2191\u2193 options \u2022 Space check \u2022 Enter send \u2022 Esc cancel"
          : " Tab/\u2190\u2192 switch tabs \u2022 \u2191\u2193 options \u2022 Enter select \u2022 Esc cancel"
        : question.isMultiSelect
          ? " Space check \u2022 Enter send \u2022 Esc cancel"
          : " \u2191\u2193 options \u2022 Enter select \u2022 Esc cancel";
      add(this.theme.fg("dim", help));
    }

    add(this.theme.fg("accent", "\u2500".repeat(Math.max(0, width))));

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
