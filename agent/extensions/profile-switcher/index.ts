import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LoginDialogComponent } from "@earendil-works/pi-coding-agent";
import type { OAuthLoginCallbacks, OAuthProviderId } from "@earendil-works/pi-ai";
import { Input, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const AUTH_PATH = path.join(os.homedir(), ".pi", "agent", "auth.json");

type StoredCredential = {
	type: string;
	[key: string]: unknown;
};

interface ProfileGroup {
	active: string;
	profiles: Record<string, StoredCredential>;
}

interface AuthFile {
	profiles?: Record<string, ProfileGroup>;
	[provider: string]: unknown;
}

type FlatEntry =
	| {
		kind: "header";
		provider: string;
		label: string;
	}
	| {
		kind: "profile";
		provider: string;
		name: string;
		label: string;
		active: boolean;
		credential: StoredCredential;
	};

type DialogAction =
	| { action: "switch"; provider: string; name: string }
	| { action: "rename"; provider: string; name: string; newName: string }
	| { action: "delete"; provider: string; name: string }
	| { action: "create"; provider: string; name: string }
	| { action: "cancel" };

function isCredential(value: unknown): value is StoredCredential {
	return Boolean(value) && typeof value === "object" && typeof (value as { type?: unknown }).type === "string";
}

function readAuthFile(): AuthFile {
	try {
		if (!fs.existsSync(AUTH_PATH)) return { profiles: {} };
		const raw = fs.readFileSync(AUTH_PATH, "utf8");
		const parsed = raw.trim() ? (JSON.parse(raw) as AuthFile) : { profiles: {} };
		if (!parsed.profiles) parsed.profiles = {};
		return parsed;
	} catch {
		return { profiles: {} };
	}
}

function writeAuthFile(data: AuthFile): void {
	const dir = path.dirname(AUTH_PATH);
	fs.mkdirSync(dir, { recursive: true });
	const tempPath = `${AUTH_PATH}.tmp.${process.pid}`;
	fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	try {
		fs.renameSync(tempPath, AUTH_PATH);
	} catch (error) {
		try { fs.unlinkSync(tempPath); } catch {}
		throw error;
	}
}

function getTopLevelCredential(data: AuthFile, provider: string): StoredCredential | undefined {
	const value = data[provider];
	return isCredential(value) ? value : undefined;
}

function ensureProfilesSection(data: AuthFile): Record<string, ProfileGroup> {
	if (!data.profiles) data.profiles = {};
	return data.profiles;
}

function ensureProviderGroup(data: AuthFile, provider: string): ProfileGroup {
	const groups = ensureProfilesSection(data);
	if (!groups[provider]) {
		groups[provider] = { active: "", profiles: {} };
	}
	return groups[provider];
}

function syncTopLevelFromGroup(data: AuthFile, provider: string): void {
	const group = data.profiles?.[provider];
	if (!group) return;
	const activeName = group.active && group.profiles[group.active] ? group.active : Object.keys(group.profiles)[0];
	if (!activeName) return;
	data[provider] = { ...group.profiles[activeName] };
	group.active = activeName;
}

function normalizeAuthData(data: AuthFile): boolean {
	let changed = false;
	const groups = ensureProfilesSection(data);
	const providers = new Set<string>();

	for (const key of Object.keys(data)) {
		if (key !== "profiles" && isCredential(data[key])) providers.add(key);
	}
	for (const key of Object.keys(groups)) providers.add(key);

	for (const provider of providers) {
		const topLevel = getTopLevelCredential(data, provider);
		const group = groups[provider];

		if (!group) {
			if (topLevel) {
				groups[provider] = {
					active: "default",
					profiles: { default: { ...topLevel } },
				};
				changed = true;
			}
			continue;
		}

		const profileNames = Object.keys(group.profiles);
		if (profileNames.length < 1) {
			delete groups[provider];
			delete data[provider];
			changed = true;
			continue;
		}

		if (!group.active || !group.profiles[group.active]) {
			group.active = profileNames[0];
			changed = true;
		}

		if (!topLevel) {
			data[provider] = { ...group.profiles[group.active] };
			changed = true;
		}
	}

	return changed;
}

function loadAuthData(): AuthFile {
	const data = readAuthFile();
	if (normalizeAuthData(data)) {
		writeAuthFile(data);
	}
	return data;
}

function profileEntries(data: AuthFile): FlatEntry[] {
	const entries: FlatEntry[] = [];
	const groups = data.profiles ?? {};

	for (const [provider, group] of Object.entries(groups)) {
		const profileNames = Object.keys(group.profiles);
		entries.push({ kind: "header", provider, label: provider });
		for (const name of profileNames) {
			entries.push({
				kind: "profile",
				provider,
				name,
				label: name,
				active: name === group.active,
				credential: group.profiles[name],
			});
		}
	}

	return entries;
}

function resolveCurrentProvider(entries: FlatEntry[], index: number): string | undefined {
	const current = entries[index];
	if (current) return current.provider;
	return entries.find((entry) => entry.kind === "profile" || entry.kind === "header")?.provider;
}

function getActiveProfileName(group: ProfileGroup): string {
	if (group.active && group.profiles[group.active]) return group.active;
	return Object.keys(group.profiles)[0] ?? "";
}

function updateRuntimeAuth(ctx: { modelRegistry: { authStorage: { reload: () => void } ; refresh: () => void } }): void {
	ctx.modelRegistry.authStorage.reload();
	ctx.modelRegistry.refresh();
}

async function runOAuthLogin(
	ctx: {
		ui: {
			custom: <T>(factory: (tui: any, theme: any, kb: any, done: (result: T) => void) => any) => Promise<T>;
		};
		modelRegistry: {
			authStorage: {
				login: (providerId: OAuthProviderId, callbacks: OAuthLoginCallbacks) => Promise<void>;
				getOAuthProviders: () => Array<{ id: string; name: string; usesCallbackServer?: boolean }>;
			};
		};
	},
	providerId: string,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		ctx.ui.custom<void>((tui, _theme, _kb, done) => {
			const dialog = new LoginDialogComponent(tui, providerId, (success, message) => {
				if (success) {
					resolve();
				} else {
					reject(new Error(message ?? "Login cancelled"));
				}
				done(undefined);
			});

			ctx.modelRegistry.authStorage
				.login(providerId as OAuthProviderId, {
					onAuth: (info) => {
						dialog.showAuth(info.url, info.instructions);
						if (providerId === "github-copilot") {
							dialog.showWaiting("Waiting for browser authentication...");
						}
					},
					onPrompt: (prompt) => dialog.showPrompt(prompt.message, prompt.placeholder),
					onProgress: (message) => dialog.showProgress(message),
					signal: dialog.signal,
				})
				.then(() => { resolve(); done(undefined); })
				.catch((err: unknown) => { reject(err instanceof Error ? err : new Error(String(err))); done(undefined); });

			return dialog;
		});
	});
}

