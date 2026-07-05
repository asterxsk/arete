import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeArtifact, listArtifacts as listLegacyArtifacts } from "./storage.ts";
import type { ArtifactType } from "./storage.ts";
import { ArtifactInfo } from "./storage.ts";
import { openInBrowser, getFriendlyFileUri } from "./open-browser.ts";
import { showArtifactList } from "./list-view.ts";
import { findArtifactByValue } from "./list-helpers.ts";
import { openMarkdownReader } from "./md-reader.ts";
import { createPreviewServerState, type PreviewServerState } from "./server.ts";
import {
  artifactsRoot,
  deleteArtifact as deleteStoreArtifact,
  listArtifacts as listStoreArtifacts,
  loadArtifact,
  scaffoldArtifact,
  writeManifest,
} from "./store.ts";
import { getSessionFile, sessionKeyFromFile } from "./session.ts";
import { validateHtmlArtifact } from "./validation/html.ts";
import { validateMarkdownArtifact } from "./validation/markdown.ts";
import type { ArtifactRenderStatus, ValidationFinding } from "./types.ts";
import { isSupportedStack } from "./manifest.ts";
import {
  openViewerWindow,
  type ViewerWindow,
  type ViewerWindowMode,
} from "./viewer-launcher.ts";
import {
  isViewerMode,
  readAutoOpen,
  readViewerMode,
  writeAutoOpen,
  writeViewerMode,
} from "./viewer-config.ts";

interface ScaffoldArtifactParams {
  type: string;
  title: string;
}

interface RenderArtifactParams {
  id: string;
}

interface DeleteArtifactParams {
  id: string;
}

interface PreviewServerAccessor {
  get: () => Promise<PreviewServerState>;
  peek: () => PreviewServerState | undefined;
  close: () => Promise<void>;
}

interface ViewerWindowManager {
  open: (url: string, preferred?: ViewerWindowMode) => Promise<ViewerWindow>;
  isOpen: () => boolean;
  close: () => Promise<void>;
}

export default function (pi: ExtensionAPI) {
  (globalThis as any).__pi_artifacts_api = pi;

  (globalThis as any).__pi_extension_features?.push({
    name: "artifacts",
    description:
      "Create, validate, preview, and browse standalone html/md artifacts — /artifacts for terminal list, /viewer for web gallery, /viewer-mode and /viewer-auto for preferences",
    commands: ["/artifacts", "/viewer", "/viewer-mode", "/viewer-auto"],
    tools: ["create_artifact", "render_artifact", "list_artifacts", "delete_artifact", "check_artifact"],
  });

  const previewServer = createPreviewServerAccessor();
  const viewerWindow = createViewerWindowManager();

  registerPreviewLifecycle(pi, previewServer, viewerWindow);
  registerArtifactsCommand(pi);
  registerCreateArtifactTool(pi);
  registerScaffoldTool(pi);
  registerRenderTool(pi, previewServer, viewerWindow);
  registerListTool(pi);
  registerDeleteTool(pi, previewServer);
  registerViewerCommand(pi, previewServer, viewerWindow);
  registerViewerModeCommand(pi);
  registerViewerAutoCommand(pi);
  registerCheckArtifactTool(pi);
}

function createViewerWindowManager(): ViewerWindowManager {
  let current: ViewerWindow | undefined;

  return {
    async open(url, preferred) {
      await current?.close();
      current = await openViewerWindow(url, preferred);
      return current;
    },
    isOpen() {
      return current !== undefined && current.mode !== "none";
    },
    async close() {
      await current?.close();
      current = undefined;
    },
  };
}

function createPreviewServerAccessor(): PreviewServerAccessor {
  let previewServer: PreviewServerState | undefined;

  return {
    async get() {
      previewServer ??= await createPreviewServerState();
      return previewServer;
    },
    peek() {
      return previewServer;
    },
    async close() {
      await previewServer?.close();
      previewServer = undefined;
    },
  };
}

function registerPreviewLifecycle(
  pi: ExtensionAPI,
  previewServer: PreviewServerAccessor,
  viewerWindow: ViewerWindowManager,
): void {
  pi.on("session_start", async (_event, ctx) => {
    const server = await previewServer.get();
    const sessionFile = getSessionFile(ctx);
    server.setSessionKey(
      sessionFile ? sessionKeyFromFile(sessionFile) : undefined,
    );
    server.broadcastUpdate();
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    await viewerWindow.close();
    await previewServer.close();
  });
}

function registerCreateArtifactTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "create_artifact",
    label: "Create Artifact",
    description:
      "Save a standalone HTML page or Markdown document as an artifact the user can open with /artifacts. Calling again with the same name and type overwrites/updates that artifact.",
    promptSnippet: "Save an html or md artifact for the user to view",
    promptGuidelines: [
      "Use create_artifact when producing a complete standalone HTML page or a markdown document meant to be viewed on its own, not inline in the chat.",
      "Use create_artifact with the same name and type to revise an artifact you already created.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Short identifier for the artifact, used as its filename" }),
      type: StringEnum(["html", "md"] as const),
      content: Type.String({ description: "Full file content" }),
    }),
    renderShell: "self",
    renderCall() {
      return new Text("", 0, 0);
    },
    renderResult() {
      return new Text("", 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { path: artifactPath, created } = writeArtifact(
        ctx.cwd,
        params.name,
        params.type as ArtifactType,
        params.content,
      );
      const relativePath = path.relative(ctx.cwd, artifactPath);
      ctx.ui.notify(`${created ? "Saved" : "Updated"} artifact: ${relativePath}`, "success");
      return {
        content: [{ type: "text", text: `${created ? "Created" : "Updated"} artifact at ${relativePath}` }],
        details: { path: artifactPath, created },
      };
    },
  });
}

function registerScaffoldTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "scaffold_artifact",
    label: "Scaffold Artifact",
    description:
      "Create an empty artifact bundle (manifest + blank entry + assets/) to author into. " +
      "Returns { id, path, entry, manifestPath }. Writes no content beyond bundle structure.",
    promptSnippet: "Create an empty artifact bundle to author into",
    parameters: Type.Object({
      type: Type.Union([Type.Literal("markdown"), Type.Literal("html")], {
        description:
          'Artifact stack: "markdown" (Prettier/markdownlint/KaTeX pipeline) or "html" (authored index.html served under baseline CSP).',
      }),
      title: Type.String({ description: "Human-readable artifact title." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeScaffoldArtifact(params as ScaffoldArtifactParams, ctx);
    },
  });
}

async function executeScaffoldArtifact(
  input: ScaffoldArtifactParams,
  ctx: unknown,
) {
  if (!isSupportedStack(input.type)) {
    throw new Error(`Unsupported artifact type: ${input.type}`);
  }

  const sessionFile = getSessionFile(ctx);
  const details = await scaffoldArtifact({
    title: input.title,
    stack: input.type as "markdown" | "html",
    cwd: (ctx as { cwd?: string }).cwd ?? process.cwd(),
    sessionFile,
    sessionKey: sessionFile ? sessionKeyFromFile(sessionFile) : undefined,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: `Created ${input.type} artifact ${details.id} at ${details.path}. Author content in ${details.entry}, then call render_artifact with id "${details.id}".`,
      },
    ],
    details,
  };
}

