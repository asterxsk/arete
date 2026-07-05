import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import prettier from "prettier";
import type { ValidationFinding } from "../types.ts";

const require = createRequire(import.meta.url);

interface HtmlHintMessage {
  rule: { id: string };
  line: number;
  col: number;
  message: string;
  type: "error" | "warning" | "info";
}

interface HtmlHintLike {
  verify(html: string, ruleset?: Record<string, unknown>): HtmlHintMessage[];
}

const { HTMLHint } = require("htmlhint") as { HTMLHint: HtmlHintLike };

export async function validateHtmlArtifact(
  entryPath: string,
): Promise<{ warnings: ValidationFinding[]; errors: ValidationFinding[] }> {
  const warnings: ValidationFinding[] = [];
  const errors: ValidationFinding[] = [];

  const original = await readFile(entryPath, "utf8");
  const formatted = await formatHtml(original, entryPath, warnings);
  if (formatted !== original) {
    await writeFile(entryPath, formatted);
  }

  warnings.push(...lintHtml(formatted, entryPath));
  warnings.push(...findCspWarnings(formatted, entryPath));
  warnings.push(...findChartWarnings(formatted, entryPath));

  return { warnings, errors };
}

async function formatHtml(
  html: string,
  entryPath: string,
  warnings: ValidationFinding[],
): Promise<string> {
  try {
    return await prettier.format(html, { filepath: entryPath, parser: "html" });
  } catch (error) {
    warnings.push({
      code: "prettier",
      message: `Prettier could not format html: ${messageFromError(error)}`,
      file: entryPath,
    });
    return html;
  }
}

function lintHtml(html: string, entryPath: string): ValidationFinding[] {
  const messages = HTMLHint.verify(html, {
    "tagname-lowercase": true,
    "attr-lowercase": true,
    "attr-value-double-quotes": true,
    "attr-no-duplication": true,
    "tag-pair": true,
    "spec-char-escape": true,
    "id-unique": true,
    "src-not-empty": true,
    "empty-tag-not-self-closed": true,
  });

  return messages.map((message) => ({
    code: `htmlhint/${message.rule.id}`,
    message: message.message,
    file: entryPath,
    line: message.line,
    column: message.col,
  }));
}

function findCspWarnings(html: string, entryPath: string): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    const attrs = match[1] ?? "";
    const body = (match[2] ?? "").trim();
    const typeMatch = /type\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const type = typeMatch?.[1]?.toLowerCase();
    const isData =
      type === "application/json" || type === "application/ld+json";
    const hasSrc = /\bsrc\s*=/.test(attrs);

    if (hasSrc) {
      pushAt(findings, html, match.index, {
        code: "csp/script-src",
        message:
          "Authored <script src> files are not allowed in artifacts. Use the injected runtime capabilities instead.",
        file: entryPath,
      });
    }
    if (!isData && !hasSrc && body.length > 0) {
      pushAt(findings, html, match.index, {
        code: "csp/inline-script",
        message:
          "Inline <script> executes JS and is blocked by the artifact CSP. Use the chart spec convention or injected runtime capability.",
        file: entryPath,
      });
    }
  }

  for (const match of html.matchAll(/\son[a-z]+\s*=\s*["']/gi)) {
    pushAt(findings, html, match.index, {
      code: "csp/inline-handler",
      message:
        "Inline event handlers (on*=) are blocked by the artifact CSP. Use CSS-only interactivity.",
      file: entryPath,
    });
  }

  for (const match of html.matchAll(
    /(?:href|src)\s*=\s*["']\s*javascript:/gi,
  )) {
    pushAt(findings, html, match.index, {
      code: "csp/javascript-url",
      message: "javascript: URLs are blocked by the artifact CSP.",
      file: entryPath,
    });
  }

  return findings;
}

function findChartWarnings(
  html: string,
  entryPath: string,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  for (const match of html.matchAll(
    /<canvas\b[^>]*\bdata-chart\b[\s\S]*?<\/canvas>|<canvas\b[^>]*\bdata-chart\b[^>]*\/?>/gi,
  )) {
    const fragment = html.slice(match.index, match.index + 600);
    const hasSpec =
      /class\s*=\s*["'][^"']*\bpi-chart-spec\b/i.test(fragment) ||
      /type\s*=\s*["']application\/json["']/i.test(fragment);
    if (!hasSpec) {
      pushAt(findings, html, match.index, {
        code: "chart/missing-spec",
        message:
          'A <canvas data-chart> needs a sibling <script type="application/json" class="pi-chart-spec"> Chart.js config to render.',
        file: entryPath,
      });
    }
  }

  return findings;
}

function pushAt(
  findings: ValidationFinding[],
  html: string,
  index: number | undefined,
  finding: Omit<ValidationFinding, "line">,
): void {
  findings.push({
    ...finding,
    line: index === undefined ? undefined : lineForIndex(html, index),
  });
}

function lineForIndex(value: string, index: number): number {
  return value.slice(0, index).split("\n").length;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
