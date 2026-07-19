# Contributing to Arete

Thanks for contributing! This guide covers the workflow, labels, and operational runbooks.

## Development workflow

```bash
npm install            # install dev tooling + peer type packages
npm run lint           # ESLint over all extension TypeScript
npm run format         # Prettier — write formatting
npm run format:check   # Prettier — verify (CI gate)
npm test               # Vitest — extension test suites
npm run test:coverage  # Vitest + coverage thresholds
npm run typecheck      # tsc --noEmit (informational)
```

Pre-commit hooks (husky + lint-staged) auto-fix and format staged files. CI enforces
lint, format, typecheck, tests, and secret scanning on every PR.

## Issue & PR labels

Use a consistent label set so work can be filtered and prioritized:

**Priority**
- `P0` — critical / blocking
- `P1` — high
- `P2` — medium
- `P3` — low

**Type**
- `bug` — something is broken
- `feature` — new capability or extension
- `chore` — maintenance, deps, tooling
- `docs` — documentation only
- `triage` — needs investigation

**Area**
- `extensions` — extension code
- `ui` — TUI / rendering
- `memory` — pi-hermes-memory
- `ci` — pipelines & tooling
- `security` — secret scanning / content scanning

## Runbooks & incident response

Operational runbooks live in [`docs/runbooks.md`](./runbooks.md), including:
- How to investigate a failed CI run
- How to handle a leaked secret (rotate + purge + re-run Gitleaks)
- How to roll back a bad release (delete tag / revert commit)

For broader architecture and operating context, see the generated
[droid-wiki](https://app.factory.ai) and `agent/extensions/AGENTS.md`.
