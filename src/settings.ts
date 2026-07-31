import {
	App,
	PluginSettingTab,
	type SettingDefinitionItem,
	type SettingDefinitionList,
	type SettingDefinitionPage,
	type SettingGroupItem,
	type TFile,
} from "obsidian";
import type HomeLauncherPlugin from "./main";
import type { ActionKind, HomeAction, HomeSettings } from "./types";

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

/** Kinds whose target gets a dedicated picker rather than a free text field. */
const PICKER_KINDS: ActionKind[] = ["command", "file", "folder"];

const TARGET_PLACEHOLDERS: Record<ActionKind, string> = {
	"new-note": "",
	"quick-capture": "",
	command: "",
	file: "Notes/Dashboard.md",
	folder: "Projects",
	search: "tag:#todo",
	url: "https://example.com",
};

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "svg", "webp"];

/** Fields of a button that are editable through a control key. */
type ButtonField = "label" | "icon" | "kind" | "target" | "enabled";

/**
 * A control key is either a plain settings property, or a button field encoded
 * as `btn:<action id>:<field>`. Buttons are addressed by id rather than index,
 * so reordering can never rebind a control to the wrong row.
 */
const BUTTON_KEY = /^btn:(.+):(label|icon|kind|target|enabled)$/;

function buttonKey(action: HomeAction, field: ButtonField): string {
	return `btn:${action.id}:${field}`;
}

