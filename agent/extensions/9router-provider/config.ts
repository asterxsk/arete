import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json")

export const DEFAULT_ENDPOINT = "http://localhost:20128/v1"

export interface NineRouterConfig {
  apiKey?: string
  endpoint?: string
}

/**
 * Load 9router config from pi's auth.json.
 * Handles both OAuth format (written by pi's auth system) and api_key format.
 */
export function loadConfig(): NineRouterConfig {
  if (!existsSync(AUTH_PATH)) return {}
  try {
    const data = JSON.parse(readFileSync(AUTH_PATH, "utf-8"))
    const nr = data["9router"]
    if (nr) {
      return {
        apiKey: nr.access || nr.apiKey || nr.key || undefined,
        endpoint: nr.endpoint || DEFAULT_ENDPOINT,
      }
    }
    return {}
  } catch {
    return {}
  }
}
