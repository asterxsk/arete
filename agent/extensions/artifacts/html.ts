import { RUNTIME_URLS } from "./runtime.ts";
import {
  artifactChromeStyles,
  renderArtifactToolbar,
  type ArtifactPageChrome,
} from "./viewer-ui.ts";

export function renderHtmlPage(
  html: string,
  title: string,
  artifact?: string | ArtifactPageChrome,
): string {
  if (isFullDocument(html)) {
    return html;
  }

  const escapedTitle = escapeHtml(title);
  const artifactId = typeof artifact === "string" ? artifact : artifact?.id;
  const toolbar =
    typeof artifact === "object" ? renderArtifactToolbar(artifact) : "";
  const liveReload = artifactId
    ? `<script src="${RUNTIME_URLS.viewerLiveJs}" data-artifact-id="${escapeHtml(artifactId)}" defer></script>\n`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapedTitle}</title>
<link rel="stylesheet" href="${RUNTIME_URLS.picoCss}">
<style>
:root { --pico-spacing: 1rem; }
body { max-width: 72rem; margin: 0 auto; padding: 2rem; }
img, svg, canvas { max-width: 100%; height: auto; }
figure { margin: 1.5rem 0; }
.pi-icon { width: 1.2em; height: 1.2em; vertical-align: -0.2em; }
${artifactChromeStyles()}
</style>
<script src="${RUNTIME_URLS.chartJs}" defer></script>
<script src="${RUNTIME_URLS.chartHydrateJs}" defer></script>
${liveReload}</head>
<body>
${toolbar}
${html}
</body>
</html>
`;
}

function isFullDocument(html: string): boolean {
  return /<!doctype\s+html|<html[\s>]/i.test(html);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
