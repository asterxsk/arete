// header extension — banner header with ascii art on the left and an
// info panel on the right showing version, model, and working directory.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
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
          return new Promise((resolve) => {
            exec("git pull", { cwd: piDir }, (error, stdout, stderr) => {
              if (!error) {
                updateStatus = " \x1b[38;2;100;255;100m(Updated! Restart Pi to apply)\x1b[0m";
                requestHeaderRender?.();
                resolve({});
              } else {
                updateStatus = " \x1b[38;2;255;100;100m(Update failed)\x1b[0m";
                requestHeaderRender?.();
                resolve({ result: `Update failed: ${stderr || error.message}` });
              }
            });
          });
        }

        // Fallback: ~/.pi was installed via install.sh/install.ps1 (clone-temp-copy)
        // Use the same mechanism — clone to temp, sync, delete temp
        return new Promise((resolve) => {
          const tempDir = path.join(os.tmpdir(), "arete_update");

          const cleanup = () => {
            fs.rmSync(tempDir, { recursive: true, force: true });
          };

          // Step 1: Clone to temp
          exec(
            `git clone https://github.com/asterxsk/arete.git "${tempDir}" --quiet`,
            { cwd: piDir },
            (cloneErr, _cloneStdout, cloneStderr) => {
              if (cloneErr) {
                updateStatus = " \x1b[38;2;255;100;100m(Update failed — could not clone)\x1b[0m";
                requestHeaderRender?.();
                cleanup();
                resolve({ result: `Update failed: could not clone repo — ${cloneStderr || cloneErr.message}` });
                return;
              }

              // Step 2: Sync files over
              const isWin = process.platform === "win32";
              const syncCmd = isWin
                ? `robocopy "${tempDir}" "${piDir}" /E /NFL /NDL /NJH /NJS /NC /NS 2>&1`
                : `rsync -a "${tempDir}/" "${piDir}/" 2>&1`;

              exec(syncCmd, { cwd: piDir }, (syncErr, _syncStdout, syncStderr) => {
                if (syncErr) {
                  updateStatus = " \x1b[38;2;255;100;100m(Update failed — could not sync)\x1b[0m";
                  requestHeaderRender?.();
                  cleanup();
                  resolve({ result: `Update failed: could not sync files — ${syncStderr || syncErr.message}` });
                  return;
                }

                // Step 3: Cleanup temp
                cleanup();

                // Step 4: Try restoring node_modules that got overwritten
                // (rsync/robocopy from a fresh clone loses them)
                const extDirs = [
                  path.join(piDir, "agent", "extensions", "filechanges"),
                  path.join(piDir, "agent", "extensions", "pi-hermes-memory"),
                ];
                for (const extDir of extDirs) {
                  const pkgJson = path.join(extDir, "package.json");
                  const nmDir = path.join(extDir, "node_modules");
                  if (fs.existsSync(pkgJson) && !fs.existsSync(nmDir)) {
                    exec("npm install --production", { cwd: extDir }, () => {});
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
                resolve({});
              });
            }
          );
        });
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