function switchProfile(data: AuthFile, provider: string, name: string): boolean {
	const group = data.profiles?.[provider];
	if (!group) return false;
	const credential = group.profiles[name];
	if (!credential) return false;
	group.active = name;
	data[provider] = { ...credential };
	return true;
}

function renameProfile(data: AuthFile, provider: string, from: string, to: string): boolean {
	const group = data.profiles?.[provider];
	if (!group) return false;
	if (!group.profiles[from] || group.profiles[to]) return false;
	group.profiles[to] = group.profiles[from];
	delete group.profiles[from];
	if (group.active === from) group.active = to;
	syncTopLevelFromGroup(data, provider);
	return true;
}

function deleteProfile(data: AuthFile, provider: string, name: string): boolean {
	const group = data.profiles?.[provider];
	if (!group || !group.profiles[name]) return false;
	delete group.profiles[name];

	if (Object.keys(group.profiles).length < 1) {
		delete data.profiles![provider];
		delete data[provider];
		return true;
	}

	if (group.active === name) {
		group.active = getActiveProfileName(group);
	}
	if (group.active) {
		syncTopLevelFromGroup(data, provider);
	}
	return true;
}

function addCreatedProfile(data: AuthFile, provider: string, name: string, credential: StoredCredential): void {
	const group = ensureProviderGroup(data, provider);
	group.profiles[name] = { ...credential };
	group.active = name;
	data[provider] = { ...credential };
}

