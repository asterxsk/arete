import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  sanitizeName,
  resolveArtifactPath,
  writeArtifact,
  listArtifacts,
  extractTitle,
} from "../storage.ts";

function makeTmpCwd(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "artifacts-storage-test-"));
}

test("sanitizeName lowercases, dashes, and strips unsafe characters", () => {
  assert.equal(sanitizeName("My Landing Page!!"), "my-landing-page");
  assert.equal(sanitizeName("  spaced_out_name  "), "spaced-out-name");
  assert.equal(sanitizeName("###"), "");
});

test("sanitizeName collapses repeated dashes and trims length", () => {
  assert.equal(sanitizeName("a---b"), "a-b");
  const long = "a".repeat(100);
  assert.equal(sanitizeName(long).length, 64);
});

test("resolveArtifactPath builds a path under <cwd>/artifacts", () => {
  const cwd = "/project";
  assert.equal(
    resolveArtifactPath(cwd, "My Page", "html"),
    path.join(cwd, "artifacts", "my-page.html"),
  );
});

test("resolveArtifactPath throws for a name that sanitizes to empty", () => {
  assert.throws(() => resolveArtifactPath("/project", "###", "md"));
});

test("writeArtifact creates the artifacts dir and file, reporting created:true", () => {
  const cwd = makeTmpCwd();
  const result = writeArtifact(cwd, "Landing Page", "html", "<html><title>Hi</title></html>");
  assert.equal(result.created, true);
  assert.equal(fs.readFileSync(result.path, "utf8"), "<html><title>Hi</title></html>");
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("writeArtifact overwrites an existing artifact, reporting created:false", () => {
  const cwd = makeTmpCwd();
  writeArtifact(cwd, "notes", "md", "# First");
  const result = writeArtifact(cwd, "notes", "md", "# Second");
  assert.equal(result.created, false);
  assert.equal(fs.readFileSync(result.path, "utf8"), "# Second");
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("writeArtifact throws on empty content", () => {
  const cwd = makeTmpCwd();
  assert.throws(() => writeArtifact(cwd, "empty", "md", "   "));
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("extractTitle reads the first markdown heading", () => {
  assert.equal(extractTitle("md", "# Hello World\n\nBody", "fallback"), "Hello World");
});

test("extractTitle reads the html <title> tag", () => {
  assert.equal(
    extractTitle("html", "<html><head><title>My Page</title></head></html>", "fallback"),
    "My Page",
  );
});

test("extractTitle falls back when no title is found", () => {
  assert.equal(extractTitle("md", "no heading here", "fallback-name"), "fallback-name");
});

test("listArtifacts returns [] when the artifacts dir does not exist", () => {
  const cwd = makeTmpCwd();
  assert.deepEqual(listArtifacts(cwd), []);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("listArtifacts lists artifacts sorted by most-recently-modified first", () => {
  const cwd = makeTmpCwd();
  writeArtifact(cwd, "older", "md", "# Older");
  const olderPath = resolveArtifactPath(cwd, "older", "md");
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(olderPath, past, past);
  writeArtifact(cwd, "newer", "html", "<title>Newer</title>");

  const artifacts = listArtifacts(cwd);
  assert.equal(artifacts.length, 2);
  assert.equal(artifacts[0].name, "newer");
  assert.equal(artifacts[0].type, "html");
  assert.equal(artifacts[0].title, "Newer");
  assert.equal(artifacts[1].name, "older");
  fs.rmSync(cwd, { recursive: true, force: true });
});
