import type { ArtifactInfo } from "./storage.ts";

export interface ListItem {
  value: string;
  label: string;
  description?: string;
}

export function formatRelativeTime(nowMs: number, mtimeMs: number): string {
  const diffMs = Math.max(0, nowMs - mtimeMs);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

export function buildListItems(artifacts: ArtifactInfo[], nowMs: number): ListItem[] {
  return artifacts.map((artifact) => ({
    value: `${artifact.name}.${artifact.type}`,
    label: `[${artifact.type}] ${artifact.title}`,
    description: formatRelativeTime(nowMs, artifact.mtimeMs),
  }));
}

export function findArtifactByValue(artifacts: ArtifactInfo[], value: string): ArtifactInfo | undefined {
  return artifacts.find((artifact) => `${artifact.name}.${artifact.type}` === value);
}
