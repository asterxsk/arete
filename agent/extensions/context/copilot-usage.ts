// context/copilot-usage.ts — Copilot OAuth + quota fetch.
//
// Support file for the context extension. Exposes the latest Copilot usage
// summary via `globalThis.__pi_copilot_usage` (a getter) so other extensions
// (statusline, etc.) can read it without importing directly.
//
// Direct imports of this module from other extensions are discouraged: the
// `globalThis` bridge is the supported way to consume the data, since
// extensions are loaded via jiti which gives each file a separate module
// instance.


// ── Public types ──────────────────────────────────────────────────────

export interface CopilotUsageSummary {
	used: number;
	total: number;
	remaining: number;
	percent: number;
	bar: string;
	usedLabel: string;
	unlimited: boolean;
}

export type CopilotUsageStatus = "loading" | "not-logged-in" | CopilotUsageSummary;

export interface CopilotUsageBridge {
	get(): CopilotUsageStatus;
	refresh(): Promise<void>;
}

interface CopilotQuotaSnapshot {
	entitlement?: number;
	remaining?: number;
	quota_remaining?: number;
	percent_remaining?: number;
	unlimited?: boolean;
}

interface CopilotUsageResponse {
	quota_snapshots?: {
		premium_interactions?: CopilotQuotaSnapshot;
		chat?: CopilotQuotaSnapshot;
		completions?: CopilotQuotaSnapshot;
		[key: string]: CopilotQuotaSnapshot | undefined;
	};
	quota_reset_date?: string;
	quota_reset_date_utc?: string;
}

interface CopilotTokenResponse {
	token?: unknown;
	endpoints?: {
		api?: unknown;
		[key: string]: unknown;
	};
}

interface CopilotAuthStorageLike {
	reload(): void;
	getApiKey(provider: string): Promise<string | undefined>;
	get(provider: string): unknown;
}

interface CopilotCredentialsLike {
	refresh?: unknown;
	access?: unknown;
	enterpriseUrl?: unknown;
}

// ── Constants ─────────────────────────────────────────────────────────

const COPILOT_HEADERS = {
	"Content-Type": "application/json",
	Accept: "application/json",
	"User-Agent": "GitHubCopilotChat/0.35.0",
	"Editor-Version": "vscode/1.107.0",
	"Editor-Plugin-Version": "copilot-chat/0.35.0",
	"Copilot-Integration-Id": "vscode-chat",
	"X-GitHub-Api-Version": "2025-04-01",
};

const BRIDGE_KEY = "__pi_copilot_usage";
let _bridgeRefreshTimer: ReturnType<typeof setInterval> | undefined;

// ── Helpers ───────────────────────────────────────────────────────────

function normalizeHost(input?: string): string {
	if (!input) return "github.com";
	const trimmed = input.trim();
	if (!trimmed) return "github.com";
	try {
		const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
		return url.hostname || "github.com";
	} catch {
		return "github.com";
	}
}

function normalizeApiBaseUrl(input?: string): string {
	if (!input) return "https://api.github.com";
	const trimmed = input.trim();
	if (!trimmed) return "https://api.github.com";
	try {
		const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
		return `${url.protocol}//${url.host}`;
	} catch {
		return "https://api.github.com";
	}
}

function buildCopilotApiBaseUrl(enterpriseUrl?: string): string {
	return `https://api.${normalizeHost(enterpriseUrl)}`;
}

function buildCopilotUsageUrlFromApiBase(apiBaseUrl?: string): string {
	return `${normalizeApiBaseUrl(apiBaseUrl)}/copilot_internal/user`;
}

export function buildCopilotUsageUrl(enterpriseUrl?: string): string {
	return buildCopilotUsageUrlFromApiBase(buildCopilotApiBaseUrl(enterpriseUrl));
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function buildUsageBar(percent: number, segments = 12): string {
	const clamped = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
	const filled = Math.round((clamped / 100) * segments);
	return `${"█".repeat(filled)}${"░".repeat(segments - filled)}`;
}

function parseQuotaSnapshot(snapshot: CopilotQuotaSnapshot | undefined): CopilotUsageSummary | null {
	if (!snapshot) return null;
	const total = toNumber(snapshot.entitlement);
	const remaining = toNumber(snapshot.quota_remaining) ?? toNumber(snapshot.remaining);
	if (total != null && remaining != null) {
		const used = Math.max(0, Math.round(total - remaining));
		const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((used / total) * 100))) : 0;
		const roundedTotal = Math.max(0, Math.round(total));
		const roundedRemaining = Math.max(0, Math.round(remaining));
		return {
			used,
			total: roundedTotal,
			remaining: roundedRemaining,
			percent,
			bar: buildUsageBar(percent),
			usedLabel: `${used}/${roundedTotal}`,
			unlimited: false,
		};
	}
	if (snapshot.unlimited) {
		return {
			used: 0,
			total: 0,
			remaining: 0,
			percent: 0,
			bar: buildUsageBar(0),
			usedLabel: "unlimited",
			unlimited: true,
		};
	}
	return null;
}

export function parseCopilotUsageResponse(data: unknown): CopilotUsageSummary | null {
	if (!data || typeof data !== "object") return null;
	const snapshots = (data as CopilotUsageResponse).quota_snapshots;
	if (!snapshots || typeof snapshots !== "object") return null;
	return parseQuotaSnapshot(snapshots.premium_interactions) ?? null;
}

