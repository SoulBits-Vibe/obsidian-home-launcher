import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import type HomeLauncherPlugin from "./main";
import type { ActionKind, HomeAction } from "./types";

const ACTION_KIND_LABELS: Record<ActionKind, string> = {
	"new-note": "Create new page",
	"quick-capture": "Quick capture",
	command: "Run a command",
	file: "Open a file",
	folder: "Reveal a folder",
	search: "Run a search",
	url: "Open a URL",
};

/** Kinds that need no target — the action is fully described by its kind. */
const TARGETLESS: ActionKind[] = ["new-note", "quick-capture"];

const TARGET_PLACEHOLDERS: Record<ActionKind, string> = {
	"new-note": "",
	"quick-capture": "",
	command: "",
	file: "Notes/Dashboard.md",
	folder: "Projects",
	search: "tag:#todo",
	url: "https://example.com",
};

type TabId = "appearance" | "search" | "buttons" | "lists" | "behaviour";

const TABS: { id: TabId; label: string; icon: string }[] = [
	{ id: "appearance", label: "Appearance", icon: "palette" },
	{ id: "search", label: "Search", icon: "search" },
	{ id: "buttons", label: "Buttons", icon: "square-mouse-pointer" },
	{ id: "lists", label: "Recents", icon: "clock" },
	{ id: "behaviour", label: "Behaviour", icon: "settings-2" },
];

export class HomeSettingTab extends PluginSettingTab {
	/** Kept on the instance so re-rendering never bounces you back to the top. */
	private tab: TabId = "appearance";

	constructor(
		app: App,
		private plugin: HomeLauncherPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("home-launcher-settings");

		const nav = containerEl.createDiv({ cls: "home-launcher-settings-nav" });
		for (const tab of TABS) {
			const btn = nav.createEl("button", { cls: "home-launcher-settings-tab" });
			const icon = btn.createSpan({ cls: "home-launcher-settings-tab-icon" });
			setIcon(icon, tab.icon);
			btn.createSpan({ text: tab.label });
			btn.toggleClass("is-active", this.tab === tab.id);
			btn.addEventListener("click", () => {
				this.tab = tab.id;
				this.display();
			});
		}

		const body = containerEl.createDiv({ cls: "home-launcher-settings-body" });
		switch (this.tab) {
			case "appearance":
				this.appearanceSection(body);
				break;
			case "search":
				this.searchSection(body);
				break;
			case "buttons":
				this.actionsSection(body);
				break;
			case "lists":
				this.blocksSection(body);
				break;
			case "behaviour":
				this.behaviourSection(body);
				break;
		}
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
	}

	// ── Appearance ────────────────────────────────────────────────────────

