import {
	ItemView,
	Platform,
	TFile,
	WorkspaceLeaf,
	setIcon,
	normalizePath,
	type BookmarkItem,
} from "obsidian";
import { HOME_VIEW_TYPE, type HomeAction } from "./types";
import { VaultSearch, renderHighlighted, type FileMatch, type MatchSource } from "./search";
import { ActionRunner } from "./actions";
import { parseQuotes, pickQuote, type Quote } from "./quotes";
import type HomeLauncherPlugin from "./main";

const SOURCE_ICONS: Record<MatchSource, string> = {
	name: "file-text",
	path: "folder",
	alias: "tags",
	heading: "heading",
	tag: "hash",
	content: "align-left",
};

const SOURCE_LABELS: Record<MatchSource, string> = {
	name: "name",
	path: "path",
	alias: "alias",
	heading: "heading",
	tag: "tag",
	content: "in text",
};

export class HomeView extends ItemView {
	private search: VaultSearch;
	private runner: ActionRunner;

	private inputEl!: HTMLInputElement;
	private barEl!: HTMLElement;
	private suggestionsEl!: HTMLElement;
	private blocksEl!: HTMLElement;

	private results: FileMatch[] = [];
	private selected = -1;
	private searchTimer: number | null = null;
	/** Flipped to aborted whenever a newer query starts, so stale scans stop. */
	private contentSignal = { aborted: false };

