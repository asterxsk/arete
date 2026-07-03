/**
 * 9router provider for pi.
 *
 * Connects pi to a local or remote 9router instance via its OpenAI-compatible API.
 *
 * Features:
 *   - Auto-fetches available models from /v1/models on startup
 *   - Caches models for offline startup
 *   - Appears in /login for credential management
 *   - Supports both authenticated and unauthenticated modes
 *
 * Setup:
 *   1. Run `/login`, select 9router — enter API key (blank OK) and endpoint URL
 *   2. Models are auto-discovered from the 9router server
 *   3. Use any model ID from your 9router instance (e.g. "ag/claude-sonnet-4-6")
 *
 * Environment variables:
 *   NINEROUTER_URL — Override default endpoint (default: http://localhost:20128/v1)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { loadConfig, DEFAULT_ENDPOINT } from "./config.js"
import { fetchAndCacheModels, loadCachedModels } from "./models.js"
import { login, refreshToken, getApiKey } from "./src/login.js"

export default async function nineRouterProviderExtension(pi: ExtensionAPI): Promise<void> {
  // Register in global feature registry
  ;(globalThis as any).__pi_extension_features?.push({
    name: "9router-provider",
    description: "Local/remote 9router AI gateway provider with auto-discovered models",
  })

  const config = loadConfig()
  const endpoint = process.env.NINEROUTER_URL?.trim() || config.endpoint || DEFAULT_ENDPOINT
  const apiKey = config.apiKey || "sk-dummy"

  // Try to fetch live models, fall back to cache
  let models: any[] | undefined
  try {
    models = await fetchAndCacheModels(endpoint, apiKey)
  } catch {
    // Silently fall back to cache
    const cached = await loadCachedModels()
    if (cached && cached.length > 0) {
      models = cached
    }
  }

  // Register the provider
  pi.registerProvider("9router", {
    name: "9Router",
    baseUrl: endpoint,
    api: "openai-completions",
    authHeader: true,
    apiKey: apiKey,
    headers: {
      "User-Agent": "pi-9router-provider/1.0",
    },
    oauth: {
      name: "9Router",
      login,
      refreshToken,
      getApiKey,
    },
    models: models || [
      {
        id: "9router-auto",
        name: "9Router Auto",
        reasoning: false,
        input: ["text" as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ],
  })
}
