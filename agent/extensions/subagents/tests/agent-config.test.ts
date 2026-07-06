import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadAgentFiles } from "../index.ts";

function withTempAgentsDir(files: Record<string, string>, fn: (dir: string) => void) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sub-test-"));
	try {
		for (const [name, content] of Object.entries(files)) {
			fs.writeFileSync(path.join(dir, name), content, "utf-8");
		}
		fn(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

test("loadAgentFiles defaults interactive=false, session=standalone when omitted", () => {
	withTempAgentsDir(
		{
			"plain.md": "---\nname: plain\ndescription: A plain agent\ntools: read\n---\nBody text.\n",
		},
		(dir) => {
			const agents = loadAgentFiles(dir, new Set());
			assert.equal(agents.length, 1);
			assert.equal(agents[0].interactive, false);
			assert.equal(agents[0].session, "standalone");
		},
	);
});

test("loadAgentFiles parses interactive=true and session=fork", () => {
	withTempAgentsDir(
		{
			"interactive.md":
				"---\nname: interactive\ndescription: An interactive agent\ntools: read\ninteractive: true\nsession: fork\n---\nBody text.\n",
		},
		(dir) => {
			const agents = loadAgentFiles(dir, new Set());
			assert.equal(agents[0].interactive, true);
			assert.equal(agents[0].session, "fork");
		},
	);
});

test("loadAgentFiles falls back to standalone for an unrecognized session value", () => {
	withTempAgentsDir(
		{
			"weird.md": "---\nname: weird\ndescription: x\ntools: read\nsession: bogus\n---\nBody.\n",
		},
		(dir) => {
			const agents = loadAgentFiles(dir, new Set());
			assert.equal(agents[0].session, "standalone");
		},
	);
});
