import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { ValidationFinding } from "../types.ts";

const _mdRequire = createRequire(import.meta.url);

// Lazy-load deps so missing npm modules don't crash Pi on startup
let _prettier: typeof import("prettier") | undefined;
let _markdownlintLint: ((opts: any) => Promise<Record<string, any[]>>) | undefined;
let _katexRenderToString: ((expr: string, opts?: any) => string) | undefined;

function ensureDeps(): boolean {
  try {
    if (!_prettier) _prettier = _mdRequire("prettier") as typeof import("prettier");
    if (!_markdownlintLint) {
      const m = _mdRequire("markdownlint/promise") as { lint: typeof _markdownlintLint };
      _markdownlintLint = m.lint;
    }
    if (!_katexRenderToString) {
      const k = _mdRequire("katex") as { renderToString: typeof _katexRenderToString };
      _katexRenderToString = k.renderToString;
    }
    return true;
  } catch {
    return false;
  }
}

export async function validateMarkdownArtifact(
  entryPath: string,
): Promise<{ warnings: ValidationFinding[]; errors: ValidationFinding[] }> {
  const warnings: ValidationFinding[] = [];
  const errors: ValidationFinding[] = [];

  const original = await readFile(entryPath, "utf8");
  const formatted = await formatMarkdown(original, entryPath, warnings);
  if (formatted !== original) {
    await writeFile(entryPath, formatted);
  }

  warnings.push(...(await lintMarkdown(formatted, entryPath)));
  warnings.push(...findMermaidWarnings(formatted, entryPath));
  warnings.push(...findPortabilityWarnings(formatted, entryPath));
  errors.push(...findKatexErrors(formatted, entryPath));

  return { warnings, errors };
}

async function formatMarkdown(
  markdown: string,
  entryPath: string,
  warnings: ValidationFinding[],
): Promise<string> {
  if (!ensureDeps() || !_prettier) {
    warnings.push({ code: "prettier", message: "Prettier not available — install npm deps in agent/extensions/artifacts/", file: entryPath });
    return markdown;
  }
  try {
    return await _prettier.format(markdown, {
      filepath: entryPath,
      parser: "markdown",
    });
  } catch (error) {
    warnings.push({
      code: "prettier",
      message: `Prettier could not format markdown: ${messageFromError(error)}`,
      file: entryPath,
    });
    return markdown;
  }
}

async function lintMarkdown(
  markdown: string,
  entryPath: string,
): Promise<ValidationFinding[]> {
  if (!ensureDeps() || !_markdownlintLint) {
    return [{ code: "markdownlint/missing", message: "markdownlint not available — install npm deps in agent/extensions/artifacts/", file: entryPath }];
  }
  const results = await _markdownlintLint({
    strings: { [entryPath]: markdown },
    config: {
      default: true,
      MD013: false,
    },
    resultVersion: 3,
  });

  return (results[entryPath] ?? []).map((error) => ({
    code: error.ruleNames[0] ?? "markdownlint",
    message: `${error.ruleDescription}${
      error.errorDetail ? `: ${error.errorDetail}` : ""
    }`,
    file: entryPath,
    line: error.lineNumber,
    column: error.errorRange?.[0],
  }));
}

function findKatexErrors(
  markdown: string,
  entryPath: string,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const scanText = stripFencedCodeBlocks(markdown);

  for (const match of scanText.matchAll(/\$\$([\s\S]+?)\$\$/g)) {
    const expression = match[1];
    if (match.index === undefined || expression === undefined) continue;
    const line = lineForIndex(scanText, match.index);
    validateKatexExpression({
      expression: expression.trim(),
      displayMode: true,
      entryPath,
      line,
      findings,
    });
  }

  for (const match of scanText.matchAll(/(?<!\$)\$([^\n$]+?)\$(?!\$)/g)) {
    const expression = match[1];
    if (match.index === undefined || expression === undefined) continue;
    const line = lineForIndex(scanText, match.index);
    validateKatexExpression({
      expression: expression.trim(),
      displayMode: false,
      entryPath,
      line,
      findings,
    });
  }

  return findings;
}

