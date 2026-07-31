import { Plugin, TFile, WorkspaceLeaf } from "obsidian";
import {
	DEFAULT_SETTINGS,
	HOME_VIEW_TYPE,
	type HomeSettings,
	type RecentFile,
} from "./types";
import { HomeView } from "./view";
import { HomeSettingTab } from "./settings";
import { ActionRunner } from "./actions";

export default class HomeLauncherPlugin extends Plugin {
	settings: HomeSettings = structuredClone(DEFAULT_SETTINGS);

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(HOME_VIEW_TYPE, (leaf) => new HomeView(leaf, this));

		// Lets the core Page preview plugin show note previews when hovering our
		// rows, exactly as it does for normal internal links. Appears as its own
		// toggle under Settings → Page preview.
		this.registerHoverLinkSource(HOME_VIEW_TYPE, {
			display: "Home Launcher",
			defaultMod: false,
		});
		this.addSettingTab(new HomeSettingTab(this.app, this));

		this.addRibbonIcon("house", "Open home page", () => void this.openHome(false));

		this.addCommand({
			id: "open-home",
			name: "Open home page",
			callback: () => void this.openHome(false),
		});

		this.addCommand({
			id: "open-in-new-tab",
			name: "Open home page in new tab",
			callback: () => void this.openHome(true),
		});

		this.addCommand({
			id: "new-note",
			name: "Create new page",
			callback: () => void new ActionRunner(this.app, this.settings).newNote(),
		});

		this.addCommand({
			id: "quick-capture",
			name: "Quick capture",
			callback: () => { new ActionRunner(this.app, this.settings).quickCapture(); },
		});

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => { this.trackRecent(file); }),
		);

		// Keep the blocks honest when files move or disappear.
		this.registerEvent(this.app.vault.on("rename", () => { this.refreshBlocks(); }));
		this.registerEvent(this.app.vault.on("delete", () => { this.refreshBlocks(); }));

		this.registerEvent(
			this.app.workspace.on("layout-change", () => { this.replaceEmptyTabs(); }),
		);

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.openOnStartup) void this.openHome(false);
			this.replaceEmptyTabs();
		});
	}

	onunload(): void {
		// Leaves are cleaned up by Obsidian; nothing to tear down manually.
	}

	// ── Opening ───────────────────────────────────────────────────────────

	async openHome(newTab: boolean): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE);
		if (!newTab && existing.length) {
			void this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
		await leaf.setViewState({ type: HOME_VIEW_TYPE, active: true });
	}

	/**
	 * Turns blank tabs into the home page. Restricted to the main editor area so
	 * empty sidebar leaves are left alone.
	 */
	private replaceEmptyTabs(): void {
		if (!this.settings.replaceNewTabs) return;
		for (const leaf of this.app.workspace.getLeavesOfType("empty")) {
			if (leaf.getRoot() !== this.app.workspace.rootSplit) continue;
			void leaf.setViewState({ type: HOME_VIEW_TYPE });
		}
	}

	// ── Recents ───────────────────────────────────────────────────────────

	private trackRecent(file: TFile | null): void {
		if (!file || !this.settings.storeRecents) return;
		if (this.settings.markdownOnly && file.extension !== "md") return;

		const store: RecentFile[] = this.settings.recentsStore.filter(
			(entry) => entry.path !== file.path,
		);
		store.unshift({ path: file.path, timestamp: Date.now() });

		// Keep a little headroom above maxRecents so deleted files don't shrink the list.
		this.settings.recentsStore = store.slice(0, Math.max(this.settings.maxRecents * 2, 20));
		void this.saveSettings({ refresh: false });
		this.refreshBlocks();
	}

	// ── Views ─────────────────────────────────────────────────────────────

	private homeViews(): HomeView[] {
		return this.app.workspace
			.getLeavesOfType(HOME_VIEW_TYPE)
			.map((leaf: WorkspaceLeaf) => leaf.view)
			.filter((view): view is HomeView => view instanceof HomeView);
	}

	refreshBlocks(): void {
		for (const view of this.homeViews()) view.refreshBlocks();
	}

	refreshViews(): void {
		for (const view of this.homeViews()) view.refresh();
	}

	// ── Settings ──────────────────────────────────────────────────────────

	async loadSettings(): Promise<void> {
		// loadData() is untyped, so narrow it before merging rather than letting
		// `any` flow into the settings object.
		const saved = (await this.loadData()) as Partial<HomeSettings> | null;

		// structuredClone keeps nested defaults (actions, recentsStore) from being
		// shared by reference with DEFAULT_SETTINGS and mutated in place.
		this.settings = Object.assign(structuredClone(DEFAULT_SETTINGS), saved ?? {});
	}

	private refreshTimer: number | null = null;

	async saveSettings(opts: { refresh?: boolean } = {}): Promise<void> {
		await this.saveData(this.settings);
		if (opts.refresh === false) return;

		// Coalesce refreshes: typing in a settings field fires one save per
		// keystroke, and re-rendering the view on each is pure waste.
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refreshViews();
		}, 250);
	}
}
