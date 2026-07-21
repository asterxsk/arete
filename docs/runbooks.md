# Arete Runbooks

Operational procedures for maintaining the Arete extension collection.

## Failed CI run

1. Open the failing workflow in the Actions tab.
2. Identify the job: `lint`, `format:check`, `typecheck`, `test`, or `secret-scan`.
3. Run the same command locally (`npm run lint`, `npm run format:check`, `npm test`).
4. Fix or, for typecheck (non-blocking), note the contract drift and open a follow-up issue.

## Leaked secret

1. Rotate the exposed credential immediately at its provider.
2. Remove the secret from git history (e.g., `git filter-repo` or BFG).
3. Push the cleaned history and force-update the remote branch.
4. Re-run the Gitleaks workflow to confirm no remaining matches.

## Roll back a bad release

- **Tagged release**: delete the tag locally and remotely, then revert the commit
  (`git revert <sha>`) and open a PR.
- **Main branch regression**: open a revert PR; CI will re-validate lint/format/tests.

## Extension misbehaving at runtime

1. Check the extension's `AGENTS.md` under `agent/extensions/<name>/`.
2. Verify peer extensions it bridges via `globalThis.__pi_*` are loaded.
3. Look for `status: "degraded"` / `"disabled"` warnings — missing npm deps are guarded.