	private appearanceSection(el: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(el).setName("Logo").setHeading();

		new Setting(el)
			.setName("Logo")
			.setDesc("Show an icon, an image from your vault, or nothing.")
			.addDropdown((d) =>
				d
					.addOptions({ none: "None", icon: "Icon", image: "Image" })
					.setValue(s.logoKind)
					.onChange(async (v) => {
						s.logoKind = v as typeof s.logoKind;
						await this.save();
						this.display();
					}),
			);

		if (s.logoKind === "icon") {
			new Setting(el)
				.setName("Icon name")
				.setDesc("Lucide icon name, such as house, sparkles or library.")
				.addText((t) =>
					t
						.setPlaceholder("")
						.setValue(s.logoIcon)
						.onChange(async (v) => {
							s.logoIcon = v.trim();
							await this.save();
						}),
				);
		}

		if (s.logoKind === "image") {
			new Setting(el)
				.setName("Image path")
				.setDesc("Vault-relative path to an image file.")
				.addText((t) =>
					t
						.setPlaceholder("Assets/logo.png")
						.setValue(s.logoImagePath)
						.onChange(async (v) => {
							s.logoImagePath = v.trim();
							await this.save();
						}),
				);
		}

		if (s.logoKind !== "none") {
			new Setting(el)
				.setName("Logo size")
				.addSlider((sl) =>
					sl
						.setLimits(0.4, 4, 0.1)
						.setValue(s.logoScale)
						.onChange(async (v) => {
							s.logoScale = v;
							await this.save();
						}),
				);

			if (s.logoKind === "icon") {
				this.colorSetting(
					el,
					"Logo colour",
					() => s.logoColorSource,
					(v) => (s.logoColorSource = v),
					() => s.logoColor,
					(v) => (s.logoColor = v),
				);
			}
		}

		new Setting(el).setName("Title").setHeading();

		new Setting(el)
			.setName("Show title")
			.addToggle((t) =>
				t.setValue(s.showWordmark).onChange(async (v) => {
					s.showWordmark = v;
					await this.save();
					this.display();
				}),
			);

		if (s.showWordmark) {
			new Setting(el)
				.setName("Title text")
				.setDesc("Leave empty to use the vault name.")
				.addText((t) =>
					t
						.setPlaceholder(this.app.vault.getName())
						.setValue(s.wordmark)
						.onChange(async (v) => {
							s.wordmark = v;
							await this.save();
						}),
				);

			new Setting(el).setName("Title font").addDropdown((d) =>
				d
					.addOptions({
						text: "Text",
						interface: "Interface",
						monospace: "Monospace",
					})
					.setValue(s.font)
					.onChange(async (v) => {
						s.font = v as typeof s.font;
						await this.save();
					}),
			);

			new Setting(el)
				.setName("Title size")
				.setDesc("In em. Obsidian's h1 is about 1.8.")
				.addSlider((sl) =>
				sl
					.setLimits(0.8, 5, 0.1)
					.setValue(s.fontSize)
					.onChange(async (v) => {
						s.fontSize = v;
						await this.save();
					}),
			);

			new Setting(el).setName("Title weight").addSlider((sl) =>
				sl
					.setLimits(100, 900, 100)
					.setValue(s.fontWeight)
					.onChange(async (v) => {
						s.fontWeight = v;
						await this.save();
					}),
			);

			this.colorSetting(
				el,
				"Title colour",
				() => s.fontColorSource,
				(v) => (s.fontColorSource = v),
				() => s.fontColor,
				(v) => (s.fontColor = v),
			);
		}

		this.quoteSection(el);
	}

	// ── Quote ─────────────────────────────────────────────────────────────

	private quoteSection(el: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(el).setName("Quote").setHeading();

		new Setting(el)
			.setName("Show a quote")
			.setDesc("Draws one line at a time from a note you point at.")
			.addToggle((t) =>
				t.setValue(s.showQuote).onChange(async (v) => {
					s.showQuote = v;
					await this.save();
					this.display();
				}),
			);

		if (!s.showQuote) return;

		new Setting(el)
			.setName("Quote file")
			.setDesc(
				"Vault path to a note. One quote per line, or longer ones separated by a --- rule. " +
					"Bullets, blockquotes and headings are handled. End a line with — Author for attribution.",
			)
			.addText((t) =>
				t
					.setPlaceholder("Affirmations.md")
					.setValue(s.quoteFile)
					.onChange(async (v) => {
						s.quoteFile = v.trim();
						await this.save();
					}),
			);

		new Setting(el)
			.setName("Rotation")
			.setDesc("Click the quote to step to the next one either way.")
			.addDropdown((d) =>
				d
					.addOptions({
						daily: "One a day",
						random: "Random each time",
					})
					.setValue(s.quoteRotation)
					.onChange(async (v) => {
						s.quoteRotation = v as typeof s.quoteRotation;
						await this.save();
					}),
			);

		new Setting(el).setName("Position").addDropdown((d) =>
			d
				.addOptions({ above: "Above the title", below: "Below the title" })
				.setValue(s.quotePosition)
				.onChange(async (v) => {
					s.quotePosition = v as typeof s.quotePosition;
					await this.save();
				}),
		);
	}

	private colorSetting(
		el: HTMLElement,
		name: string,
		getSource: () => "default" | "accent" | "custom",
		setSource: (v: "default" | "accent" | "custom") => void,
		getColor: () => string,
		setColor: (v: string) => void,
	): void {
		const setting = new Setting(el).setName(name).addDropdown((d) =>
			d
				.addOptions({ default: "Theme", accent: "Accent", custom: "Custom" })
				.setValue(getSource())
				.onChange(async (v) => {
					setSource(v as "default" | "accent" | "custom");
					await this.save();
					this.display();
				}),
		);

		if (getSource() === "custom") {
			setting.addColorPicker((c) =>
				c.setValue(getColor()).onChange(async (v) => {
					setColor(v);
					await this.save();
				}),
			);
		}
	}

