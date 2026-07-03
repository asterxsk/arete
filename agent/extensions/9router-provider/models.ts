import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { DEFAULT_ENDPOINT } from "./config.js"

const MODELS_CACHE_DIR = join(homedir(), ".pi", "agent", "extensions", "9router-provider")
const MODELS_CACHE_PATH = join(MODELS_CACHE_DIR, "models-cache.json")

export interface NineRouterModel {
  id: string
  object: string
  owned_by: string
  capabilities?: {
    vision?: boolean
    reasoning?: boolean
    contextWindow?: number
    maxOutput?: number
  }
}

export interface NineRouterModelsResponse {
  object: string
  data: NineRouterModel[]
}

export interface PiModelConfig {
  id: string
  name: string
  reasoning: boolean
  input: ("text" | "image")[]
  contextWindow: number
  maxTokens: number
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
  provider: string
}

function normalizeEndpoint(endpoint?: string): string {
  const trimmed = endpoint?.trim()
  return (trimmed && trimmed.length > 0 ? trimmed : DEFAULT_ENDPOINT).replace(/\/+$/, "")
}

export async function fetchModels(endpoint?: string, apiKey?: string): Promise<NineRouterModel[]> {
  const baseUrl = normalizeEndpoint(endpoint)
  const url = `${baseUrl}/models`

  const headers: Record<string, string> = {
    "Accept": "application/json",
  }
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`
  }

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch 9router models: ${res.status} ${res.statusText}`)
  }

  const body = (await res.json()) as NineRouterModelsResponse
  if (!Array.isArray(body?.data)) {
    throw new Error("Unexpected response shape from 9router /v1/models")
  }

  return body.data
}

export function modelToPiModel(model: NineRouterModel): PiModelConfig {
  const caps = model.capabilities
  return {
    id: model.id,
    name: model.id, // Use model ID as display name (e.g. "ag/claude-sonnet-4-6")
    reasoning: caps?.reasoning ?? false,
    input: caps?.vision ? ["text", "image"] : ["text"],
    contextWindow: caps?.contextWindow ?? 128000,
    maxTokens: caps?.maxOutput ?? 16384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    provider: "9router",
  }
}

export async function loadCachedModels(): Promise<PiModelConfig[] | null> {
  try {
    if (!existsSync(MODELS_CACHE_PATH)) return null
    const data = JSON.parse(readFileSync(MODELS_CACHE_PATH, "utf-8"))
    if (data && Array.isArray(data.models)) {
      return data.models
    }
    return null
  } catch {
    return null
  }
}

export async function fetchAndCacheModels(endpoint?: string, apiKey?: string): Promise<PiModelConfig[]> {
  const models = await fetchModels(endpoint, apiKey)
  const piModels = models.map(modelToPiModel)

  // Write cache
  mkdirSync(MODELS_CACHE_DIR, { recursive: true })
  writeFileSync(
    MODELS_CACHE_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), models: piModels }, null, 2),
    "utf-8"
  )

  return piModels
}
