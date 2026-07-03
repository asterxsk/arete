# Subagents Extension

## Purpose
Registers a `subagent` tool that spawns isolated child pi processes with predefined agents loaded from `.md` files. Subagents always run **in the background**: the tool call returns immediately with a job id, and the subagent's full output is delivered to the agent as a follow-up user message (the "ping") when the job finishes. Supports single and parallel (batched) execution with configurable concurrency.

## Ownership
- `index.ts` — subagent tool, background job registry, agent discovery, process spawning, `/sub` + `/jobs` commands
- `agents/` — agent definition `.md` files with frontmatter (name, description, tools)
- `tools/` — custom tool extensions for subagents (e.g., safe-bash)
- `config.json` — optional configuration (maxConcurrency)

## Local Contracts
- Registers tool: `subagent` (single and parallel modes) — always background/detached
- Registers commands: `/sub` (set/list subagent model), `/jobs` (list background jobs; `/jobs <id>` shows one job's output)
- Exports: `registerAgent()`, `unregisterAgent()` for other extensions
- Agents defined via frontmatter: `name`, `description`, `tools` (comma-separated)
- Uses `BUILTIN_TOOLS` set for tools pi provides natively
- `discoverAllExtensions()` scans `agent/extensions/` for every subfolder containing `index.ts` and passes them all to subagents via `--extension` flags. New extensions are auto-discovered — no explicit registration needed.
- `SUBAGENT_TOOLS` maps subagent-specific tool names to extension paths (e.g., `safe_bash` from `tools/` directory)
- The `subagents/` extension itself is excluded from auto-discovery to avoid recursion
- Depends on `@earendil-works/pi-coding-agent` for `parseFrontmatter`, `truncateHead`, `ExtensionContext`, etc.

## Background Execution Model
- `execute()` validates agents, calls `launchBatch()`, and returns an acknowledgment (job ids) synchronously — it does NOT await the child processes.
- Each job runs in a detached async runner with its OWN `AbortController` (the tool call's `signal` is gone once `execute` returns).
- Concurrency is gated globally via `acquireSlot()/releaseSlot()` (bounded by `maxConcurrency`), shared across all background jobs.
- Completion ping: when the LAST job in a batch finishes, `sendBatchPing()` calls `piApi.sendUserMessage(fullOutput, { deliverAs: "followUp" })`, which always triggers a turn (wakes the agent when idle, queues after the current stream otherwise). `piApi` is captured as `pi` in the default export. A parallel `tasks[]` batch produces ONE consolidated ping.
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
- Test agent loading: ensure `.md` files in `agents/` are discovered
- Test single mode: `subagent` tool with `agent` + `task` — returns a job id immediately, then a follow-up message with output arrives when done
- Test parallel mode: `subagent` tool with `tasks[]` — launches N jobs, one consolidated follow-up message when all finish
- Test `/jobs` lists running/finished jobs; `/jobs <id>` shows a single job's output
- Test `/sub` command for model selection
- Test `session_shutdown` terminates in-flight child processes; running count returns to 0 after all jobs complete

## Child DOX Index
None
