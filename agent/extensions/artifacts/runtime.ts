import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/**
 * Shared client runtime, served under `/runtime/<namespace>/<path>`.
 * Each namespace maps to a directory root; requests are confined to that root.
 *
 * - `katex`   — KaTeX CSS + fonts (markdown math)
 * - `chartjs` — Chart.js UMD bundle
 * - `pico`    — Pico CSS (classless semantic base for html stack)
 * - `pi`      — this extension's own runtime assets
 */
export const RUNTIME_ROOTS: Record<string, string> = {
  katex: dirname(require.resolve("katex/dist/katex.min.css")),
  chartjs: dirname(require.resolve("chart.js")),
  pico: dirname(require.resolve("@picocss/pico/css/pico.classless.min.css")),
  pi: join(dirname(fileURLToPath(import.meta.url)), "runtime"),
};

export const RUNTIME_URLS = {
  katexCss: "/runtime/katex/katex.min.css",
  picoCss: "/runtime/pico/pico.classless.min.css",
  chartJs: "/runtime/chartjs/chart.umd.js",
  chartHydrateJs: "/runtime/pi/chart-hydrate.js",
  viewerLiveJs: "/runtime/pi/viewer-live.js",
  icons: "/runtime/pi/icons.svg",
} as const;
