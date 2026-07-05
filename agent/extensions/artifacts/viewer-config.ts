import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

import type { ViewerWindowMode } from "./viewer-launcher.ts";

export type ViewerModePreference = ViewerWindowMode;

export interface ViewerConfig {
  viewerMode?: ViewerModePreference;
  autoOpen?: boolean;
}

const VALID_MODES: readonly ViewerModePreference[] = ["app", "browser", "none"];

export function viewerConfigPath(): string {
  return join(homedir(), CONFIG_DIR_NAME, "artifacts", "config.json");
}

export function isViewerMode(value: unknown): value is ViewerModePreference {
  return (
    typeof value === "string" &&
    VALID_MODES.includes(value as ViewerModePreference)
  );
}

async function readConfig(path: string): Promise<ViewerConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as ViewerConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeConfig(patch: ViewerConfig, path: string): Promise<void> {
  const next = { ...(await readConfig(path)), ...patch };
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
}

export async function readViewerMode(
  path = viewerConfigPath(),
): Promise<ViewerModePreference | undefined> {
  const { viewerMode } = await readConfig(path);
  return isViewerMode(viewerMode) ? viewerMode : undefined;
}

export async function writeViewerMode(
  mode: ViewerModePreference,
  path = viewerConfigPath(),
): Promise<void> {
  await writeConfig({ viewerMode: mode }, path);
}

export async function readAutoOpen(
  path = viewerConfigPath(),
): Promise<boolean> {
  const { autoOpen } = await readConfig(path);
  return typeof autoOpen === "boolean" ? autoOpen : true;
}

export async function writeAutoOpen(
  enabled: boolean,
  path = viewerConfigPath(),
): Promise<void> {
  await writeConfig({ autoOpen: enabled }, path);
}