	private quotes: Quote[] = [];
	private quoteOffset = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: HomeLauncherPlugin,
	) {
		super(leaf);
		this.search = new VaultSearch(this.app, plugin.settings);
		this.runner = new ActionRunner(this.app, plugin.settings);
		this.navigation = true;
	}

	getViewType(): string {
		return HOME_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Home";
	}

	getIcon(): string {
		return "house";
	}

	async onOpen(): Promise<void> {
		this.render();

		// Focus only when the view first opens. Doing this inside render() meant
		// every settings keystroke re-rendered the view and stole focus from the
		// field being typed into.
		if (this.plugin.settings.focusSearchOnOpen && !Platform.isPhone) {
			window.setTimeout(() => this.inputEl?.focus(), 0);
		}
	}

	async onClose(): Promise<void> {
		if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
		this.contentSignal.aborted = true;
		this.contentEl.empty();
	}

	/** Re-render in place — used when settings change or the vault updates. */
	refresh(): void {
		this.search = new VaultSearch(this.app, this.plugin.settings);
		this.runner = new ActionRunner(this.app, this.plugin.settings);
		this.render();
	}

	/** Cheaper refresh for vault events: only the recents/bookmarks blocks. */
	refreshBlocks(): void {
		if (!this.blocksEl) return;
		this.blocksEl.empty();
		this.renderBlocks(this.blocksEl);
	}

	// ── Page ──────────────────────────────────────────────────────────────

	private render(): void {
		const s = this.plugin.settings;
		const root = this.contentEl;
		root.empty();
		root.addClass("home-launcher-view");
		root.toggleClass("is-phone", Platform.isPhone);

		const page = root.createDiv({ cls: "home-launcher-content" });

		if (s.showQuote && s.quotePosition === "above") this.renderQuote(page);
		this.renderHeader(page);
		if (s.showQuote && s.quotePosition === "below") this.renderQuote(page);
		this.renderSearch(page);
		if (s.showActions && s.actions.some((a) => a.enabled !== false)) this.renderActions(page);

		this.blocksEl = page.createDiv({ cls: "home-launcher-blocks" });
		this.renderBlocks(this.blocksEl);
	}

	private renderHeader(parent: HTMLElement): void {
		const s = this.plugin.settings;
		if (s.logoKind === "none" && !s.showWordmark) return;

		const header = parent.createDiv({ cls: "home-launcher-header" });

		// User-configurable values are published as CSS custom properties and
		// consumed in styles.css, rather than assigned as inline properties.
		// That keeps every actual declaration overridable by themes and snippets.
		header.style.setProperty("--home-logo-scale", String(s.logoScale));
		header.style.setProperty("--home-title-size", `${s.fontSize}em`);
		header.style.setProperty("--home-title-weight", String(s.fontWeight));
		header.style.setProperty("--home-title-font", this.fontFamily());
		header.style.setProperty("--home-logo-color", s.logoColor);
		header.style.setProperty("--home-title-color", s.fontColor);

		if (s.logoKind === "icon" && s.logoIcon) {
			const logo = header.createDiv({ cls: "home-launcher-logo" });
			setIcon(logo, s.logoIcon);
			logo.addClass(`use-${s.logoColorSource}`);
		} else if (s.logoKind === "image" && s.logoImagePath) {
			const file = this.app.vault.getFileByPath(normalizePath(s.logoImagePath));
			if (file) {
				const img = header.createEl("img", { cls: "home-launcher-logo-img" });
				img.src = this.app.vault.getResourcePath(file);
			}
		}

		if (s.showWordmark) {
			const text = s.wordmark.trim() || this.app.vault.getName();
			const mark = header.createDiv({ cls: "home-launcher-wordmark", text });
			mark.addClass(`use-${s.fontColorSource}`);
		}
	}

	// ── Quote ─────────────────────────────────────────────────────────────

	private renderQuote(parent: HTMLElement): void {
		const el = parent.createDiv({ cls: "home-launcher-quote" });
		void this.loadQuote(el);
	}

	private async loadQuote(el: HTMLElement): Promise<void> {
		const path = this.plugin.settings.quoteFile.trim();
		if (!path) return;

		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) return;

		this.quotes = parseQuotes(await this.app.vault.cachedRead(file));
		if (!this.quotes.length) return;

		this.paintQuote(el);

		// Click to step to the next one without leaving the page.
		el.addClass("is-clickable");
		el.setAttribute("aria-label", "Show another");
		el.addEventListener("click", () => {
			this.quoteOffset++;
			this.paintQuote(el);
		});
	}

	private paintQuote(el: HTMLElement): void {
		const quote = pickQuote(
			this.quotes,
			this.plugin.settings.quoteRotation,
			this.quoteOffset,
		);
		if (!quote) return;

		el.empty();
		el.createDiv({ cls: "home-launcher-quote-text", text: quote.text });
		if (quote.source) {
			el.createDiv({ cls: "home-launcher-quote-source", text: `— ${quote.source}` });
		}
	}

	/**
	 * Gives a row the same hover preview as a normal internal link.
	 *
	 * Uses a plain listener rather than registerDomEvent: these elements are
	 * rebuilt on every keystroke, and component-scoped listeners would pile up
	 * on detached nodes until the view closed.
	 */
	private attachPreview(el: HTMLElement, path: string): void {
		if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) return;

		el.addEventListener("mouseover", (event) => {
			this.app.workspace.trigger("hover-link", {
				event,
				source: HOME_VIEW_TYPE,
				hoverParent: this.leaf,
				targetEl: el,
				linktext: path,
				sourcePath: path,
			});
		});
	}

	private fontFamily(): string {
		switch (this.plugin.settings.font) {
			case "interface":
				return "var(--font-interface)";
			case "monospace":
				return "var(--font-monospace)";
			default:
				return "var(--font-text)";
		}
	}

	// ── Search ────────────────────────────────────────────────────────────

	private renderSearch(parent: HTMLElement): void {
		const s = this.plugin.settings;
		const wrap = parent.createDiv({ cls: "home-launcher-search" });

		const bar = wrap.createDiv({ cls: "home-launcher-searchbar" });
		this.barEl = bar;
		const icon = bar.createDiv({ cls: "home-launcher-search-icon" });
		setIcon(icon, "search");

		this.inputEl = bar.createEl("input", {
			cls: "home-launcher-search-input",
			attr: {
				type: "text",
				placeholder: s.searchPlaceholder,
				spellcheck: "false",
				enterkeyhint: "go",
			},
		});

		const clear = bar.createDiv({ cls: "home-launcher-search-clear" });
		setIcon(clear, "x");
		clear.addEventListener("click", () => {
			this.inputEl.value = "";
			this.inputEl.focus();
			this.updateResults("");
		});

		this.suggestionsEl = wrap.createDiv({ cls: "home-launcher-suggestions" });

		this.inputEl.addEventListener("input", () => {
			bar.toggleClass("has-value", this.inputEl.value.length > 0);
			const value = this.inputEl.value;
			if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
			if (s.searchDelay > 0) {
				this.searchTimer = window.setTimeout(
					() => this.updateResults(value),
					s.searchDelay,
				);
			} else {
				this.updateResults(value);
			}
		});

		this.inputEl.addEventListener("keydown", (evt) => this.onSearchKey(evt));
	}

	private onSearchKey(evt: KeyboardEvent): void {
		switch (evt.key) {
			case "ArrowDown":
				evt.preventDefault();
				this.moveSelection(1);
				break;
			case "ArrowUp":
				evt.preventDefault();
				this.moveSelection(-1);
				break;
			case "Enter": {
				if (!this.results.length) return;
				evt.preventDefault();
				const match = this.results[Math.max(this.selected, 0)];
				void this.openMatch(match, evt.ctrlKey || evt.metaKey);
				break;
			}
			case "Escape":
				evt.preventDefault();
				if (this.inputEl.value) {
					this.inputEl.value = "";
					this.updateResults("");
				} else {
					this.inputEl.blur();
				}
				break;
		}
	}

	private moveSelection(delta: number): void {
		if (!this.results.length) return;
		const count = this.results.length;
		this.selected = (this.selected + delta + count) % count;
		this.paintSelection();
	}

	private paintSelection(): void {
		const items = Array.from(
			this.suggestionsEl.querySelectorAll<HTMLElement>(".home-launcher-suggestion"),
		);
		items.forEach((el, i) => {
			el.toggleClass("is-selected", i === this.selected);
			if (i === this.selected) el.scrollIntoView({ block: "nearest" });
		});
	}

	private updateResults(query: string): void {
		// Stop any in-flight content scan from a previous keystroke.
		this.contentSignal.aborted = true;
		this.contentSignal = { aborted: false };

		this.results = this.search.queryMetadata(query);
		this.selected = this.results.length ? 0 : -1;
		this.renderSuggestions();

		if (!this.plugin.settings.searchContent || !query.trim()) return;

		const signal = this.contentSignal;
		const seen = new Set(this.results.map((r) => r.path));
		const room = this.plugin.settings.maxResults - this.results.length;

		void (async () => {
			// First fill in counts, headings and excerpts for the rows already shown,
			// then look for notes that only match in their body.
			await this.search.enrich(query, this.results, signal, () => {
				if (!signal.aborted) this.renderSuggestions();
			});
			if (signal.aborted) return;

			await this.search.queryContent(query, seen, Math.max(room, 3), signal, (match) => {
				if (signal.aborted) return;
				this.results.push(match);
				if (this.selected < 0) this.selected = 0;
				this.renderSuggestions();
			});
		})();
	}

	private renderSuggestions(): void {
		const s = this.plugin.settings;
		const box = this.suggestionsEl;
		box.empty();
		box.toggleClass("is-open", this.results.length > 0);
		box.toggleClass("use-accent-color", s.highlightWithAccent);
		// Square off the bar's bottom corners so it reads as one fused control.
		this.barEl.toggleClass("has-suggestions", this.results.length > 0);

		this.results.forEach((match, i) => {
			const item = box.createDiv({ cls: "home-launcher-suggestion" });
			item.toggleClass("is-selected", i === this.selected);

			const iconEl = item.createDiv({ cls: "home-launcher-suggestion-icon" });
			setIcon(iconEl, match.unresolved ? "file-plus" : SOURCE_ICONS[match.source]);

			const body = item.createDiv({ cls: "home-launcher-suggestion-body" });

			// Title line: name on the left; extension and match count on the right.
			const titleRow = body.createDiv({ cls: "home-launcher-suggestion-titlerow" });
			const title = titleRow.createDiv({ cls: "home-launcher-suggestion-title" });
			title.toggleClass("is-unresolved", match.unresolved);
			renderHighlighted(title, match.basename, match.matches);

			const meta = titleRow.createDiv({ cls: "home-launcher-suggestion-meta" });
			if (!match.unresolved) {
				meta.createSpan({
					cls: "home-launcher-suggestion-ext",
					text: `.${match.extension}`,
				});
			}
			if (match.matchCount) {
				meta.createSpan({
					cls: "home-launcher-suggestion-count",
					text: `${match.matchCount} ${match.matchCount === 1 ? "match" : "matches"}`,
				});
			}
			if (s.showMatchSource && match.source !== "name" && match.source !== "content") {
				meta.createSpan({
					cls: "home-launcher-suggestion-source",
					text: SOURCE_LABELS[match.source],
				});
			}

			// Folder path, with its own icon, the way the file explorer shows it.
			if (s.showPath && !match.unresolved && match.path.includes("/")) {
				const row = body.createDiv({ cls: "home-launcher-suggestion-folder" });
				const folderIcon = row.createSpan({ cls: "home-launcher-suggestion-folder-icon" });
				setIcon(folderIcon, "folder");
				row.createSpan({ text: match.path.slice(0, match.path.lastIndexOf("/")) });
			}

			// An alias or tag that matched, when the filename did not.
			if (match.context) {
				body.createDiv({
					cls: "home-launcher-suggestion-context",
					text: match.source === "tag" ? `#${match.context}` : match.context,
				});
			}

			// Where in the document the match sits: H1, then the section heading.
			for (const heading of match.headings ?? []) {
				const el = body.createDiv({ cls: "home-launcher-suggestion-heading" });
				renderHighlighted(el, heading.text, heading.matches);
			}

			if (s.showExcerpt && match.excerpt) {
				const excerpt = body.createDiv({ cls: "home-launcher-suggestion-excerpt" });
				renderHighlighted(excerpt, match.excerpt.text, match.excerpt.matches);
			}

			if (match.unresolved) {
				body.createDiv({
					cls: "home-launcher-suggestion-context",
					text: "Not created yet — press ↵ to create",
				});
			}

			item.addEventListener("mouseenter", () => {
				this.selected = i;
				this.paintSelection();
			});
			item.addEventListener("click", (evt) => {
				void this.openMatch(match, evt.ctrlKey || evt.metaKey);
			});
			if (match.file) this.attachPreview(item, match.path);
		});

		if (this.results.length && s.showShortcutHints && !Platform.isPhone) {
			const hints = box.createDiv({ cls: "home-launcher-hints" });
			this.addHint(hints, "↑↓", "navigate");
			this.addHint(hints, "↵", "open");
			this.addHint(hints, Platform.isMacOS ? "⌘↵" : "Ctrl ↵", "new tab");
			this.addHint(hints, "esc", "clear");
		}
	}

	private addHint(parent: HTMLElement, key: string, label: string): void {
		const hint = parent.createDiv({ cls: "home-launcher-hint" });
		hint.createEl("kbd", { text: key });
		hint.createSpan({ text: label });
	}

	private async openMatch(match: FileMatch, newTab: boolean): Promise<void> {
		const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);

		if (match.file) {
			await leaf.openFile(match.file);
			return;
		}

		// Unresolved link — create the note, then open it.
		const path = normalizePath(
			match.path.endsWith(".md") ? match.path : `${match.path}.md`,
		);
		const created = await this.app.vault.create(path, "");
		await leaf.openFile(created);
	}

	// ── Actions ───────────────────────────────────────────────────────────

	private renderActions(parent: HTMLElement): void {
		const s = this.plugin.settings;
		const row = parent.createDiv({ cls: "home-launcher-actions" });
		row.addClass(`is-${s.actionStyle}`);

		// `enabled` is absent on buttons saved before the toggle existed — treat as on.
		for (const action of s.actions.filter((a) => a.enabled !== false)) {
			const btn = row.createEl("button", {
				cls: "home-launcher-action",
				attr: { "aria-label": action.label },
			});
			if (action.icon) {
				const iconEl = btn.createDiv({ cls: "home-launcher-action-icon" });
				setIcon(iconEl, action.icon);
			}
			if (s.actionStyle !== "icon") {
				btn.createSpan({ cls: "home-launcher-action-label", text: action.label });
			}
			btn.addEventListener("click", () => void this.runAction(action));
		}
	}

	private async runAction(action: HomeAction): Promise<void> {
		await this.runner.run(action);
	}

	// ── Recents & bookmarks ───────────────────────────────────────────────

	private renderBlocks(parent: HTMLElement): void {
		const s = this.plugin.settings;
		if (s.showRecents) this.renderRecents(parent);
		if (s.showBookmarks) this.renderBookmarks(parent);
	}

	private renderRecents(parent: HTMLElement): void {
		const s = this.plugin.settings;
		const files = s.recentsStore
			.map((entry) => this.app.vault.getAbstractFileByPath(entry.path))
			.filter((f): f is TFile => f instanceof TFile)
			.slice(0, s.maxRecents);

		const block = this.createBlock(parent, "Recent", "clock");
		if (!files.length) {
			block.createDiv({ cls: "home-launcher-empty", text: "No recent files yet." });
			return;
		}
		for (const file of files) {
			this.createFileRow(block, file.basename, file.path, "file-text", () =>
				this.app.workspace.getLeaf(false).openFile(file),
			);
		}
	}

	private renderBookmarks(parent: HTMLElement): void {
		const s = this.plugin.settings;
		const items = this.collectBookmarks().slice(0, s.maxBookmarks);

		const block = this.createBlock(parent, "Bookmarks", "bookmark");
		if (!items.length) {
			block.createDiv({
				cls: "home-launcher-empty",
				text: "No bookmarks yet.",
			});
			return;
		}

		for (const item of items) {
			const path = item.path ?? "";
			const file = this.app.vault.getAbstractFileByPath(path);
			const label = item.title || (file instanceof TFile ? file.basename : path);
			this.createFileRow(block, label, path, "bookmark", () => {
				if (file instanceof TFile) {
					void this.app.workspace.getLeaf(false).openFile(file);
				}
			});
		}
	}

	/** Flattens bookmark groups down to file entries. */
	private collectBookmarks(): BookmarkItem[] {
		const plugin = this.app.internalPlugins.getPluginById("bookmarks");
		const all = plugin?.instance?.getBookmarks?.() ?? [];
		const out: BookmarkItem[] = [];

		const walk = (items: BookmarkItem[]) => {
			for (const item of items) {
				if (item.type === "group" && item.items) walk(item.items);
				else if (item.type === "file") out.push(item);
			}
		};
		walk(all);
		return out;
	}

	private createBlock(parent: HTMLElement, title: string, icon: string): HTMLElement {
		const block = parent.createDiv({ cls: "home-launcher-block" });
		const head = block.createDiv({ cls: "home-launcher-block-head" });
		const iconEl = head.createDiv({ cls: "home-launcher-block-icon" });
		setIcon(iconEl, icon);
		head.createSpan({ cls: "home-launcher-block-title", text: title });
		return block.createDiv({ cls: "home-launcher-block-body" });
	}

	private createFileRow(
		parent: HTMLElement,
		label: string,
		path: string,
		icon: string,
		onClick: () => void,
	): void {
		const row = parent.createDiv({ cls: "home-launcher-row" });
		const iconEl = row.createDiv({ cls: "home-launcher-row-icon" });
		setIcon(iconEl, icon);

		const body = row.createDiv({ cls: "home-launcher-row-body" });
		body.createDiv({ cls: "home-launcher-row-title", text: label });
		if (this.plugin.settings.showPath && path.includes("/")) {
			body.createDiv({
				cls: "home-launcher-row-path",
				text: path.slice(0, path.lastIndexOf("/")),
			});
		}
		row.addEventListener("click", onClick);
		this.attachPreview(row, path);
	}
}