function registerRenderTool(
  pi: ExtensionAPI,
  previewServer: PreviewServerAccessor,
  viewerWindow: ViewerWindowManager,
): void {
  pi.registerTool({
    name: "render_artifact",
    label: "Render Artifact",
    description:
      "Validate and normalize an authored bundle, then surface it in the viewer. " +
      "Returns { ok, warnings, errors, url? }. Re-render in place by passing the same id.",
    promptSnippet: "Validate and preview an authored artifact bundle",
    parameters: Type.Object({
      id: Type.String({
        description: "Artifact id returned by scaffold_artifact.",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      return executeRenderArtifact(
        params as RenderArtifactParams,
        previewServer,
        viewerWindow,
      );
    },
  });
}

async function maybeAutoOpen(
  server: PreviewServerState,
  viewerWindow: ViewerWindowManager,
  artifactId: string,
  artifactUrl: string,
): Promise<void> {
  if (!(await readAutoOpen())) return;

  if (viewerWindow.isOpen()) {
    server.broadcastNavigate(`/artifacts/${encodeURIComponent(artifactId)}/`);
    return;
  }

  const preferred = await readViewerMode();
  if (preferred === "none") return;
  await viewerWindow.open(artifactUrl, preferred);
}

async function executeRenderArtifact(
  input: RenderArtifactParams,
  previewServer: PreviewServerAccessor,
  viewerWindow: ViewerWindowManager,
) {
  try {
    const artifact = await loadArtifact(input.id);
    const validation = await validateArtifact(
      artifact.manifest.stack,
      artifact.entryPath,
    );

    const rendered = new Date().toISOString();
    const renderStatus = summarizeRenderStatus({
      ok: validation.errors.length === 0,
      warnings: validation.warnings,
      errors: validation.errors,
      rendered,
    });
    const updatedManifest = {
      ...artifact.manifest,
      updated: rendered,
      lastRender: renderStatus,
    };
    await writeManifest(artifact.id, updatedManifest);

    if (validation.errors.length > 0) {
      previewServer.peek()?.broadcastUpdate(artifact.id);
      return {
        content: [
          {
            type: "text" as const,
            text: `Artifact ${input.id} has ${validation.errors.length} render-blocking error(s) and was not previewed.`,
          },
        ],
        details: { ok: false, ...validation },
      };
    }

    const server = await previewServer.get();
    server.registerArtifact({
      id: artifact.id,
      path: artifact.path,
      entryPath: artifact.entryPath,
      manifest: updatedManifest,
    });
    const url = server.artifactUrl(artifact.id);
    server.broadcastUpdate(artifact.id);
    if (url) {
      await maybeAutoOpen(server, viewerWindow, artifact.id, url);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Artifact ${artifact.id} rendered successfully${
            validation.warnings.length > 0
              ? ` with ${validation.warnings.length} warning(s)`
              : ""
          }.${url ? ` Preview: ${url}` : ""}`,
        },
      ],
      details: { ok: true, ...validation, url },
    };
  } catch (error) {
    return renderFailure(error);
  }
}

function summarizeRenderStatus(input: {
  ok: boolean;
  warnings: ValidationFinding[];
  errors: ValidationFinding[];
  rendered: string;
}): ArtifactRenderStatus {
  return {
    ok: input.ok,
    warnings: input.warnings.length,
    errors: input.errors.length,
    rendered: input.rendered,
    ...(input.warnings.length > 0
      ? { warningCodes: [...new Set(input.warnings.map((w) => w.code))] }
      : {}),
    ...(input.errors.length > 0
      ? { errorCodes: [...new Set(input.errors.map((e) => e.code))] }
      : {}),
  };
}

function renderFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return {
    content: [
      { type: "text" as const, text: `render_artifact failed: ${message}` },
    ],
    details: {
      ok: false,
      warnings: [],
      errors: [{ code: "render_artifact", message }],
    },
  };
}

function registerListTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "list_artifacts",
    label: "List Artifacts",
    description:
      "List artifact bundles in the store, newest first. Returns { artifacts: [{ id, title, stack, updated, cwd }], count }.",
    promptSnippet: "List existing artifact bundles in the store",
    parameters: Type.Object({}),
    async execute() {
      const artifacts = await listStoreArtifacts();
      const rows = artifacts.map((a) => ({
        id: a.id,
        title: a.manifest.title,
        stack: a.manifest.stack,
        updated: a.manifest.updated,
        cwd: a.manifest.cwd,
        lastRender: a.manifest.lastRender,
      }));

      const summary = rows.length
        ? rows.map((r) => `- ${r.id} — ${r.title} (${r.stack})`).join("\n")
        : "No artifacts in the store.";

      return {
        content: [{ type: "text" as const, text: summary }],
        details: { artifacts: rows, count: rows.length },
      };
    },
  });
}

function registerDeleteTool(
  pi: ExtensionAPI,
  previewServer: PreviewServerAccessor,
): void {
  pi.registerTool({
    name: "delete_artifact",
    label: "Delete Artifact",
    description:
      "Delete an artifact bundle and all of its files from the store. Returns { ok, id }.",
    promptSnippet: "Delete an artifact bundle from the store",
    parameters: Type.Object({
      id: Type.String({ description: "Artifact id to delete." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const input = params as DeleteArtifactParams;
      try {
        await deleteStoreArtifact(input.id);
        const server = previewServer.peek();
        server?.unregisterArtifact(input.id);
        server?.broadcastUpdate();
        return {
          content: [{ type: "text" as const, text: `Deleted artifact ${input.id}.` }],
          details: { ok: true, id: input.id },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `delete_artifact failed: ${message}` }],
          details: { ok: false, id: input.id, error: message },
        };
      }
    },
  });
}

function registerViewerCommand(
  pi: ExtensionAPI,
  previewServer: PreviewServerAccessor,
  viewerWindow: ViewerWindowManager,
): void {
  pi.registerCommand("viewer", {
    description:
      "Open the artifacts viewer (web gallery scoped to the current session)",
    handler: async (_args, ctx) => {
      const server = await previewServer.get();
      if (!server.viewerUrl) {
        ctx.ui.notify("Artifact viewer is unavailable.", "warning");
        return;
      }

      const preferred = await readViewerMode();
      const window = await viewerWindow.open(server.viewerUrl, preferred);
      ctx.ui.notify(
        `${viewerOpenMessage(window.mode, server.viewerUrl)} Store: ${artifactsRoot()}`,
        "info",
      );
    },
  });
}

function registerViewerModeCommand(pi: ExtensionAPI): void {
  pi.registerCommand("viewer-mode", {
    description:
      "Set how /viewer opens: app (dedicated window), browser, or off (print URL). No argument shows the current setting.",
    handler: async (args, ctx) => {
      const requested = (args ?? "").trim().toLowerCase();

      if (!requested) {
        const current = (await readViewerMode()) ?? "app (default)";
        ctx.ui.notify(
          `Viewer mode: ${current}. Set with /viewer-mode app|browser|off.`,
          "info",
        );
        return;
      }

      const normalized = requested === "off" ? "none" : requested;
      if (!isViewerMode(normalized)) {
        ctx.ui.notify(
          `Unknown viewer mode "${requested}". Use app, browser, or off.`,
          "warning",
        );
        return;
      }

      await writeViewerMode(normalized);
      const label = normalized === "none" ? "off (print URL only)" : normalized;
      ctx.ui.notify(`Viewer mode set to ${label}.`, "info");
    },
  });
}

function registerViewerAutoCommand(pi: ExtensionAPI): void {
  pi.registerCommand("viewer-auto", {
    description:
      "Toggle whether rendering auto-opens the artifact in the viewer: on or off. No argument shows the current setting.",
    handler: async (args, ctx) => {
      const requested = (args ?? "").trim().toLowerCase();

      if (!requested) {
        const enabled = await readAutoOpen();
        ctx.ui.notify(
          `Render auto-open is ${enabled ? "on" : "off"}. Set with /viewer-auto on|off.`,
          "info",
        );
        return;
      }

      const enable =
        requested === "on" || requested === "true" || requested === "yes";
      const disable =
        requested === "off" || requested === "false" || requested === "no";
      if (!enable && !disable) {
        ctx.ui.notify(
          `Unknown value "${requested}". Use /viewer-auto on or off.`,
          "warning",
        );
        return;
      }

      await writeAutoOpen(enable);
      ctx.ui.notify(`Render auto-open ${enable ? "on" : "off"}.`, "info");
    },
  });
}

/**
 * Legacy /artifacts command — terminal list picker with markdown reader overlay.
 * This is kept for backward compatibility and enhanced with render status hints.
 */
function registerArtifactsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("artifacts", {
    description: "Browse generated artifacts (html/md) in the terminal",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("artifacts requires interactive mode", "error");
        return;
      }

      while (true) {
        const artifacts = listLegacyArtifacts(ctx.cwd);
        if (artifacts.length === 0) {
          ctx.ui.notify("No artifacts yet.", "info");
          return;
        }

        const selected = await showArtifactList(ctx, artifacts);
        if (!selected) {
          try { ctx.ui.notify(""); } catch {}
          return;
        }

        const artifact = findArtifactByValue(artifacts, selected.value);
        if (!artifact) continue;

        if (artifact.type === "html") {
          const result = await openInBrowser(artifact.path);
          if (result.ok) {
            ctx.ui.notify(`Opened ${artifact.name}.html in your browser.`, "info");
            setTimeout(() => { try { ctx.ui.notify(""); } catch {} }, 5000);
          } else {
            await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
              return {
                focused: true,
                render(width) {
                  const titleText = " Browser Open Failed ";
                  const titleLine = theme.fg("accent", "─".repeat(3)) +
                    theme.fg("accent", theme.bold(titleText)) +
                    theme.fg("accent", "─".repeat(Math.max(0, width - titleText.length - 3)));

                  const footerText = " Press Enter or Esc to dismiss ";
                  const footerLine = theme.fg("accent", "─".repeat(3)) +
                    theme.fg("dim", footerText) +
                    theme.fg("accent", "─".repeat(Math.max(0, width - footerText.length - 3)));

                  const lines = [
                    titleLine,
                    "",
                    "  Failed to open browser automatically:",
                    `  ${result.error}`,
                    "",
                    "  Please open manually:",
                    `  ${getFriendlyFileUri(artifact.path)}`,
                    "",
                    footerLine
                  ];
                  return lines.map(lineText => truncateToWidth(lineText, width));
                },
                handleInput(data) {
                  if (data === "\r" || data === "\n" || data === "\x1b") {
                    done();
                  }
                },
                invalidate() {}
              };
            });
          }
          continue;
        }

        await openMarkdownReader(ctx, artifact);
      }
    },
  });
}

function viewerOpenMessage(mode: ViewerWindow["mode"], url: string): string {
  switch (mode) {
    case "app":
      return `Artifact viewer opened in a dedicated window: ${url}.`;
    case "browser":
      return `Artifact viewer opened in your browser: ${url}.`;
    default:
      return `Artifact viewer: ${url} (open this URL manually).`;
  }
}

function validateArtifact(
  stack: string,
  entryPath: string,
): Promise<{ warnings: ValidationFinding[]; errors: ValidationFinding[] }> {
  switch (stack) {
    case "markdown":
      return validateMarkdownArtifact(entryPath);
    case "html":
      return validateHtmlArtifact(entryPath);
  }

  throw new Error(`Unsupported artifact stack: ${stack}`);
}

function extractCommentsFromFile(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const results: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^>\s*\*\*Comment\s*\(Line\s*(\d+)\):\*\*(.*)/i);
    if (match) {
      const lineNum = parseInt(match[1], 10);
      let commentText = match[2].trim();
      
      // Accumulate any multiline blockquotes immediately following
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith(">")) {
        // Skip if it's another new comment header
        if (lines[j].match(/^>\s*\*\*Comment\s*\(Line\s*(\d+)\):\*\*/i)) {
          break;
        }
        // Append comment text line (strip the leading > symbol)
        const subLineText = lines[j].slice(1).trim();
        commentText += "\n" + subLineText;
        j++;
      }
      
      // Get the original line (lineNum - 1 in index), if it exists and is not a comment itself
      let originalLineContent = "(line deleted or missing)";
      const targetIdx = lineNum - 1;
      if (targetIdx >= 0 && targetIdx < lines.length) {
        originalLineContent = lines[targetIdx];
      }

      results.push(
        `### Line ${lineNum}\n` +
        `**Content:**\n` +
        `\`\`\`\n` +
        `${originalLineContent}\n` +
        `\`\`\`\n` +
        `**Comments:**\n` +
        `${commentText}\n`
      );
      
      // Advance outer loop to skip accumulated lines
      i = j - 1;
    }
  }

  if (results.length === 0) {
    return "No comments found in this artifact.";
  }

  return results.join("\n---\n\n");
}

function registerCheckArtifactTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "check_artifact",
    label: "Check Artifact",
    description:
      "Scan an artifact for review comments and return only the commented lines and their comments in clean markdown format to save tokens.",
    promptSnippet: "Scan an artifact for review comments",
    parameters: Type.Object({
      id: Type.String({ description: "Artifact ID to check." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        let filePath = "";
        try {
          const bundle = await loadArtifact(params.id);
          filePath = bundle.entryPath;
        } catch {
          // Fallback to simple artifact file
          const dir = path.join((ctx as any).cwd, "artifacts");
          const possibleFiles = [
            path.join(dir, params.id),
            path.join(dir, `${params.id}.md`),
            path.join(dir, `${params.id}.html`),
            path.join((ctx as any).cwd, params.id),
          ];
          for (const p of possibleFiles) {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) {
              filePath = p;
              break;
            }
          }
        }

        if (!filePath) {
          throw new Error(`Could not find artifact file for ID or Name: "${params.id}"`);
        }

        const result = extractCommentsFromFile(filePath);
        return {
          content: [{ type: "text" as const, text: result }],
          details: { id: params.id, filePath, hasComments: !result.includes("No comments found") },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Failed to check artifact: ${message}` }],
          details: { error: message },
        };
      }
    },
  });
}
