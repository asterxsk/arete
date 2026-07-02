// header extension — banner header with ascii art on the left and an
// info panel on the right showing version, model, and working directory.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import * as os from "os";

const RESET = "\x1b[0m";
const ORANGE = "\x1b[38;2;255;165;0m";
const ARETE = "\x1b[38;2;255;165;0m";
const GREY = "\x1b[38;2;180;180;180m";

function paint(color: string, text: string): string {
  return `${color}${text}${RESET}`;
}

/**
 * Color the banner orange (#ffa500). Spaces stay untouched.
 * ponytail: name is vestigial — was for a blackhole gradient.
 */
function colorizeBanner(lines: string[]): string[] {
  return lines.map((line) => {
    let out = "";
    for (let col = 0; col < line.length; col++) {
      const ch = line[col] ?? "";
      if (ch === " " || ch === undefined) {
        out += ch;
      } else {
        out += `${ORANGE}${ch}${RESET}`;
      }
    }
    return out;
  });
}

export function buildBannerArtLines(): string[] {
  return ["", " ▝██████████▘", "   ██    ██", "   ██    ██", "  ▄██    ██▄", ""];
}

function composeSideBySide(
  leftLines: string[],
  rightLines: string[],
  gap = 2,
): string[] {
  const leftWidth = leftLines.reduce(
    (max, line) => Math.max(max, visibleWidth(line)),
    0,
  );
  const rowCount = Math.max(leftLines.length, rightLines.length);
  return Array.from({ length: rowCount }, (_, i) => {
    const left = leftLines[i] || "";
    const right = rightLines[i] || "";
    if (!right) return left;
    const padding = " ".repeat(
      Math.max(0, leftWidth - visibleWidth(left) + gap),
    );
    return `${left}${padding}${right}`;
  });
}

// ── Info panel state ─────────────────────────────────────────────────

let infoProvider = "";
let infoModel = "";
let requestHeaderRender: (() => void) | undefined;
let updateStatus = "";

