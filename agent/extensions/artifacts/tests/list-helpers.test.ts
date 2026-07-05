import test from "node:test";
import assert from "node:assert/strict";
import { formatRelativeTime, buildListItems, findArtifactByValue } from "../list-helpers.ts";
import type { ArtifactInfo } from "../storage.ts";

function makeArtifact(overrides: Partial<ArtifactInfo>): ArtifactInfo {
  return {
    name: "sample",
    type: "md",
    path: "/tmp/artifacts/sample.md",
    title: "Sample",
    mtimeMs: 0,
    size: 10,
    ...overrides,
  };
}

test("formatRelativeTime reports sub-minute gaps as 'just now'", () => {
  assert.equal(formatRelativeTime(1_000, 500), "just now");
});

test("formatRelativeTime reports minutes", () => {
  assert.equal(formatRelativeTime(5 * 60_000, 0), "5m ago");
});

test("formatRelativeTime reports hours", () => {
  assert.equal(formatRelativeTime(3 * 60 * 60_000, 0), "3h ago");
});

test("formatRelativeTime reports days", () => {
  assert.equal(formatRelativeTime(2 * 24 * 60 * 60_000, 0), "2d ago");
});

test("buildListItems maps artifacts to labeled items with a type badge", () => {
  const artifacts = [makeArtifact({ name: "page", type: "html", title: "Landing Page", mtimeMs: 0 })];
  const items = buildListItems(artifacts, 60_000);
  assert.deepEqual(items, [{ value: "page.html", label: "[html] Landing Page", description: "1m ago" }]);
});

test("findArtifactByValue finds the matching artifact by name.type key", () => {
  const artifacts = [makeArtifact({ name: "a", type: "md" }), makeArtifact({ name: "b", type: "html" })];
  assert.equal(findArtifactByValue(artifacts, "b.html")?.name, "b");
  assert.equal(findArtifactByValue(artifacts, "missing.md"), undefined);
});
