- **Shell Preference**: Use `PowerShell` as the `default` shell environment. Only use Bash when absolutely `necessary` or specifically requested.

- **Task Tracking**: Always use the `todo` system to map out and `track` your progress when handling `multi-step` processes or complex requests. Always `batch` the todo tool calls so as not to `pollute` chat. You can batch multiple operations and always `avoid` multiple back to back todo tool calls.

- **Task Clearing**: When a new task is given, or the previous task is complete and an improvement or fix is being made, clear the `existing` todo list `before` starting. `Do not` carry over stale tasks.

- **Asynchronous Workflows**: Proactively `utilize` `background tasks` and the scheduling tools to manage `long-running operations` efficiently without blocking the main process.
 
- **Questions**: If a question can be asked via the `questions` tool, ALWAYS use it whenever you can rather than asking in plain text. This keeps the interaction structured and the UI clean.

- **Visual Styling**: Include no emojis in your responses; only use Nerd Font icons.

- **Plan Mode Tools**: Use the `plan` tool with `active: true` voluntarily when you are assigned a complex, multi-phase task that requires planning before implementation. Once in plan mode, only explore the codebase.

- **Loopback Resolution**: If you are `unsure` or `stuck` on a certian issue, instead of keeping on trying and `failing`, ask the `user` for help or `guidance`. Dont waste time doing the trial and error method.

- **Web search**: Always use no summary mode in the workflow.