	// ── Search ────────────────────────────────────────────────────────────

	private searchSection(el: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(el).setName("Results").setHeading();

		new Setting(el).setName("Placeholder text").addText((t) =>
			t
				.setPlaceholder("Search your vault…")
				.setValue(s.searchPlaceholder)
				.onChange(async (v) => {
					s.searchPlaceholder = v;
					await this.save();
				}),
		);

		new Setting(el)
			.setName("Maximum results")
			.addSlider((sl) =>
				sl
					.setLimits(3, 20, 1)
					.setValue(s.maxResults)
					.onChange(async (v) => {
						s.maxResults = v;
						await this.save();
					}),
			);

		new Setting(el)
			.setName("Search delay")
			.setDesc("Milliseconds to wait before searching. Raise this in very large vaults.")
			.addSlider((sl) =>
				sl
					.setLimits(0, 500, 25)
					.setValue(s.searchDelay)
					.onChange(async (v) => {
						s.searchDelay = v;
						await this.save();
					}),
			);

		new Setting(el).setName("What gets searched").setHeading();

		new Setting(el)
			.setName("Search note contents")
			.setDesc("Also match text inside notes, not just names, aliases, headings and tags.")
			.addToggle((t) =>
				t.setValue(s.searchContent).onChange(async (v) => {
					s.searchContent = v;
					await this.save();
					this.display();
				}),
			);

		if (s.searchContent) {
			new Setting(el)
				.setName("Show excerpts")
				.setDesc("Show the matching line of text under content results.")
				.addToggle((t) =>
					t.setValue(s.showExcerpt).onChange(async (v) => {
						s.showExcerpt = v;
						await this.save();
					}),
				);
		}

		new Setting(el)
			.setName("Show why a result matched")
			.setDesc("Label results that matched an alias, heading, tag or note body.")
			.addToggle((t) =>
				t.setValue(s.showMatchSource).onChange(async (v) => {
					s.showMatchSource = v;
					await this.save();
				}),
			);

		new Setting(el)
			.setName("Markdown files only")
			.setDesc("Only search Markdown files, ignoring attachments.")
			.addToggle((t) =>
				t.setValue(s.markdownOnly).onChange(async (v) => {
					s.markdownOnly = v;
					await this.save();
				}),
			);

		new Setting(el)
			.setName("Include unresolved links")
			.setDesc("Show notes that are linked to but do not exist yet. Selecting one creates it.")
			.addToggle((t) =>
				t.setValue(s.showUnresolvedLinks).onChange(async (v) => {
					s.showUnresolvedLinks = v;
					await this.save();
				}),
			);

		new Setting(el)
			.setName("Show file paths")
			.addToggle((t) =>
				t.setValue(s.showPath).onChange(async (v) => {
					s.showPath = v;
					await this.save();
				}),
			);

		new Setting(el)
			.setName("Highlight selection with accent colour")
			.addToggle((t) =>
				t.setValue(s.highlightWithAccent).onChange(async (v) => {
					s.highlightWithAccent = v;
					await this.save();
				}),
			);

		new Setting(el)
			.setName("Show keyboard hints")
			.addToggle((t) =>
				t.setValue(s.showShortcutHints).onChange(async (v) => {
					s.showShortcutHints = v;
					await this.save();
				}),
			);
	}

	// ── Actions ───────────────────────────────────────────────────────────

	private actionsSection(el: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(el)
			.setName("Show buttons")
			.addToggle((t) =>
				t.setValue(s.showActions).onChange(async (v) => {
					s.showActions = v;
					await this.save();
					this.display();
				}),
			);

		if (!s.showActions) return;

		new Setting(el).setName("Button style").addDropdown((d) =>
			d
				.addOptions({ pill: "Pill", icon: "Icon only", card: "Card" })
				.setValue(s.actionStyle)
				.onChange(async (v) => {
					s.actionStyle = v as typeof s.actionStyle;
					await this.save();
				}),
		);

		const list = el.createDiv({ cls: "home-launcher-action-list" });
		s.actions.forEach((action, i) => { this.actionEditor(list, action, i); });

		new Setting(el).addButton((b) =>
			b
				.setButtonText("Add button")
				.setCta()
				.onClick(async () => {
					s.actions.push({
						id: `act-${Date.now().toString(36)}`,
						label: "New button",
						icon: "circle",
						kind: "command",
						target: "",
						enabled: true,
					});
					await this.save();
					this.display();
				}),
		);
	}