function refreshModel(ctx: any): void {
  if (!ctx?.model) return;
  infoProvider = ctx.model.provider || "";
  const raw = ctx.model.display_name || ctx.model.id || "";
  // Strip provider prefix: "deepseek/deepseek-v4-flash" → "deepseek-v4-flash"
  infoModel = raw.replace(/^[^/]+\//, "");
}

function buildInfoPanel(height: number): string[] {
  let currentVersion = "3.4.2";
  try {
    const versionPath = path.join(process.env.USERPROFILE || process.env.HOME || "", ".pi", "version.txt");
    if (fs.existsSync(versionPath)) {
      currentVersion = fs.readFileSync(versionPath, "utf-8").trim();
    }
  } catch (e) {}

  const version = `Arete v${currentVersion}${updateStatus}`;
  const provider = infoProvider || "—";
  const model = infoModel || "—";
  const cwd = process.cwd();

  const lines: string[] = [""];

  lines.push(paint(ARETE, version));
  lines.push(paint(GREY, provider));
  lines.push(paint(GREY, model));
  lines.push(paint(GREY, cwd));
  lines.push("");

  return lines;
}

// ── Extension entry ──────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Self-register in global feature registry
  (globalThis as any).__pi_extension_features?.push({
    name: "header",
    description:
      "ASCII-art banner header with version, provider, model, and info widget",
    commands: ["/update"],
  });

  if (typeof (pi as any).registerCommand === 'function') {
    (pi as any).registerCommand("update", {
      description: "Pull the latest Arete updates from GitHub",
      async handler(args: string, ctx: any) {
        if (ctx.hasUI) ctx.ui.notify("Pulling latest Arete update...", "info");
        const piDir = path.join(process.env.USERPROFILE || process.env.HOME || "", ".pi");
        const gitDir = path.join(piDir, ".git");

        const isGitRepo = fs.existsSync(gitDir);

        if (isGitRepo) {
          // Fast path: ~/.pi is a proper git clone
          // fetch + reset --hard handles tracked changes, untracked conflicts,
          // and leaves ignored files (like config, node_modules) untouched
          try {
            execSync("git fetch origin", { cwd: piDir, stdio: "pipe" });
            // Reset to upstream branch (handles any branch name)
            execSync("git reset --hard @{upstream}", { cwd: piDir, stdio: "pipe" });
            updateStatus = " \x1b[38;2;100;255;100m(Updated! Restart Pi to apply)\x1b[0m";
            requestHeaderRender?.();
            return {};
          } catch (e: any) {
            const msg = e.stderr?.toString().trim() || e.message || "Unknown error";
            updateStatus = " \x1b[38;2;255;100;100m(Update failed)\x1b[0m";
            requestHeaderRender?.();
            return { result: `Update failed: ${msg}` };
          }
        }

        // Fallback: ~/.pi was installed via install.sh/install.ps1 (clone-temp-copy)
        // Clone to temp, overwrite files, clean up
        const tempDir = path.join(os.tmpdir(), "arete_update");

        // Preemptive cleanup — remove stale temp from failed runs
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }

        try {
          // Step 1: Clone to temp
          execSync(`git clone https://github.com/asterxsk/arete.git "${tempDir}" --quiet`, {
            cwd: piDir,
            stdio: "pipe",
          });

          // Step 2: Sync files over (cp -a is POSIX, always available on Linux/Mac;
          // robocopy on Windows). These overwrite existing files in ~/.pi.
          const isWin = process.platform === "win32";
          if (isWin) {
            execSync(`robocopy "${tempDir}" "${piDir}" /E /NFL /NDL /NJH /NJS /NC /NS 2>&1`, {
              cwd: piDir,
              stdio: "pipe",
            });
          } else {
            execSync(`cp -a "${tempDir}/." "${piDir}/" 2>&1`, {
              cwd: piDir,
              stdio: "pipe",
            });
          }

          // Step 3: Cleanup temp
          fs.rmSync(tempDir, { recursive: true, force: true });

          // Step 4: Reinstall extension deps if node_modules got wiped
          const extDirs = [
            path.join(piDir, "agent", "extensions", "filechanges"),
            path.join(piDir, "agent", "extensions", "pi-hermes-memory"),
          ];
          for (const extDir of extDirs) {
            const pkgJson = path.join(extDir, "package.json");
            const nmDir = path.join(extDir, "node_modules");
            if (fs.existsSync(pkgJson) && !fs.existsSync(nmDir)) {
              execSync("npm install --production", { cwd: extDir, stdio: "pipe" });
            }
          }

          // Reload version from updated version.txt
          const versionPath = path.join(piDir, "version.txt");
          let newVersion = "";
          try {
            if (fs.existsSync(versionPath)) {
              newVersion = fs.readFileSync(versionPath, "utf-8").trim();
            }
          } catch (e) {}

          updateStatus = ` \x1b[38;2;100;255;100m(Updated to v${newVersion || "?"}! Restart Pi to apply)\x1b[0m`;
          requestHeaderRender?.();
          return {};
        } catch (e: any) {
          // Cleanup on any error
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
          const msg = e.stderr?.toString().trim() || e.message || "Unknown error";
          updateStatus = " \x1b[38;2;255;100;100m(Update failed)\x1b[0m";
          requestHeaderRender?.();
          return { result: `Update failed: ${msg}` };
        }
      }
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    refreshModel(ctx);

    // Update Checker
    setTimeout(async () => {
      try {
        const res = await fetch("https://raw.githubusercontent.com/asterxsk/arete/main/version.txt");
        if (res.ok) {
          const remoteVersion = (await res.text()).trim();
          const versionPath = path.join(process.env.USERPROFILE || process.env.HOME || "", ".pi", "version.txt");
          let localVersion = "3.4.2";
          if (fs.existsSync(versionPath)) {
            localVersion = fs.readFileSync(versionPath, "utf-8").trim();
          }
          
          let isUpdateAvailable = false;
          if (remoteVersion && localVersion) {
            const rParts = remoteVersion.split('.').map(n => parseInt(n, 10) || 0);
            const lParts = localVersion.split('.').map(n => parseInt(n, 10) || 0);
            for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
              const r = rParts[i] || 0;
              const l = lParts[i] || 0;
              if (r > l) { isUpdateAvailable = true; break; }
              if (r < l) { break; }
            }
          }
          
          if (isUpdateAvailable) {
            updateStatus = " \x1b[38;2;255;255;0m- Update available (/update to pull)\x1b[0m";
            requestHeaderRender?.();
          }
        }
      } catch (e) {}
    }, 1000);

    if (!ctx.hasUI) return;
    const renderHeader = (tui: any, _theme: any) => {
      const refresh = () => tui.requestRender();
      requestHeaderRender = refresh;
      return {
        render(width: number): string[] {
          const rawLines = buildBannerArtLines();
          const bannerLines = colorizeBanner(rawLines);
          const infoLines = buildInfoPanel(bannerLines.length);
          return composeSideBySide(bannerLines, infoLines).map((line) =>
            truncateToWidth(line, width),
          );
        },
        invalidate() {},
      };
    };
    ctx.ui.setHeader(renderHeader);
  });

  pi.on("model_select", (_event, ctx) => {
    refreshModel(ctx);
    requestHeaderRender?.();
  });
}
