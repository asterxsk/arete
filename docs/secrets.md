# Secrets Management

Arete handles credentials for AI providers, OAuth, and content scanning. This document
describes how secrets are managed so agents and contributors never commit them.

## Local development

- Copy `.env.example` to `.env` and fill in values. `.env` is gitignored — it is never
  committed.
- Extensions read environment variables at runtime (e.g. `GEMINI_API_KEY`,
  `NINEROUTER_API_KEY`, `PI_OAUTH_CLIENT_ID`).
- `agent/auth.json` holds local auth state; it is gitignored by the repository's
  extension allowlist and must not be committed.

## CI / automation secrets

GitHub Actions workflows use repository secrets via `secrets.*` references only —
no hardcoded values. The relevant usages:

- `secrets.GITHUB_TOKEN` — used by Gitleaks and Release Please (default token).
- Deployment/release workflows reference encrypted repo secrets for any publish tokens.

To add a secret: **Settings → Secrets and variables → Actions → New repository secret**.

## Scanning

- **Repo-level**: Gitleaks runs in CI (`secret-scan` job) and fails the build on a
  detected secret.
- **Runtime**: `pi-hermes-memory` includes content/prompt-injection and secret-pattern
  scanning of agent inputs before they reach the model.

## Rotation & incident response

If a secret leaks: rotate it at the provider, remove it from git history
(`git filter-repo` / BFG), force-push the cleaned branch, and re-run the Gitleaks job.
See `docs/runbooks.md`.
