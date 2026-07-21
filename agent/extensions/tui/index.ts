// tui extension — aggregator module for shared TUI components
// Exports components and utilities via globalThis.__pi_tui bridge

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ThinkingComponent } from "./thinking";
import { BoxedEditor, registerBar } from "./bar";
import {
  QuestionsComponent,
  normalizeLabel,
  buildQuestions,
  formatAnswer,
  makeResult,
  formatAnswerSummary,
} from "./questions";
import type { QuestionInput, Question } from "./questions";
import { patchThinkingRendering } from "./patch-thinking";
import { renderMemorySearchCall, renderMemorySearchResult } from "./memory";
import { registerToolRenderers } from "./tools/register.js";

// ── Bridge exports ───────────────────────────────────────────────────

export type { QuestionInput, Question } from "./questions";

export {
  ThinkingComponent,
  BoxedEditor,
  QuestionsComponent,
  normalizeLabel,
  buildQuestions,
  formatAnswer,
  makeResult,
  formatAnswerSummary,
  renderMemorySearchCall,
  renderMemorySearchResult,
};

// ── Extension entry ──────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Self-register in global feature registry
  (globalThis as any).__pi_extension_features?.push({
    name: "tui",
    description: "Shared TUI components: thinking block, boxed editor bar, questions dialog",
    commands: [],
    tools: [],
  });

  // Register components on global bridge for other extensions to import
  (globalThis as any).__pi_tui = {
    ThinkingComponent,
    BoxedEditor,
    QuestionsComponent,
    normalizeLabel,
    buildQuestions,
    formatAnswer,
    makeResult,
    formatAnswerSummary,
    renderMemorySearchCall,
    renderMemorySearchResult,
  };

  // Wire up the boxed editor (replaces default editor border + animates during agent turn)
  registerBar(pi);

  // Re-register built-in tools with the unified per-tool renderers (glow label +
  // ↳ summary + separator). Must run after registerBar so the TUI is ready.
  registerToolRenderers(pi);

  // Monkey-patch AssistantMessageComponent to use ThinkingComponent (with ┃ prefix) instead of native italic Markdown for thinking blocks
  patchThinkingRendering();
}
