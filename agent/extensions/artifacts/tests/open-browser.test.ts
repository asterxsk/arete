import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { buildOpenCommand, openInBrowser } from "../open-browser.ts";

test("buildOpenCommand maps darwin to open", () => {
  assert.deepEqual(buildOpenCommand("darwin", "/tmp/a.html"), {
    command: "open",
    args: ["/tmp/a.html"],
  });
});

test("buildOpenCommand maps win32 to cmd start", () => {
  assert.deepEqual(buildOpenCommand("win32", "/tmp/a.html"), {
    command: "cmd",
    args: ["/c", "start", "", "/tmp/a.html"],
  });
});

test("buildOpenCommand maps linux (and any other platform) to xdg-open", () => {
  assert.deepEqual(buildOpenCommand("linux", "/tmp/a.html"), {
    command: "xdg-open",
    args: ["/tmp/a.html"],
  });
  assert.deepEqual(buildOpenCommand("freebsd", "/tmp/a.html"), {
    command: "xdg-open",
    args: ["/tmp/a.html"],
  });
});

class FakeChild extends EventEmitter {
  unref(): void {}
}

test("openInBrowser resolves ok:true when the child process spawns", async () => {
  const fakeChild = new FakeChild();
  const spawnImpl = ((): FakeChild => {
    queueMicrotask(() => fakeChild.emit("spawn"));
    return fakeChild;
  }) as unknown as OpenInBrowserSpawn;

  const result = await openInBrowser("/tmp/a.html", { platform: "linux", spawnImpl });
  assert.equal(result.ok, true);
});

test("openInBrowser resolves ok:false with the error message when the child process errors", async () => {
  const fakeChild = new FakeChild();
  const spawnImpl = ((): FakeChild => {
    queueMicrotask(() => fakeChild.emit("error", new Error("command not found")));
    return fakeChild;
  }) as unknown as OpenInBrowserSpawn;

  const result = await openInBrowser("/tmp/a.html", { platform: "linux", spawnImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error, "command not found");
});

type OpenInBrowserSpawn = typeof import("node:child_process").spawn;