	private actionEditor(parent: HTMLElement, action: HomeAction, index: number): void {
		const s = this.plugin.settings;
		const enabled = action.enabled !== false;
		const box = parent.createDiv({ cls: "home-launcher-action-editor" });
		box.toggleClass("is-disabled", !enabled);

		const head = box.createDiv({ cls: "home-launcher-action-editor-head" });
		const preview = head.createDiv({ cls: "home-launcher-action-preview" });
		if (action.icon) setIcon(preview, action.icon);
		head.createSpan({ text: action.label || "Untitled button" });
		if (!enabled) head.createSpan({ cls: "home-launcher-action-off", text: "hidden" });

		const controls = head.createDiv({ cls: "home-launcher-action-controls" });

		// Hide rather than delete, so a button can come back without rebuilding it.
		this.iconButton(controls, enabled ? "eye" : "eye-off", "Show on the home page", true, async () => {
			action.enabled = !enabled;
			await this.save();
			this.display();
		});

		this.iconButton(controls, "arrow-up", "Move up", index > 0, async () => {
			[s.actions[index - 1], s.actions[index]] = [s.actions[index], s.actions[index - 1]];
			await this.save();
			this.display();
		});
		this.iconButton(
			controls,
			"arrow-down",
			"Move down",
			index < s.actions.length - 1,
			async () => {
				[s.actions[index + 1], s.actions[index]] = [s.actions[index], s.actions[index + 1]];
				await this.save();
				this.display();
			},
		);
		this.iconButton(controls, "trash-2", "Remove", true, async () => {
			s.actions.splice(index, 1);
			await this.save();
			this.display();
		});

		new Setting(box).setName("Label").addText((t) =>
			t.setValue(action.label).onChange(async (v) => {
				action.label = v;
				await this.save();
			}),
		);

		new Setting(box)
			.setName("Icon")
			.setDesc("Lucide icon name.")
			.addText((t) =>
				t
					.setPlaceholder("")
					.setValue(action.icon)
					.onChange(async (v) => {
						action.icon = v.trim();
						await this.save();
					}),
			);

		new Setting(box).setName("Does").addDropdown((d) =>
			d
				.addOptions(ACTION_KIND_LABELS)
				.setValue(action.kind)
				.onChange(async (v) => {
					action.kind = v as ActionKind;
					action.target = "";
					await this.save();
					this.display();
				}),
		);

		if (TARGETLESS.includes(action.kind)) return;

		if (action.kind === "command") {
			const commands = this.app.commands.listCommands();
			const options: Record<string, string> = {};
			for (const c of commands.sort((a, b) => a.name.localeCompare(b.name))) {
				options[c.id] = c.name;
			}
			new Setting(box).setName("Command").addDropdown((d) =>
				d
					.addOptions(options)
					.setValue(action.target || commands[0]?.id || "")
					.onChange(async (v) => {
						action.target = v;
						await this.save();
					}),
			);
			return;
		}

		new Setting(box).setName("Target").addText((t) =>
			t
				.setPlaceholder(TARGET_PLACEHOLDERS[action.kind])
				.setValue(action.target)
				.onChange(async (v) => {
					action.target = v.trim();
					await this.save();
				}),
		);
	}

