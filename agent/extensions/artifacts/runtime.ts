import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const _rtRequire = createRequire(import.meta.url);

type RuntimeRoots = Record<string, string | undefined>;

/**
 * Shared client runtime, served under `/runtime/<namespace>/<path>`.
 * Each namespace maps to a directory root; requests are confined to that root.
 *
 * - `katex`   — KaTeX CSS + fonts (markdown math)
 * - `chartjs` — Chart.js UMD bundle
 * - `pico`    — Pico CSS (classless semantic base for html stack)
 * - `pi`      — this extension's own runtime assets
 */
export const RUNTIME_ROOTS: RuntimeRoots = resolveRuntimeRoots();

function resolveRuntimeRoots(): RuntimeRoots {
  const piRoot = join(dirname(fileURLToPath(import.meta.url)), "runtime");
  const roots: RuntimeRoots = { pi: piRoot };

  for (const [name, resolvePath] of [
    ["katex", "katex/dist/katex.min.css"],
    ["chartjs", "chart.js"],
    ["pico", "@picocss/pico/css/pico.classless.min.css"],
  ] as const) {
    try {
      roots[name] = dirname(_rtRequire.resolve(resolvePath));
    } catch {
      console.warn(`[artifacts] Missing npm dep '${name}'. Run \`npm install\` in agent/extensions/artifacts/. ${name === "katex" ? "KaTeX" : name === "chartjs" ? "Chart.js" : "Pico CSS"} runtime disabled.`);
    }
  }

  return roots;
}

export const RUNTIME_URLS = {
  katexCss: "/runtime/katex/katex.min.css",
  picoCss: "/runtime/pico/pico.classless.min.css",
  chartJs: "/runtime/chartjs/chart.umd.js",
  chartHydrateJs: "/runtime/pi/chart-hydrate.js",
  viewerLiveJs: "/runtime/pi/viewer-live.js",
  icons: "/runtime/pi/icons.svg",
} as const;
