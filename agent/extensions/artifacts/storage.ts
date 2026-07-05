import * as fs from "node:fs";
import * as path from "node:path";

export type ArtifactType = "html" | "md";

export interface ArtifactInfo {
  name: string;
  type: ArtifactType;
  path: string;
  title: string;
  mtimeMs: number;
  size: number;
}

const MAX_NAME_LENGTH = 64;

export function sanitizeName(rawName: string): string {
  const lowered = rawName.trim().toLowerCase();
  const withDashes = lowered.replace(/[\s_]+/g, "-");
  const stripped = withDashes.replace(/[^a-z0-9-]+/g, "");
  const collapsed = stripped.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return collapsed.slice(0, MAX_NAME_LENGTH);
}

export function getArtifactsDir(cwd: string): string {
  return path.join(cwd, "artifacts");
}

export function resolveArtifactPath(cwd: string, name: string, type: ArtifactType): string {
  const safeName = sanitizeName(name);
  if (!safeName) {
    throw new Error(`Invalid artifact name: "${name}"`);
  }
  return path.join(getArtifactsDir(cwd), `${safeName}.${type}`);
}

export function writeArtifact(
  cwd: string,
  name: string,
  type: ArtifactType,
  content: string,
): { path: string; created: boolean } {
  if (!content || !content.trim()) {
    throw new Error("Artifact content must not be empty");
  }
  const artifactPath = resolveArtifactPath(cwd, name, type);
  const created = !fs.existsSync(artifactPath);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, content, "utf8");
  return { path: artifactPath, created };
}

export function extractTitle(type: ArtifactType, content: string, fallback: string): string {
  if (type === "md") {
    const match = content.match(/^#\s+(.+)$/m);
    if (match) return match[1].trim();
  } else {
    const match = content.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (match) return match[1].trim();
  }
  return fallback;
}

export function listArtifacts(cwd: string): ArtifactInfo[] {
  const dir = getArtifactsDir(cwd);
  if (!fs.existsSync(dir)) return [];

  const entries: ArtifactInfo[] = [];
  for (const fileName of fs.readdirSync(dir)) {
    const ext = path.extname(fileName).slice(1);
    if (ext !== "html" && ext !== "md") continue;
    const type = ext as ArtifactType;
    const fullPath = path.join(dir, fileName);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) continue;
    const name = path.basename(fileName, `.${type}`);
    const content = fs.readFileSync(fullPath, "utf8");
    entries.push({
      name,
      type,
      path: fullPath,
      title: extractTitle(type, content, name),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    });
  }

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries;
}