export class HomeSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: HomeLauncherPlugin,
	) {
		super(app, plugin);
	}

	private get s(): HomeSettings {
		return this.plugin.settings;
	}

	// ── Value plumbing ────────────────────────────────────────────────────

	getControlValue(key: string): unknown {
		const match = BUTTON_KEY.exec(key);
		if (match) {
			const action = this.s.actions.find((a) => a.id === match[1]);
			if (!action) return undefined;

			switch (match[2] as ButtonField) {
				case "label":
					return action.label;
				case "icon":
					return action.icon;
				case "kind":
					return action.kind;
				case "target":
					return action.target;
				case "enabled":
					// Absent means visible — see the note on HomeAction.enabled.
					return action.enabled !== false;
			}
		}
		return (this.s as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const match = BUTTON_KEY.exec(key);
		if (match) {
			const action = this.s.actions.find((a) => a.id === match[1]);
			if (action) this.applyButtonField(action, match[2] as ButtonField, value);
		} else {
			(this.s as unknown as Record<string, unknown>)[key] = value;
		}

		await this.plugin.saveSettings();
		// Re-evaluate every visible/disabled predicate against the new state.
		this.update();
	}

	private applyButtonField(action: HomeAction, field: ButtonField, value: unknown): void {
		switch (field) {
			case "label":
				action.label = String(value);
				break;
			case "icon":
				action.icon = String(value).trim();
				break;
			case "kind":
				action.kind = value as ActionKind;
				// The previous target is meaningless for a different action type.
				action.target = "";
				break;
			case "target":
				action.target = String(value).trim();
				break;
			case "enabled":
				action.enabled = Boolean(value);
				break;
		}
	}

	/** Persist and re-render after a change made outside a control. */
	private save(): void {
		void this.plugin.saveSettings();
		this.update();
	}

	// ── Definitions ───────────────────────────────────────────────────────

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			this.appearancePage(),
			this.searchPage(),
			this.buttonsPage(),
			this.listsPage(),
			this.behaviourPage(),
		];
	}

	private appearancePage(): SettingDefinitionPage {
		return {
			type: "page",
			name: "Appearance",
			desc: "Logo, title, and the quote shown above them.",
			items: [
				{
					type: "group",
					heading: "Logo",
					items: [
						{
							name: "Logo",
							desc: "Show an icon, an image from your vault, or nothing.",
							control: {
								type: "dropdown",
								key: "logoKind",
								options: { none: "None", icon: "Icon", image: "Image" },
							},
						},
						{
							name: "Icon name",
							desc: "Lucide icon name, such as house, sparkles or library.",
							aliases: ["lucide", "icon"],
							visible: () => this.s.logoKind === "icon",
							control: { type: "text", key: "logoIcon" },
						},
						{
							name: "Image",
							desc: "An image from your vault.",
							visible: () => this.s.logoKind === "image",
							control: {
								type: "file",
								key: "logoImagePath",
								filter: (f: TFile) => IMAGE_EXTENSIONS.includes(f.extension),
							},
						},
						{
							name: "Logo size",
							visible: () => this.s.logoKind !== "none",
							control: { type: "slider", key: "logoScale", min: 0.4, max: 4, step: 0.1 },
						},
						{
							name: "Logo colour",
							visible: () => this.s.logoKind === "icon",
							control: {
								type: "dropdown",
								key: "logoColorSource",
								options: { default: "Theme", accent: "Accent", custom: "Custom" },
							},
						},
						{
							name: "Custom logo colour",
							visible: () =>
								this.s.logoKind === "icon" && this.s.logoColorSource === "custom",
							control: { type: "color", key: "logoColor" },
						},
					],
				},
				{
					type: "group",
					heading: "Title",
					items: [
						{ name: "Show title", control: { type: "toggle", key: "showWordmark" } },
						{
							name: "Title text",
							desc: "Leave empty to use the vault name.",
							visible: () => this.s.showWordmark,
							control: {
								type: "text",
								key: "wordmark",
								placeholder: this.app.vault.getName(),
							},
						},
						{
							name: "Title font",
							visible: () => this.s.showWordmark,
							control: {
								type: "dropdown",
								key: "font",
								options: { text: "Text", interface: "Interface", monospace: "Monospace" },
							},
						},
						{
							name: "Title size",
							desc: "In em. Obsidian's h1 is about 1.8.",
							visible: () => this.s.showWordmark,
							control: { type: "slider", key: "fontSize", min: 0.8, max: 5, step: 0.1 },
						},
						{
							name: "Title weight",
							visible: () => this.s.showWordmark,
							control: { type: "slider", key: "fontWeight", min: 100, max: 900, step: 100 },
						},
						{
							name: "Title colour",
							visible: () => this.s.showWordmark,
							control: {
								type: "dropdown",
								key: "fontColorSource",
								options: { default: "Theme", accent: "Accent", custom: "Custom" },
							},
						},
						{
							name: "Custom title colour",
							visible: () => this.s.showWordmark && this.s.fontColorSource === "custom",
							control: { type: "color", key: "fontColor" },
						},
					],
				},
				{
					type: "group",
					heading: "Quote",
					items: [
						{
							name: "Show a quote",
							desc: "Draws one line at a time from a note you point at.",
							aliases: ["affirmation", "quote"],
							control: { type: "toggle", key: "showQuote" },
						},
						{
							name: "Quote file",
							desc:
								"One quote per line, or longer ones separated by a --- rule. " +
								"Bullets, blockquotes and headings are handled. " +
								"End a line with — Author for attribution.",
							visible: () => this.s.showQuote,
							control: { type: "file", key: "quoteFile" },
						},
						{
							name: "Rotation",
							desc: "Click the quote to step to the next one either way.",
							visible: () => this.s.showQuote,
							control: {
								type: "dropdown",
								key: "quoteRotation",
								options: { daily: "One a day", random: "Random each time" },
							},
						},
						{
							name: "Position",
							visible: () => this.s.showQuote,
							control: {
								type: "dropdown",
								key: "quotePosition",
								options: { above: "Above the title", below: "Below the title" },
							},
						},
					],
				},
			],
		};
	}

	private searchPage(): SettingDefinitionPage {
		return {
			type: "page",
			name: "Search",
			desc: "What gets searched, and how results are shown.",
			items: [
				{
					type: "group",
					heading: "Results",
					items: [
						{
							name: "Placeholder text",
							control: {
								type: "text",
								key: "searchPlaceholder",
								placeholder: "Search your vault…",
							},
						},
						{
							name: "Maximum results",
							control: { type: "slider", key: "maxResults", min: 3, max: 20, step: 1 },
						},
						{
							name: "Search delay",
							desc: "Milliseconds to wait before searching. Raise this in very large vaults.",
							control: { type: "slider", key: "searchDelay", min: 0, max: 500, step: 25 },
						},
						{ name: "Show file paths", control: { type: "toggle", key: "showPath" } },
						{
							name: "Highlight selection with accent colour",
							control: { type: "toggle", key: "highlightWithAccent" },
						},
						{
							name: "Show keyboard hints",
							control: { type: "toggle", key: "showShortcutHints" },
						},
					],
				},
				{
					type: "group",
					heading: "What gets searched",
					items: [
						{
							name: "Search note contents",
							desc: "Also match text inside notes, not just names, aliases, headings and tags.",
							control: { type: "toggle", key: "searchContent" },
						},
						{
							name: "Show excerpts",
							desc: "Show the matching line of text under content results.",
							visible: () => this.s.searchContent,
							control: { type: "toggle", key: "showExcerpt" },
						},
						{
							name: "Show why a result matched",
							desc: "Label results that matched an alias, heading, tag or note body.",
							control: { type: "toggle", key: "showMatchSource" },
						},
						{
							name: "Only Markdown files",
							desc: "Only search Markdown files, ignoring attachments.",
							control: { type: "toggle", key: "markdownOnly" },
						},
						{
							name: "Include unresolved links",
							desc: "Show notes that are linked to but do not exist yet. Selecting one creates it.",
							control: { type: "toggle", key: "showUnresolvedLinks" },
						},
					],
				},
			],
		};
	}

	private buttonsPage(): SettingDefinitionPage {
		return {
			type: "page",
			name: "Buttons",
			desc: "Actions shown under the search bar.",
			displayValue: () => `${this.s.actions.filter((a) => a.enabled !== false).length} shown`,
			items: [
				{ name: "Show buttons", control: { type: "toggle", key: "showActions" } },
				{
					name: "Button style",
					visible: () => this.s.showActions,
					control: {
						type: "dropdown",
						key: "actionStyle",
						options: { pill: "Pill", icon: "Icon only", card: "Card" },
					},
				},
				this.buttonList(),
			],
		};
	}

	/**
	 * The button collection. A list rather than a group, so Obsidian supplies
	 * reordering, deletion and the add affordance instead of hand-rolled arrows.
	 */
	private buttonList(): SettingDefinitionList {
		return {
			type: "list",
			heading: "Your buttons",
			visible: () => this.s.showActions,
			emptyState: "No buttons yet. Add one to get started.",
			items: this.s.actions.map((action) => this.buttonPage(action)),
			onReorder: (from, to) => {
				const [moved] = this.s.actions.splice(from, 1);
				this.s.actions.splice(to, 0, moved);
				this.save();
			},
			onDelete: (index) => {
				this.s.actions.splice(index, 1);
				this.save();
			},
			addItem: {
				name: "Add button",
				action: () => {
					this.s.actions.push({
						id: `act-${Date.now().toString(36)}`,
						label: "New button",
						icon: "circle",
						kind: "command",
						target: "",
						enabled: true,
					});
					this.save();
				},
			},
		};
	}

	private buttonPage(action: HomeAction): SettingDefinitionPage {
		const items: SettingGroupItem[] = [
			{
				name: "Show on the home page",
				desc: "Turn off to hide the button without deleting it.",
				control: { type: "toggle", key: buttonKey(action, "enabled") },
			},
			{ name: "Label", control: { type: "text", key: buttonKey(action, "label") } },
			{
				name: "Icon",
				desc: "Lucide icon name.",
				aliases: ["lucide"],
				control: { type: "text", key: buttonKey(action, "icon") },
			},
			{
				name: "Does",
				control: {
					type: "dropdown",
					key: buttonKey(action, "kind"),
					options: ACTION_KIND_LABELS,
				},
			},
			{
				name: "Command",
				desc: "Any command in your vault.",
				visible: () => action.kind === "command",
				control: {
					type: "dropdown",
					key: buttonKey(action, "target"),
					options: this.commandOptions(),
				},
			},
			{
				name: "File",
				visible: () => action.kind === "file",
				control: { type: "file", key: buttonKey(action, "target") },
			},
			{
				name: "Folder",
				visible: () => action.kind === "folder",
				control: { type: "folder", key: buttonKey(action, "target") },
			},
			{
				name: "Target",
				visible: () =>
					!TARGETLESS.includes(action.kind) && !PICKER_KINDS.includes(action.kind),
				control: {
					type: "text",
					key: buttonKey(action, "target"),
					placeholder: TARGET_PLACEHOLDERS[action.kind],
				},
			},
		];

		return {
			type: "page",
			name: action.label || "Untitled button",
			displayValue: () => ACTION_KIND_LABELS[action.kind],
			status: () => (action.enabled === false ? "warning" : null),
			items,
		};
	}

	private commandOptions(): Record<string, string> {
		const options: Record<string, string> = {};
		for (const c of this.app.commands
			.listCommands()
			.sort((a, b) => a.name.localeCompare(b.name))) {
			options[c.id] = c.name;
		}
		return options;
	}

	private listsPage(): SettingDefinitionPage {
		return {
			type: "page",
			name: "Recents and bookmarks",
			desc: "The two lists under the buttons.",
			items: [
				{
					type: "group",
					heading: "Recent files",
					items: [
						{ name: "Show recent files", control: { type: "toggle", key: "showRecents" } },
						{
							name: "Number of recent files",
							visible: () => this.s.showRecents,
							control: { type: "slider", key: "maxRecents", min: 3, max: 25, step: 1 },
						},
						{
							name: "Track opened files",
							desc: "Turn off to stop recording which files you open.",
							visible: () => this.s.showRecents,
							control: { type: "toggle", key: "storeRecents" },
						},
						{
							name: "Clear recent files",
							desc: "Forget every file currently in the list.",
							visible: () => this.s.showRecents,
							disabled: () => this.s.recentsStore.length === 0,
							action: () => {
								this.s.recentsStore = [];
								this.save();
							},
						},
					],
				},
				{
					type: "group",
					heading: "Bookmarks",
					items: [
						{
							name: "Show bookmarks",
							desc: "Reads from Obsidian's core bookmarks plugin.",
							control: { type: "toggle", key: "showBookmarks" },
						},
						{
							name: "Number of bookmarks",
							visible: () => this.s.showBookmarks,
							control: { type: "slider", key: "maxBookmarks", min: 3, max: 25, step: 1 },
						},
					],
				},
			],
		};
	}

	private behaviourPage(): SettingDefinitionPage {
		return {
			type: "page",
			name: "Behaviour",
			desc: "When the home page opens, and where new notes go.",
			items: [
				{
					type: "group",
					heading: "Opening",
					items: [
						{
							name: "Replace new tabs",
							desc: "Open the home page instead of a blank tab.",
							control: { type: "toggle", key: "replaceNewTabs" },
						},
						{ name: "Open on startup", control: { type: "toggle", key: "openOnStartup" } },
						{
							name: "Focus search on open",
							desc: "Disabled on phones, where it would raise the keyboard.",
							control: { type: "toggle", key: "focusSearchOnOpen" },
						},
					],
				},
				{
					type: "group",
					heading: "New page and capture",
					items: [
						{
							name: "New page folder",
							desc: "Where the new page button creates notes. Empty uses Obsidian's default.",
							control: { type: "folder", key: "newNoteFolder", includeRoot: true },
						},
						{
							name: "Quick capture goes to",
							desc: "Daily note uses your daily notes folder, date format and template.",
							control: {
								type: "dropdown",
								key: "captureTarget",
								options: { daily: "Today's daily note", file: "A specific file" },
							},
						},
						{
							name: "Capture file",
							desc: "Created if it does not exist yet.",
							visible: () => this.s.captureTarget === "file",
							control: {
								type: "text",
								key: "quickCaptureFile",
								placeholder: "Capture.md",
							},
						},
						{
							name: "Append under heading",
							desc:
								"Optional. Adds entries at the end of that section, for example Log. " +
								"Leave empty to append at the end of the note.",
							control: { type: "text", key: "captureHeading", placeholder: "Log" },
						},
						{
							name: "Quick capture format",
							desc: "Supports {{text}}, {{time}} and {{date}}.",
							control: {
								type: "text",
								key: "quickCaptureFormat",
								placeholder: "- {{time}} {{text}}",
							},
						},
					],
				},
			],
		};
	}
}