function getAuthMode(data: AuthFile, provider: string): "oauth" | "api_key" | "unknown" {
	const current = getTopLevelCredential(data, provider);
	if (current?.type === "oauth") return "oauth";
	if (current?.type === "api_key") return "api_key";
	return "unknown";
}

class ProfileSwitcherComponent {
	private _focused = false;
	private readonly input = new Input();
	private readonly providers: { provider: string; profiles: { name: string; label: string; active: boolean; credential: StoredCredential }[] }[] = [];
	private tabIndex = 0;
	private profileIndex = 0;
	private mode: "browse" | "rename" | "create" = "browse";
	private editProvider = "";
	private editOriginalName = "";
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	private deleteArmed = false;
	private deleteArmedProvider = "";
	private deleteArmedName = "";
	public onDone: ((result: DialogAction) => void) | undefined;

	constructor(
		private readonly tui: { requestRender: () => void },
		private readonly theme: { fg: (name: string, text: string) => string; bg: (name: string, text: string) => string; bold: (text: string) => string; inverse: (text: string) => string },
		data: AuthFile,
		initialProvider?: string,
		initialProfile?: string
	) {
		const groups = data.profiles ?? {};
		for (const [provider, group] of Object.entries(groups)) {
			const profileNames = Object.keys(group.profiles);
			const profiles = profileNames.map((name) => ({
				name,
				label: name,
				active: name === group.active,
				credential: group.profiles[name]
			}));
			this.providers.push({ provider, profiles });
		}
		
		if (initialProvider) {
			const pIdx = this.providers.findIndex(p => p.provider === initialProvider);
			if (pIdx >= 0) {
				this.tabIndex = pIdx;
				if (initialProfile) {
					const prIdx = this.providers[pIdx].profiles.findIndex(pr => pr.name === initialProfile);
					if (prIdx >= 0) {
						this.profileIndex = prIdx;
					}
				}
			}
		}

		this.input.onSubmit = (value) => this.commitInput(value);
		this.input.onEscape = () => {
			this.mode = "browse";
			this.input.setValue("");
			this.syncFocus();
			this.invalidate();
			this.tui.requestRender();
		};
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.syncFocus();
	}

	private syncFocus(): void {
		this.input.focused = this._focused && this.mode !== "browse";
	}

	private currentProvider(): string | undefined {
		return this.providers[this.tabIndex]?.provider;
	}

	private currentProfile() {
		return this.providers[this.tabIndex]?.profiles[this.profileIndex];
	}

	private moveTab(delta: number): void {
		if (this.providers.length === 0) return;
		this.resetDeleteArm();
		this.tabIndex = (this.tabIndex + delta + this.providers.length) % this.providers.length;
		this.profileIndex = 0;
		this.invalidate();
	}

	private moveProfile(delta: number): void {
		const profiles = this.providers[this.tabIndex]?.profiles;
		if (!profiles || profiles.length === 0) return;
		this.resetDeleteArm();
		let next = this.profileIndex + delta;
		if (next < 0) next = 0;
		if (next >= profiles.length) next = profiles.length - 1;
		this.profileIndex = next;
		this.invalidate();
	}

	private resetDeleteArm(): void {
		this.deleteArmed = false;
		this.deleteArmedProvider = "";
		this.deleteArmedName = "";
	}

