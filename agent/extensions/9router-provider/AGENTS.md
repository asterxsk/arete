# 9router-provider

## Purpose
Provides pi with access to a local or remote 9router instance via its OpenAI-compatible API. Auto-discovers available models and integrates with `/login` for credential management.

## Ownership
- Extension entry point: `index.ts`
- Configuration management: `config.ts`
- Model fetching and caching: `models.ts`
- Login flow: `src/login.ts`

## Local Contracts
- **Independence**: Self-contained — no imports from sibling extensions.
- **Graceful degradation**: If 9router is unreachable, falls back to cached models or a placeholder model.
- **Model caching**: Models are cached to `models-cache.json` for offline startup.
- **Auth storage**: Credentials stored in `~/.pi/agent/auth.json` under the `"9router"` key.
- **OpenAI-compatible**: Uses standard `openai-completions` API type — no custom stream handler needed.

## Work Guidance
- The extension registers via `pi.registerProvider("9router", ...)` at factory level.
- Models are fetched from `{endpoint}/v1/models` on startup.
- The endpoint can be overridden via `NINEROUTER_URL` environment variable.
- API key is optional — leave blank for local unauthenticated mode.
- Cache reconciliation uses `reconcileModels()` in `models.ts`: prune removed → preserve cached → append new.

## Verification
- Extension loads automatically from `extensions/9router-provider/index.ts`.
- Models appear in `/login` under the "9router" provider.
- If 9router is running at localhost:20128, models are auto-discovered on startup.
- If 9router is unreachable, cached models are used as fallback.

## Child DOX Index
- (none — single-file extension with no subdirectories beyond src/)