	private iconButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		enabled: boolean,
		onClick: () => Promise<void>,
	): void {
		const btn = parent.createEl("button", {
			cls: "clickable-icon home-launcher-icon-button",
			attr: { "aria-label": label },
		});
		setIcon(btn, icon);
		btn.disabled = !enabled;
		btn.addEventListener("click", () => void onClick());
	}

	// ── Blocks ────────────────────────────────────────────────────────────

	private blocksSection(el: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(el).setName("Recent files").setHeading();

		new Setting(el)
			.setName("Show recent files")
			.addToggle((t) =>
				t.setValue(s.showRecents).onChange(async (v) => {
					s.showRecents = v;
					await this.save();
					this.display();
				}),
			);

		if (s.showRecents) {
			new Setting(el).setName("Number of recent files").addSlider((sl) =>
				sl
					.setLimits(3, 25, 1)
					.setValue(s.maxRecents)
					.onChange(async (v) => {
						s.maxRecents = v;
						await this.save();
					}),
			);

			new Setting(el)
				.setName("Track opened files")
				.setDesc("Turn off to stop recording which files you open.")
				.addToggle((t) =>
					t.setValue(s.storeRecents).onChange(async (v) => {
						s.storeRecents = v;
						await this.save();
					}),
				);

			new Setting(el)
				.setName("Clear recent files")
				.addButton((b) =>
					// setWarning is deprecated in favour of setDestructive, but that is
					// @since 1.13.0 and this plugin supports 1.11.0. Deprecated-but-
					// present beats calling a method that does not exist yet.
					b.setButtonText("Clear").setWarning().onClick(async () => {
						s.recentsStore = [];
						await this.save();
					}),
				);
		}

		new Setting(el).setName("Bookmarks").setHeading();

		new Setting(el)
			.setName("Show bookmarks")
			.setDesc("Reads from Obsidian's core bookmarks plugin.")
			.addToggle((t) =>
				t.setValue(s.showBookmarks).onChange(async (v) => {
					s.showBookmarks = v;
					await this.save();
					this.display();
				}),
			);

		if (s.showBookmarks) {
			new Setting(el).setName("Number of bookmarks").addSlider((sl) =>
				sl
					.setLimits(3, 25, 1)
					.setValue(s.maxBookmarks)
					.onChange(async (v) => {
						s.maxBookmarks = v;
						await this.save();
					}),
			);
		}
	}

	// ── Behaviour ─────────────────────────────────────────────────────────

	private behaviourSection(el: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(el).setName("Opening").setHeading();

		new Setting(el)
			.setName("Replace new tabs")
			.setDesc("Open the home page instead of a blank tab.")
			.addToggle((t) =>
				t.setValue(s.replaceNewTabs).onChange(async (v) => {
					s.replaceNewTabs = v;
					await this.save();
				}),
			);

		new Setting(el)
			.setName("Open on startup")
			.addToggle((t) =>
				t.setValue(s.openOnStartup).onChange(async (v) => {
					s.openOnStartup = v;
					await this.save();
				}),
			);

		new Setting(el)
			.setName("Focus search on open")
			.setDesc("Disabled on phones, where it would raise the keyboard.")
			.addToggle((t) =>
				t.setValue(s.focusSearchOnOpen).onChange(async (v) => {
					s.focusSearchOnOpen = v;
					await this.save();
				}),
			);

		new Setting(el).setName("New page and capture").setHeading();

		new Setting(el)
			.setName("New page folder")
			.setDesc("Where the new page button creates notes. Empty uses Obsidian's default.")
			.addText((t) =>
				t
					.setPlaceholder("Default")
					.setValue(s.newNoteFolder)
					.onChange(async (v) => {
						s.newNoteFolder = v.trim();
						await this.save();
					}),
			);

		new Setting(el)
			.setName("Quick capture goes to")
			.setDesc("Daily note uses your daily notes folder, date format and template.")
			.addDropdown((d) =>
				d
					.addOptions({ daily: "Today's daily note", file: "A specific file" })
					.setValue(s.captureTarget)
					.onChange(async (v) => {
						s.captureTarget = v as typeof s.captureTarget;
						await this.save();
						this.display();
					}),
			);

		if (s.captureTarget === "file") {
			new Setting(el)
				.setName("Capture file")
				.setDesc("Created if it does not exist yet.")
				.addText((t) =>
					t
						.setPlaceholder("Capture.md")
						.setValue(s.quickCaptureFile)
						.onChange(async (v) => {
							s.quickCaptureFile = v.trim();
							await this.save();
						}),
				);
		}

		new Setting(el)
			.setName("Append under heading")
			.setDesc(
				"Optional. Adds entries at the end of that section, e.g. Log. Leave empty to append at the end of the note.",
			)
			.addText((t) =>
				t
					.setPlaceholder("Log")
					.setValue(s.captureHeading)
					.onChange(async (v) => {
						s.captureHeading = v.trim();
						await this.save();
					}),
			);

		new Setting(el)
			.setName("Quick capture format")
			.setDesc("Supports {{text}}, {{time}} and {{date}}.")
			.addText((t) =>
				t
					.setPlaceholder("- {{time}} {{text}}")
					.setValue(s.quickCaptureFormat)
					.onChange(async (v) => {
						s.quickCaptureFormat = v;
						await this.save();
					}),
			);
	}
}
