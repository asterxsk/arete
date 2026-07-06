import test from "node:test";
import assert from "node:assert/strict";
import { buildSessionCliArgs } from "../index.ts";

test("standalone mode: session-dir + session-id, no fork", () => {
	const args = buildSessionCliArgs({ mode: "standalone", tempDir: "/tmp/job1", resume: false });
	assert.deepEqual(args, ["--session-dir", "/tmp/job1", "--session-id", "job"]);
});

test("lineage mode: same as standalone (linkage is display-only metadata)", () => {
	const args = buildSessionCliArgs({ mode: "lineage", tempDir: "/tmp/job2", resume: false });
	assert.deepEqual(args, ["--session-dir", "/tmp/job2", "--session-id", "job"]);
});

test("fork mode on first launch: --fork <parent> before session-dir/session-id", () => {
	const args = buildSessionCliArgs({
		mode: "fork",
		tempDir: "/tmp/job3",
		resume: false,
		parentSessionFile: "/home/u/.pi/agent/sessions/proj/parent.jsonl",
	});
	assert.deepEqual(args, [
		"--fork",
		"/home/u/.pi/agent/sessions/proj/parent.jsonl",
		"--session-dir",
		"/tmp/job3",
		"--session-id",
		"job",
	]);
});

test("fork mode on resume: never re-forks, just reopens by id", () => {
	const args = buildSessionCliArgs({
		mode: "fork",
		tempDir: "/tmp/job3",
		resume: true,
		parentSessionFile: "/home/u/.pi/agent/sessions/proj/parent.jsonl",
	});
	assert.deepEqual(args, ["--session-dir", "/tmp/job3", "--session-id", "job"]);
});

test("fork mode with no parent session file available: degrades to standalone args", () => {
	const args = buildSessionCliArgs({ mode: "fork", tempDir: "/tmp/job4", resume: false });
	assert.deepEqual(args, ["--session-dir", "/tmp/job4", "--session-id", "job"]);
});