export function buildCopilotUsageLine(summary: CopilotUsageSummary): string {
	if (summary.unlimited) return "copilot unlimited";
	return `copilot [${summary.bar}] ${summary.percent}% | ${summary.usedLabel}`;
}

async function fetchQuotaPayload(url: string, token: string, authScheme: "Bearer" | "token"): Promise<unknown | null> {
	const headers = new Headers(COPILOT_HEADERS);
	headers.set("Authorization", `${authScheme} ${token}`);
	const response = await fetch(url, { headers });
	if (!response.ok) return null;
	return response.json();
}

async function exchangeForCopilotToken(oauthToken: string): Promise<{ token: string; apiBaseUrl?: string } | null> {
	try {
		const headers = new Headers(COPILOT_HEADERS);
		headers.set("Authorization", `Bearer ${oauthToken}`);
		const response = await fetch("https://api.github.com/copilot_internal/v2/token", { headers });
		if (!response.ok) return null;
		const tokenData = (await response.json()) as CopilotTokenResponse;
		const token = typeof tokenData.token === "string" && tokenData.token.trim() ? tokenData.token.trim() : "";
		if (!token) return null;
		const apiBaseUrl = typeof tokenData.endpoints?.api === "string" && tokenData.endpoints.api.trim() ? tokenData.endpoints.api.trim() : undefined;
		return { token, apiBaseUrl };
	} catch {
		return null;
	}
}

async function fetchCopilotUsageForToken(apiBaseUrl: string, token: string): Promise<CopilotUsageSummary | null> {
	const url = buildCopilotUsageUrlFromApiBase(apiBaseUrl);
	for (const authScheme of ["Bearer", "token"] as const) {
		try {
			const payload = await fetchQuotaPayload(url, token, authScheme);
			const summary = parseCopilotUsageResponse(payload);
			if (summary) return summary;
		} catch {
			// try the next auth scheme
		}
	}
	return null;
}

async function readCopilotLogin(authStorage: CopilotAuthStorageLike): Promise<{ token: string; enterpriseUrl?: string } | null> {
	authStorage.reload();
	const credential = authStorage.get("github-copilot") as CopilotCredentialsLike | undefined;
	const enterpriseUrl = typeof credential?.enterpriseUrl === "string" ? credential.enterpriseUrl : undefined;
	const refresh = typeof credential?.refresh === "string" ? credential.refresh.trim() : "";
	const access = typeof credential?.access === "string" ? credential.access.trim() : "";
	const token = refresh || access;
	if (token) return { token, enterpriseUrl };
	const apiKey = await authStorage.getApiKey("github-copilot");
	if (!apiKey) return null;
	return { token: apiKey, enterpriseUrl };
}

export async function fetchCopilotUsageFromLogin(authStorage: CopilotAuthStorageLike): Promise<CopilotUsageSummary | null> {
	const login = await readCopilotLogin(authStorage);
	if (!login) return null;
	const defaultApiBaseUrl = buildCopilotApiBaseUrl(login.enterpriseUrl);
	const sessionToken = await exchangeForCopilotToken(login.token);
	if (sessionToken) {
		const apiBaseUrl = sessionToken.apiBaseUrl || defaultApiBaseUrl;
		const exchangedSummary = await fetchCopilotUsageForToken(apiBaseUrl, sessionToken.token);
		if (exchangedSummary) return exchangedSummary;
	}
	return fetchCopilotUsageForToken(defaultApiBaseUrl, login.token);
}

// ── Global bridge ─────────────────────────────────────────────────────

/**
 * Install the `globalThis.__pi_copilot_usage` bridge. Returns the bridge
 * itself for in-process use (the parent extension).
 *
 * The bridge starts a background refresh loop: it fetches immediately,
 * then every 10 minutes. Reads from any other extension return a stable
 * `CopilotUsageStatus` value: `"loading"`, `"not-logged-in"`, or the
 * latest `CopilotUsageSummary`.
 */
export function installCopilotUsageBridge(authStorage: CopilotAuthStorageLike): CopilotUsageBridge {
	const storage = authStorage;
	let status: CopilotUsageStatus = "loading";

	async function refresh(): Promise<void> {
		try {
			const summary = await fetchCopilotUsageFromLogin(storage);
			status = summary ?? "not-logged-in";
		} catch {
			status = "not-logged-in";
		}
	}

	const bridge: CopilotUsageBridge = {
		get: () => status,
		refresh,
	};

	(globalThis as any)[BRIDGE_KEY] = bridge;

	// Kick off an initial fetch and a 10-minute refresh loop. The bridge
	// stays in `loading` state until the first fetch completes.
	void refresh();
	clearInterval(_bridgeRefreshTimer);
	_bridgeRefreshTimer = setInterval(() => void refresh(), 10 * 60 * 1000);

	return bridge;
}

/**
 * Destroy the Copilot usage bridge — clears the background refresh timer.
 * Call this on session_shutdown to prevent timer leaks.
 */
export function destroyCopilotUsageBridge(): void {
	clearInterval(_bridgeRefreshTimer);
	_bridgeRefreshTimer = undefined;
}

/**
 * Read the current Copilot usage status from the globalThis bridge.
 * Returns `undefined` if the context extension (or another bridge
 * installer) hasn't installed it yet.
 */
export function readCopilotUsage(): CopilotUsageStatus | undefined {
	const bridge = (globalThis as any)[BRIDGE_KEY] as CopilotUsageBridge | undefined;
	return bridge?.get();
}
