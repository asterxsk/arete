import { spawn as nodeSpawn, execSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";

export interface OpenCommand {
  command: string;
  args: string[];
}

export interface OpenInBrowserOptions {
  platform?: NodeJS.Platform;
  spawnImpl?: typeof nodeSpawn;
}

export function isWSL(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    const version = fs.readFileSync("/proc/version", "utf8").toLowerCase();
    return version.includes("microsoft") || version.includes("wsl");
  } catch {
    return false;
  }
}

export function getWindowsPath(absPath: string): string {
  try {
    return execSync(`wslpath -w "${absPath}"`, { encoding: "utf8" }).trim();
  } catch {
    return absPath;
  }
}

export function getFriendlyFileUri(absPath: string): string {
  if (isWSL()) {
    const winPath = getWindowsPath(absPath);
    return "file:" + winPath.replace(/\\/g, "/");
  }
  return `file://${absPath}`;
}

export function buildOpenCommand(platform: NodeJS.Platform, absPath: string): OpenCommand {
  if (isWSL()) {
    const winPath = getWindowsPath(absPath);
    return { command: "cmd.exe", args: ["/c", "start", "", winPath] };
  }
  if (platform === "darwin") {
    return { command: "open", args: [absPath] };
  }
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", absPath] };
  }
  return { command: "xdg-open", args: [absPath] };
}

export function openInBrowser(
  absPath: string,
  options: OpenInBrowserOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  const platform = options.platform ?? process.platform;
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const { command, args } = buildOpenCommand(platform, absPath);

  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcess;

    try {
      child = spawnImpl(command, args, { detached: true, stdio: "ignore" });
    } catch (err) {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }

    child.once("error", (err: unknown) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });

    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve({ ok: true });
    });
  });
}