	private openEditor(mode: "rename" | "create", provider: string, value: string, originalName = ""): void {
		this.resetDeleteArm();
		this.mode = mode;
		this.editProvider = provider;
		this.editOriginalName = originalName;
		this.input.setValue(value);
		this.syncFocus();
		this.invalidate();
		this.tui.requestRender();
	}

	private commitInput(value: string): void {
		const trimmed = value.trim();
		if (!trimmed) {
			this.mode = "browse";
			this.input.setValue("");
			this.syncFocus();
			this.invalidate();
			this.tui.requestRender();
			return;
		}

		const provider = this.editProvider || this.currentProvider();
		if (!provider) {
			this.onDone?.({ action: "cancel" });
			return;
		}

		if (this.mode === "rename") {
			this.onDone?.({ action: "rename", provider, name: this.editOriginalName, newName: trimmed });
			return;
		}

		this.onDone?.({ action: "create", provider, name: trimmed });
	}

	handleInput(data: string): void {
		if (this.mode !== "browse") {
			this.input.handleInput(data);
			this.invalidate();
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.tab)) {
			this.moveTab(1);
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.up)) {
			this.moveProfile(-1);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.moveProfile(1);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.left)) {
			this.moveTab(-1);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.right)) {
			this.moveTab(1);
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.enter)) {
			this.resetDeleteArm();
			const provider = this.currentProvider();
			const profile = this.currentProfile();
			if (provider && profile) {
				this.onDone?.({ action: "switch", provider, name: profile.name });
			}
			return;
		}

		if (matchesKey(data, Key.escape)) {
			this.resetDeleteArm();
			this.onDone?.({ action: "cancel" });
			return;
		}

		const provider = this.currentProvider();
		const profile = this.currentProfile();
		
		if (matchesKey(data, Key.ctrl("r"))) {
			if (provider && profile) {
				this.openEditor("rename", provider, profile.name, profile.name);
			}
			return;
		}
		if (matchesKey(data, Key.ctrl("n"))) {
		    if (provider) {
			    this.openEditor("create", provider, "");
			}
			return;
		}
		if (matchesKey(data, Key.ctrl("d"))) {
			if (!provider || !profile) {
				this.resetDeleteArm();
				return;
			}
			if (this.deleteArmed && this.deleteArmedProvider === provider && this.deleteArmedName === profile.name) {
				this.resetDeleteArm();
				this.onDone?.({ action: "delete", provider, name: profile.name });
				return;
			}
			this.deleteArmed = true;
			this.deleteArmedProvider = provider;
			this.deleteArmedName = profile.name;
			this.invalidate();
			this.tui.requestRender();
			return;
		}

		this.resetDeleteArm();
	}

	private renderHelp(): string {
		if (this.mode === "rename") {
			return "Enter to confirm rename • Esc to cancel";
		}
		if (this.mode === "create") {
			return "Enter to create profile • Esc to cancel";
		}
		return "Tab switch provider • ↑↓ move • Enter switch • ^N new • ^R rename • ^D delete • Esc close";
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const lines: string[] = [];
		const add = (text: string) => lines.push(truncateToWidth(text, width));
		const arrow = this.theme.fg("accent", "─".repeat(Math.max(0, width)));
		add(arrow);
		add(this.theme.fg("accent", this.theme.bold(" Profile Switcher")));
		lines.push("");
		
		if (this.providers.length > 0) {
			const tabs = this.providers.map((p, i) => {
				const label = p.provider;
				if (i === this.tabIndex) {
					return this.theme.bg("selectedBg", this.theme.fg("text", this.theme.bold(` ${label} `)));
				}
				return this.theme.bg("toolPendingBg", this.theme.fg("muted", ` ${label} `));
			});
			add(" " + tabs.join(" "));
		}
		lines.push("");

		if (this.providers.length === 0) {
			add(this.theme.fg("muted", " No saved profiles found."));
			add(this.theme.fg("dim", " Press ^N to create one once a provider exists, or Esc to close."));
		} else {
			const group = this.providers[this.tabIndex];
			if (group && group.profiles.length > 0) {
				for (let i = 0; i < group.profiles.length; i++) {
					const entry = group.profiles[i];
					const selected = i === this.profileIndex;
					const icon = entry.active ? "■" : "□";
					
					const marker = selected ? this.theme.fg("accent", "  " + icon + " ") : "  " + icon + " ";
					const name = selected ? this.theme.fg("accent", entry.label) : this.theme.fg("text", entry.label);
					const active = entry.active ? ` ${this.theme.fg("dim", "[active]")}` : "";
					add(`${marker}${name}${active}`);
				}
			} else {
				add(this.theme.fg("muted", " No profiles for this provider."));
			}
		}

		lines.push("");
		if (this.deleteArmed && this.mode === "browse") {
			add(this.theme.fg("warning", ` Delete armed for ${this.deleteArmedProvider}/${this.deleteArmedName} • press ^D again to confirm`));
			lines.push("");
		}
		if (this.mode === "rename" || this.mode === "create") {
			add(this.theme.fg("muted", this.mode === "rename" ? " Rename profile:" : " New profile name:"));
			for (const line of this.input.render(Math.max(8, width - 2))) {
				add(` ${line}`);
			}
			add(this.theme.fg("dim", this.renderHelp()));
		} else {
			add(this.theme.fg("dim", this.renderHelp()));
		}

		add(arrow);
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.input.invalidate();
	}
}