function validateKatexExpression(input: {
  expression: string;
  displayMode: boolean;
  entryPath: string;
  line: number;
  findings: ValidationFinding[];
}): void {
  try {
    if (!ensureDeps() || !_katexRenderToString) {
      input.findings.push({
        code: "katex",
        message: "KaTeX not available — install npm deps in agent/extensions/artifacts/",
        file: input.entryPath,
        line: input.line,
      });
      return;
    }
    _katexRenderToString(input.expression, {
      displayMode: input.displayMode,
      throwOnError: true,
      strict: "error",
    });
  } catch (error) {
    input.findings.push({
      code: "katex",
      message: `Invalid LaTeX math: ${messageFromError(error)}`,
      file: input.entryPath,
      line: input.line,
    });
  }
}



function findMermaidWarnings(
  markdown: string,
  entryPath: string,
): ValidationFinding[] {
  const warnings: ValidationFinding[] = [];

  for (const match of markdown.matchAll(/^[ \t]*(?:```|~~~)mermaid\b/gim)) {
    if (match.index === undefined) continue;
    warnings.push({
      code: "mermaid/not-validated",
      message:
        "Mermaid diagrams are rendered as fenced code; syntax validation is deferred until a headless parser is added.",
      file: entryPath,
      line: lineForIndex(markdown, match.index),
    });
  }

  return warnings;
}

function findPortabilityWarnings(
  markdown: string,
  entryPath: string,
): ValidationFinding[] {
  const warnings: ValidationFinding[] = [];
  const scanText = stripFencedCodeBlocks(markdown);

  pushRegexWarnings({
    warnings,
    markdown: scanText,
    entryPath,
    regex: /!?\[\[[^\]]+\]\]/g,
    code: "portable-markdown/wikilink",
    message:
      "Wikilinks and Obsidian embeds are not portable; use standard Markdown links/images.",
  });

  pushRegexWarnings({
    warnings,
    markdown: scanText,
    entryPath,
    regex: /^[ \t]*\^[A-Za-z0-9_-]+[ \t]*$/gm,
    code: "portable-markdown/block-reference",
    message: "Obsidian block references are not portable Markdown.",
  });

  pushRegexWarnings({
    warnings,
    markdown: scanText,
    entryPath,
    regex: /<[A-Za-z][^>]*(?:\s(?:class|style)=)[^>]*>/g,
    code: "portable-markdown/raw-html-styling",
    message:
      "Raw HTML class/style attributes reduce portability across renderers.",
  });

  return warnings;
}

function pushRegexWarnings(input: {
  warnings: ValidationFinding[];
  markdown: string;
  entryPath: string;
  regex: RegExp;
  code: string;
  message: string;
}): void {
  for (const match of input.markdown.matchAll(input.regex)) {
    if (match.index === undefined) continue;
    input.warnings.push({
      code: input.code,
      message: input.message,
      file: input.entryPath,
      line: lineForIndex(input.markdown, match.index),
    });
  }
}

function stripFencedCodeBlocks(markdown: string): string {
  const lines = markdown.split(/(\r?\n)/);
  let inFence = false;
  let fenceMarker: "```" | "~~~" | undefined;

  return lines
    .map((segment) => {
      if (segment === "\n" || segment === "\r\n") return segment;
      const trimmed = segment.trimStart();
      if (!inFence && (trimmed.startsWith("```") || trimmed.startsWith("~~~"))) {
        inFence = true;
        fenceMarker = trimmed.startsWith("```") ? "```" : "~~~";
        return "";
      }
      if (inFence) {
        if (fenceMarker && trimmed.startsWith(fenceMarker)) {
          inFence = false;
          fenceMarker = undefined;
        }
        return "";
      }
      return segment;
    })
    .join("");
}

function lineForIndex(value: string, index: number): number {
  return value.slice(0, index).split("\n").length;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
