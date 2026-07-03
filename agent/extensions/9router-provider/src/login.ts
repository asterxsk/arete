/**
 * 9router login flow for pi's /login integration.
 *
 * Prompts for:
 * 1. API key (optional — leave blank for local unauthenticated mode)
 * 2. Endpoint URL (default: http://localhost:20128/v1)
 *
 * Stores credentials in auth.json under the "9router" key via pi's auth system.
 */

import { DEFAULT_ENDPOINT } from "../config.js"

// Simplified types matching pi's internal OAuth types at runtime
interface OAuthPrompt {
  message: string
  placeholder?: string
  allowEmpty?: boolean
}

interface OAuthLoginCallbacks {
  onPrompt(prompt: OAuthPrompt): Promise<string>
  onProgress?(message: string): void
}

interface OAuthCredentials {
  refresh: string
  access: string
  expires: number
  [key: string]: unknown
}

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000

/**
 * Run the interactive login flow for 9router.
 * Returns credentials to persist in auth.json.
 */
export async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  // Step 1: Prompt for API key (optional — blank for local/unauthenticated)
  callbacks.onProgress?.("Enter 9router API key (leave blank for local/unauthenticated):")
  const apiKey = (await callbacks.onPrompt({
    message: "Enter 9router API key (leave blank for local/unauthenticated):",
    placeholder: "",
    allowEmpty: true,
  }))?.trim() || ""

  // Step 2: Prompt for endpoint URL
  callbacks.onProgress?.("Enter 9router endpoint URL:")
  const endpoint = (await callbacks.onPrompt({
    message: `Enter 9router endpoint URL [${DEFAULT_ENDPOINT}]:`,
    placeholder: DEFAULT_ENDPOINT,
    allowEmpty: true,
  }))?.trim() || DEFAULT_ENDPOINT

  return {
    refresh: apiKey || "sk-dummy",
    access: apiKey || "sk-dummy",
    expires: Date.now() + TEN_YEARS_MS,
    endpoint,  // persist endpoint along with credentials
  }
}

/**
 * Refresh is a no-op for 9router — credentials don't expire.
 */
export async function refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  return {
    ...credentials,
    expires: Date.now() + TEN_YEARS_MS,
  }
}

/**
 * Returns the API key from credentials (may be empty for unauthenticated mode).
 */
export function getApiKey(credentials: OAuthCredentials): string {
  return credentials.access || "sk-dummy"
}