export default function (pi: ExtensionAPI) {
	// Self-register in global feature registry
	(globalThis as any).__pi_extension_features?.push({
		name: "profile-switcher",
		description: "Manage auth provider profiles — switch, create, rename, or delete credentials",
		commands: ["/profile"],
	});

	pi.registerCommand("profile", {
		description: "Manage auth profiles — switch, create, rename, or delete",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("profile requires interactive mode", "error");
				return;
			}

			let data = loadAuthData();
			updateRuntimeAuth(ctx);
			let lastProvider: string | undefined;
			let lastProfile: string | undefined;

			while (true) {
				const result = await ctx.ui.custom<DialogAction>((tui, theme, _kb, done) => {
					const component = new ProfileSwitcherComponent(tui, theme, data, lastProvider, lastProfile);
					component.onDone = done;
					component.focused = true;
					return component;
				});

				if (!result || result.action === "cancel") return;
				
				lastProvider = result.provider;
				lastProfile = result.action === "rename" ? result.newName : result.name;

				if (result.action === "switch") {
					if (switchProfile(data, result.provider, result.name)) {
						writeAuthFile(data);
						updateRuntimeAuth(ctx);
						ctx.ui.notify(`Switched ${result.provider} → ${result.name}`, "success");
					}
					data = loadAuthData();
					continue;
				}

				if (result.action === "rename") {
					if (!result.newName.trim()) {
						ctx.ui.notify("Profile name cannot be empty", "error");
						data = loadAuthData();
						updateRuntimeAuth(ctx);
						continue;
					}
					if (result.newName === result.name) {
						data = loadAuthData();
						continue;
					}
					const group = data.profiles?.[result.provider];
					if (!group) {
						ctx.ui.notify(`Unknown provider: ${result.provider}`, "error");
						data = loadAuthData();
						continue;
					}
					if (group.profiles[result.newName]) {
						ctx.ui.notify(`Profile "${result.newName}" already exists`, "error");
						data = loadAuthData();
						continue;
					}
					if (!renameProfile(data, result.provider, result.name, result.newName)) {
						ctx.ui.notify(`Unable to rename ${result.name}`, "error");
						data = loadAuthData();
						updateRuntimeAuth(ctx);
						continue;
					}
					writeAuthFile(data);
					updateRuntimeAuth(ctx);
					ctx.ui.notify(`Renamed ${result.name} → ${result.newName}`, "success");
					data = loadAuthData();
					updateRuntimeAuth(ctx);
					continue;
				}

				if (result.action === "delete") {
					const group = data.profiles?.[result.provider];
					if (!group || !group.profiles[result.name]) {
						ctx.ui.notify(`Unable to delete ${result.name}`, "error");
						data = loadAuthData();
						updateRuntimeAuth(ctx);
						continue;
					}
					const ok = await ctx.ui.confirm("Delete profile", `Delete "${result.name}" from ${result.provider}?`);
					if (!ok) {
						data = loadAuthData();
						continue;
					}
					if (!deleteProfile(data, result.provider, result.name)) {
						ctx.ui.notify(`Unable to delete ${result.name}`, "error");
						data = loadAuthData();
						updateRuntimeAuth(ctx);
						continue;
					}
					writeAuthFile(data);
					updateRuntimeAuth(ctx);
					ctx.ui.notify(`Deleted ${result.name} from ${result.provider}`, "success");
					data = loadAuthData();
					updateRuntimeAuth(ctx);
					continue;
				}

				if (result.action === "create") {
					const provider = result.provider;
					const profileName = result.name.trim();
					if (!provider) {
						ctx.ui.notify("No provider selected for the new profile", "error");
						data = loadAuthData();
						continue;
					}
					if (!profileName) {
						ctx.ui.notify("Profile name cannot be empty", "error");
						data = loadAuthData();
						continue;
					}
					const group = ensureProviderGroup(data, provider);
					if (group.profiles[profileName]) {
						ctx.ui.notify(`Profile "${profileName}" already exists`, "error");
						data = loadAuthData();
						updateRuntimeAuth(ctx);
						continue;
					}

					const mode = getAuthMode(data, provider);
					const oauthProviders = new Set(
						ctx.modelRegistry.authStorage.getOAuthProviders().map((entry) =>
							typeof entry === "string" ? entry : entry.id,
						),
					);
					if (mode === "oauth" || (mode === "unknown" && oauthProviders.has(provider))) {
						// Snapshot the currently active credential so we can restore it after login
						const prevCredential = getTopLevelCredential(data, provider);
						const prevActiveName = data.profiles?.[provider]?.active;
						try {
							await runOAuthLogin(ctx, provider);
							// Login wrote the new credential to the top-level; read it back
							data = loadAuthData();
							const newCredential = getTopLevelCredential(data, provider);
							if (!newCredential) {
								ctx.ui.notify(`Login for ${provider} did not produce credentials`, "error");
								continue;
							}
							// Append the new credential as a named profile
							const providerGroup = ensureProviderGroup(data, provider);
							providerGroup.profiles[profileName] = { ...newCredential };
							// Restore the previously active credential to the top-level
							if (prevCredential && prevActiveName) {
								providerGroup.active = prevActiveName;
								data[provider] = { ...prevCredential };
							} else if (!providerGroup.active) {
								// No prior active profile — make the new one active
								providerGroup.active = profileName;
								data[provider] = { ...newCredential };
							}
							writeAuthFile(data);
							updateRuntimeAuth(ctx);
							ctx.ui.notify(`Created profile "${profileName}" for ${provider}`, "success");
							data = loadAuthData();
							updateRuntimeAuth(ctx);
							continue;
						} catch (error) {
							ctx.ui.notify(`Login failed for ${provider}: ${error instanceof Error ? error.message : String(error)}`, "error");
							data = loadAuthData();
							updateRuntimeAuth(ctx);
							continue;
						}
					}

					const apiKey = await ctx.ui.input(`Paste API key for ${provider} profile "${profileName}"`);
					if (!apiKey || !apiKey.trim()) {
						data = loadAuthData();
						continue;
					}
					const credential: StoredCredential = { type: "api_key", key: apiKey.trim() };
					addCreatedProfile(data, provider, profileName, credential);
					writeAuthFile(data);
					updateRuntimeAuth(ctx);
					ctx.ui.notify(`Created profile "${profileName}" for ${provider}`, "success");
					data = loadAuthData();
					updateRuntimeAuth(ctx);
					continue;
				}
			}
		},
	});
}
