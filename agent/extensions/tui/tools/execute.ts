// tui/tools/execute.ts — combined `Execute` tool.
//
// A single tool implementation that subsumes the previously separate `bash`,
// `pwsh` (and `powershell` alias) tools. It accepts:
//
//   { command: string, shell?: "pwsh" | "bash" }
//
// and resolves the shell as follows:
//   - explicit `shell` param always wins (overrides platform default),
//   - otherwise default to `pwsh` on Windows (win32) and `bash` elsewhere.
//
// Spawning mirrors the existing implementations:
//   - pwsh  → spawns `powershell.exe -EncodedCommand <utf16le base64>` (mirror of
//             extensions/powershell/index.ts),
//   - bash  → delegates to the host `createBashTool` factory.
//
// Rendering is delegated to resolveTemplate in rendering.ts, which routes
// bash/pwsh/powershell tool names to executeTemplate.
//
// The tool is registered under three aliases — `bash`, `pwsh`, `powershell` —
// so any of those names route to this single implementation.
//
// Shell selection is isolated into the pure, exported helpers `defaultShellFor`
// and `selectShell` so it can be unit-tested deterministically with an injected
// platform (no real `process.platform` dependency in tests).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "child_process";
import { createBashTool } from "@earendil-works/pi-coding-agent";

import { patchTool } from "./rendering.js";

/** Aliases that all route to this single tool. */
export const ALIASES = ["bash", "pwsh", "powershell"] as const;
export type Alias = (typeof ALIASES)[number];

/** Shells supported by Execute. */
export type ShellName = "pwsh" | "bash";

/** Parameters accepted by Execute. */
export interface ExecuteParams {
  command: string;
  shell?: ShellName;
}

// ── Shell selection (pure + injected-platform for tests) ─────────────

/** Default shell for a given platform. win32 → pwsh, else bash. */
export function defaultShellFor(platform: NodeJS.Platform): ShellName {
  return platform === "win32" ? "pwsh" : "bash";
}

/** Resolve the shell: explicit param overrides the platform default. */
export function selectShell(shell: ShellName | undefined, platform: NodeJS.Platform): ShellName {
  return shell ?? defaultShellFor(platform);
}

// ── Execution ────────────────────────────────────────────────────────

/** UTF-16LE base64 of the command, mirroring extensions/powershell/index.ts. */
function encodeCommand(command: string): string {
  return Buffer.from(command, "utf16le").toString("base64");
}

/** Wrap a host/factory result, injecting _fullOutput + chosen shell. */
function capture(result: any, shell: ShellName, durationMs?: number): any {
  const fullText =
    result?.content?.map((c: any) => (c.type === "text" ? c.text : "")).join("\n") ?? "";
  return {
    ...result,
    details: {
      ...result?.details,
      _fullOutput: fullText,
      shell,
      _durationS: (durationMs ?? 0) / 1000,
    },
  };
}

/** Spawn powershell.exe via -EncodedCommand (mirror of extensions/powershell). */
function spawnPwsh(command: string, cwd: string, signal: any): Promise<any> {
  const start = Date.now();
  const encodedCommand = encodeCommand(command);
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodedCommand,
      ],
      { windowsHide: true, cwd },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("close", (code: number) => {
      const elapsed = (Date.now() - start) / 1000;
      const combined = stdout + (stdout && stderr ? "\n" : "") + stderr;
      const text = combined.trim() || "(no output)";
      const isError = code !== 0;
      return resolve(
        capture(
          {
            content: [{ type: "text", text }],
            details: { exitCode: code, stderr, stdout, command },
            isError,
          },
          "pwsh",
          elapsed * 1000,
        ),
      );
    });
    child.on("error", (err: Error) => {
      resolve(
        capture(
          {
            content: [{ type: "text", text: "Failed to start PowerShell: " + err.message }],
            details: {},
            isError: true,
          },
          "pwsh",
          Date.now() - start,
        ),
      );
    });
    if (signal) {
      const abort = () => {
        if (!child.killed) child.kill();
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
  });
}

/** Delegate to the host bash tool. */
async function runBash(
  bashTool: any,
  toolCallId: string,
  command: string,
  signal: any,
  onUpdate: any,
): Promise<any> {
  const start = Date.now();
  const res = await bashTool.execute(toolCallId, { command }, signal, onUpdate);
  return capture(res, "bash", Date.now() - start);
}

/**
 * Build the unified `execute` for Execute. `platform` is injectable for tests;
 * defaults to `process.platform` at call time.
 */
export function makeExecute(cwd: string, platform?: NodeJS.Platform) {
  const bashTool = createBashTool(cwd);
  return async (
    toolCallId: string,
    params: ExecuteParams,
    signal: any,
    onUpdate: any,
  ): Promise<any> => {
    const plat = platform ?? process.platform;
    const shell = selectShell(params.shell, plat);
    if (shell === "pwsh") {
      return spawnPwsh(params.command, cwd, signal);
    }
    return runBash(bashTool, toolCallId, params.command, signal, onUpdate);
  };
}

// ── Registration (aliases → single implementation) ───────────────────

const EXECUTE_PARAMETERS = {
  type: "object",
  properties: {
    command: { type: "string", description: "Command or script to execute" },
    shell: {
      type: "string",
      enum: ["pwsh", "bash"],
      description: "Shell to run the command in. Defaults to pwsh on Windows, bash elsewhere.",
    },
  },
  required: ["command"],
} as const;

const EXECUTE_DESCRIPTION =
  "Execute a command or script in a shell. Defaults to PowerShell (pwsh) on Windows and bash on other platforms; the shell can be overridden with the `shell` parameter. Accepts `bash`, `pwsh`, and `powershell` as tool names.";

/** Register Execute under all three aliases (bash, pwsh, powershell). */
export function registerExecuteTool(pi: ExtensionAPI): void {
  const cwd = process.cwd();

  for (const alias of ALIASES) {
    const definition = {
      name: alias,
      label: alias,
      description: EXECUTE_DESCRIPTION,
      parameters: EXECUTE_PARAMETERS as any,
      async execute(toolCallId, params, signal, onUpdate) {
        return makeExecute(cwd)(toolCallId, params as ExecuteParams, signal, onUpdate);
      },
    };
    patchTool(definition);
    pi.registerTool(definition);
  }
}
