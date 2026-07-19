# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:

- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## Purpose (arete)

This repository contains a powerful, modular collection of extensions for the Pi Agent. Each extension is designed to be fully self-contained while seamlessly integrating with the agent to provide enhanced capabilities, rich UI components, and advanced background orchestrations.

## Ownership

- Root repository setup, configuration, and global extension architecture rules.

## Local Contracts

- **Modular Design**: Extensions reside in independent folders. If you delete a folder, its commands, tools, and widgets disappear gracefully. Other extensions that rely on missing peers degrade without crashing the agent.
- **Global State Bridges**: Extensions share runtime data via `globalThis` bridges (e.g., `__pi_copilot_usage`, `__pi_goal_state`) ensuring states are kept synchronized independently of the main thread.
- **LLM Awareness**: Each extension injects its capabilities into `globalThis.__pi_extension_features`. The LLM is dynamically made aware of what extensions are loaded via the system prompt.
- **Shared UI Primitives**: Extensions independently register UI components using context APIs (`ctx.ui.setHeader`, `ctx.ui.setFooter`, `ctx.ui.setWidget`), ensuring the interface remains composable.

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md.

## Local Contracts (tooling)

- **Root toolchain**: `npm install` installs dev tooling + peer type packages (`@earendil-works/pi-coding-agent`, `pi-tui`, `pi-ai`).
- **Lint/Format gate**: `npm run lint` (ESLint) and `npm run format:check` (Prettier) must pass for every PR. Naming conventions enforced via `@typescript-eslint/naming-convention` (camelCase default, PascalCase types).
- **Tests**: `npm test` runs Vitest over `agent/extensions/**/tests/**`. New logic should include tests.
- **Typecheck**: `npm run typecheck` runs `tsc --noEmit`; `agent/extensions/archived/**` is excluded (explicitly unmaintained).
- **CI**: `.github/workflows/ci.yml` runs lint, format, typecheck, tests, and Gitleaks secret scanning on every PR.
- **Dependency updates**: `.github/dependabot.yml` opens weekly update PRs (npm + GitHub Actions).
- **Contributing**: `CODEOWNERS`, `.github/ISSUE_TEMPLATE/`, and `.github/pull_request_template.md` define ownership and PR/issue structure.
- **Dev environment**: `.devcontainer/devcontainer.json` provides a one-command TypeScript/Node dev container.
- **Contributing**: `docs/CONTRIBUTING.md` defines labels, workflow, and `docs/runbooks.md` covers incident/rollback procedures. `.env.example` templates required environment variables.
- **Duplicate/complexity/dead-code**: `jscpd` (CI `duplicate-check`) flags copy-paste; ESLint `complexity` (max 25) and `import/no-unused-modules` enforce complexity and unused code.

- **Header format**: Banner shows the arete ASCII logo (orange) at top; info panel shows below: `using {model} (thinking) by {provider}` / `in {directory} with branch {branch}`
- **Banner indent**: ASCII art is indented 1 space to align with info text
- **Thinking block prefix**: Thinking blocks render with `┃ ` prefix line
- **Shared tui bridge**: TUI components (thinking, bar, questions) live in the `tui` extension and are shared via `__pi_tui` globalThis bridge
- **Input bar format**: BoxedEditor replaces the default editor: ╭─╮ top, `│ ❯ content... │`, ╰─╯ bottom. White ┃ side borders and corners, grey ❯, white content text. During agent turn, a red `━` block blinks at the 3rd dash from the left (60ms tick, ~250ms blink). No ↑ indicator. Spinner suppressed while animating.

## Child DOX Index

- `agent/extensions/` — The modular collection of self-contained Pi Agent extensions. See `agent/extensions/AGENTS.md` for the index of individual extensions and detailed extension-building guidelines.
- `agent/themes/` — The themes directory.
