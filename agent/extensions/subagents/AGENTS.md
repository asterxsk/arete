# Subagents Extension

## Purpose
Registers a `subagent` tool that spawns isolated child pi processes with predefined agents loaded from `.md` files. Subagents always run **in the background**: the tool call returns immediately with a job id, and the subagent's full output is delivered to the agent as a follow-up user message (the "ping") when the job finishes. Supports single and parallel (batched) execution with configurable concurrency.

Agents can opt into `interactive: true` (pause between phases instead of running to completion — job lands in status `waiting`, resumed via `subagent_resume`) and a `session:` linkage mode (`standalone` default, `fork` to inherit the parent conversation's full history, `lineage` to start fresh but stay tagged to the parent in `/jobs`). Any running job can be cancelled mid-turn with `subagent_interrupt` without losing its session (status `interrupted`, also resumable).

## Ownership
- `index.ts` — subagent tool, background job registry, agent discovery, process spawning, `/sub` + `/jobs` commands
- `agents/` — agent definition `.md` files with frontmatter (name, description, tools)
- `tools/` — custom tool extensions for subagents (e.g., safe-bash)
- `config.json` — optional configuration (maxConcurrency)

## Local Contracts
- Registers tools: `subagent` (single and parallel modes, always background/detached), `subagent_resume` (reply to a `waiting`/`interrupted` job), `subagent_interrupt` (cancel a running job's current turn, session preserved)
- Registers commands: `/sub` (set/list subagent model), `/jobs` (list background jobs; `/jobs <id>` full output; `/jobs interrupt <id>`; `/jobs reply <id> <text>`; `/jobs watch <id>` read-only live tail)
- Exports: `registerAgent()`, `unregisterAgent()` for other extensions; `loadAgentFiles()` and `buildSessionCliArgs()` are exported for unit testing (see `tests/`)
- Agents defined via frontmatter: `name`, `description`, `tools` (comma-separated), `interactive` (optional, default false), `session` (optional: `standalone` default / `fork` / `lineage`)
- Uses `BUILTIN_TOOLS` set for tools pi provides natively
- `discoverAllExtensions()` scans `agent/extensions/` for every subfolder containing `index.ts` and passes them all to subagents via `--extension` flags. New extensions are auto-discovered — no explicit registration needed.
- `SUBAGENT_TOOLS` maps subagent-specific tool names to extension paths (e.g., `safe_bash`, `session_complete` from `tools/` directory) — always loaded for every child regardless of the agent's own `tools:` list
- **Depth-limited self-delegation**: a spawned child gets `PI_SUBAGENT_DEPTH` set to one more than its parent's (unset/0 for a real user session). `discoverAllExtensions()` only re-includes the `subagents/` extension itself in a child's `--extension` list when `PI_SUBAGENT_DEPTH + 1 <= MAX_SUBAGENT_DEPTH` (currently `1`). This lets a depth-0 session spawn agents (e.g. `planner`) that can themselves delegate one further level (e.g. to `scout`/`researcher`, per `agents/planner.md`'s Delegation section) — those depth-2 agents get no `subagent`/`subagent_resume`/`subagent_interrupt` tools at all, so recursion always terminates after one nested level. Bug this fixes: previously `subagents` was unconditionally excluded from every child, so any interactive agent instructed to self-delegate (like `planner`) would call a tool that was never registered and get "tool not found".
- Depends on `@earendil-works/pi-coding-agent` for `parseFrontmatter`, `truncateHead`, `ExtensionContext`, etc.
- **NPM dep safety**: `@earendil-works/pi-tui` and `typebox` are lazily `require()`'d behind a try/catch at module load — if either is missing (e.g. `npm install` never run in this folder), the extension registers with `status: "disabled"` and returns early instead of crashing pi. `@earendil-works/pi-coding-agent` is intentionally left as a plain unguarded import: it's ESM-only (no CJS `exports` entry, so it can't be lazily `require()`'d) and it's the host SDK itself — if it's missing, pi isn't running at all.
- **Session persistence**: every job gets its own private tempDir and a persisted session (`--session-dir <tempDir> --session-id job`, optionally `--fork <parentSessionFile>` on first launch for `session: fork` agents) — replaces the old ephemeral `--no-session` run. This is what makes resume/interrupt possible.
- **`waiting` vs `completed`**: `interactive: true` agents pause a phase by simply ending their turn (no tool call) — indistinguishable from "finished" at the process level, so a dedicated always-loaded `session_complete` tool is the only signal that flips a job to `completed` instead of `waiting`.

## Background Execution Model
- `execute()` validates agents, calls `launchBatch()`, and returns an acknowledgment (job ids) synchronously — it does NOT await the child processes.
- Each job runs in a detached async runner with its OWN `AbortController` (the tool call's `signal` is gone once `execute` returns).
- Concurrency is gated globally via `acquireSlot()/releaseSlot()` (bounded by `maxConcurrency`), shared across all background jobs.
- Completion ping: when the LAST job in a batch finishes, `sendBatchPing()` calls `piApi.sendUserMessage(fullOutput, { deliverAs: "steer" })`, which always triggers a turn (wakes the agent when idle; when the agent is mid-turn, "steer" injects the ping after the NEXT tool call rather than waiting for the whole current turn to finish — this avoids the parent agent polling/looping on job status while a long turn is in progress). `piApi` is captured as `pi` in the default export. A parallel `tasks[]` batch produces ONE consolidated ping.
- The on-screen "N/M job(s) finished" ping uses `ctx.ui.setWidget()` (not `ctx.ui.notify()`, which permanently appends to the chat transcript) with a `setTimeout` clearing it after 3s — it's redundant once the full output already arrived via the message above, so it shouldn't linger in the UI.
- `__pi_subagent_running_count` is incremented at job launch and decremented at true completion (in the detached runner), not in `execute`.
- `session_shutdown` aborts all still-running jobs' controllers so child pi processes are terminated.
- Per-job output is capped in `runSubagent` (`DEFAULT_MAX_BYTES`); the job registry keeps the last `MAX_JOBS_KEPT` finished jobs.

## Work Guidance
- Agent `.md` files go in `agents/` directory with frontmatter format
- Custom tools go in `tools/` directory or reference external extensions
- Subagent model set via `/sub` command, stored globally in `__pi_subagent_model_v1`
- Concurrency limited by `maxConcurrency` config (default: 4), enforced by the global slot gate
- Temp directories created in OS temp folder, cleaned up after execution

## Verification
- Unit tests: `node --test tests/*.test.ts` (or `bun test tests/*.test.ts` if node's TS type-stripping can't parse this file — see Known Environment Quirks below) — covers frontmatter parsing (`interactive`/`session` defaults and parsing) and `buildSessionCliArgs` (standalone/fork/lineage/resume argument shapes)
- Test agent loading: ensure `.md` files in `agents/` are discovered
- Test single mode: `subagent` tool with `agent` + `task` — returns a job id immediately, then a follow-up message with output arrives when done
- Test parallel mode: `subagent` tool with `tasks[]` — launches N jobs, one consolidated follow-up message when all finish
- Test `/jobs` lists running/finished jobs; `/jobs <id>` shows a single job's output
- Test `/sub` command for model selection
- Test `session_shutdown` terminates in-flight child processes; running count returns to 0 after all jobs complete
- Test interactivity: spawn `planner` (interactive), confirm job reaches `waiting` after its first phase with the phase's question in the ping; `/jobs reply <id> <text>` continues it; eventually it calls `session_complete` and the job reaches `completed`
- Test interrupt/resume: interrupt a running job (`/jobs interrupt <id>` or the tool), confirm status `interrupted` and its tempDir is NOT deleted; resume it and confirm the conversation continues from where it left off
- Test `session: fork`: spawn an agent with `session: fork`, ask it to recall something only present in the parent conversation, confirm it can
- Test `session: lineage`: spawn such an agent, confirm `/jobs` shows the `(from <parent-id>)` tag
- Test non-interactive regression: `worker`/`reviewer` (non-interactive) still complete in one shot exactly as before, and their tempDir is deleted after completion (no disk leak)
- Test self-delegation depth limit: spawn `planner` from a depth-0 session and have it delegate to `scout`/`researcher` — confirm the delegated call succeeds (planner's child process has the `subagent` tool). Confirm `scout`/`researcher` themselves have no `subagent`/`subagent_resume`/`subagent_interrupt` tools (depth 2, over `MAX_SUBAGENT_DEPTH`) so they cannot delegate further.

### Known Environment Quirks
- This extension has no local `node_modules` and no `tsconfig.json` — it's loaded at runtime via pi's own `jiti` loader. `node --test` on `.ts` files here fails to even parse `index.ts` (Node's built-in TS type-stripping doesn't support the parameter-property constructor syntax used in `SubagentAutocompleteComponent`), so use `bun test` instead for this extension's `tests/*.test.ts` files, and note that bun also needs `@earendil-works/pi-coding-agent`/`typebox` resolvable — check for a local `node_modules` before assuming test commands "just work".

## Child DOX Index
None
