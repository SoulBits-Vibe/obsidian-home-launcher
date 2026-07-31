export const HOME_VIEW_TYPE = "home-launcher-view";

/**
 * What an action button does when clicked. Buttons are described entirely by
 * data in settings, so adding one is a configuration change rather than a code
 * change — and never requires a companion plugin injecting into the DOM.
 */
export type ActionKind =
	| "new-note"
	| "quick-capture"
	| "command"
	| "file"
	| "folder"
	| "search"
	| "url";

export interface HomeAction {
	id: string;
	label: string;
	/** Lucide icon name, e.g. "plus", "pen-tool", "calendar". */
	icon: string;
	kind: ActionKind;
	/** Command id, file path, folder path, search query or URL — depends on `kind`. */
	target: string;
	/**
	 * Hidden buttons stay in settings but do not render, so switching one off
	 * never means rebuilding it later. Treated as true when absent.
	 */
	/**
	 * Optional because buttons saved before this flag existed have no value for
	 * it. Absent means visible, so `enabled !== false` is the correct test —
	 * a bare truthiness check would silently hide every pre-existing button.
	 */
	enabled?: boolean;
}

/** Where quick capture appends. Daily note follows your Daily Notes settings. */
export type CaptureTarget = "daily" | "file";

/** "daily" holds one quote steady all day; "random" changes on every open. */
export type QuoteRotation = "daily" | "random";

export interface RecentFile {
	path: string;
	timestamp: number;
}

export type ColorSource = "default" | "accent" | "custom";
export type FontChoice = "interface" | "text" | "monospace";
export type ActionStyle = "pill" | "icon" | "card";
export type LogoKind = "none" | "icon" | "image";

export interface HomeSettings {
	// ── Header ────────────────────────────────────────────────────────────
	logoKind: LogoKind;
	logoIcon: string;
	logoImagePath: string;
	logoScale: number;
	logoColorSource: ColorSource;
	logoColor: string;

	showWordmark: boolean;
	wordmark: string;
	font: FontChoice;
	/** In em. Obsidian's H1 is roughly 1.8em — stay near that by default. */
	fontSize: number;
	fontWeight: number;
	fontColorSource: ColorSource;
	fontColor: string;

	// ── Quote ─────────────────────────────────────────────────────────────
	showQuote: boolean;
	/** Vault path to a note holding one quote per line, or blocks split by ---. */
	quoteFile: string;
	quoteRotation: QuoteRotation;
	quotePosition: "above" | "below";

	// ── Search ────────────────────────────────────────────────────────────
	searchPlaceholder: string;
	maxResults: number;
	searchDelay: number;
	markdownOnly: boolean;
	searchContent: boolean;
	showExcerpt: boolean;
	showMatchSource: boolean;
	showUnresolvedLinks: boolean;
	showPath: boolean;
	highlightWithAccent: boolean;
	showShortcutHints: boolean;

	// ── Actions ───────────────────────────────────────────────────────────
	showActions: boolean;
	actionStyle: ActionStyle;
	actions: HomeAction[];

	// ── Blocks ────────────────────────────────────────────────────────────
	showRecents: boolean;
	maxRecents: number;
	storeRecents: boolean;
	recentsStore: RecentFile[];

	showBookmarks: boolean;
	maxBookmarks: number;

	// ── Behaviour ─────────────────────────────────────────────────────────
	replaceNewTabs: boolean;
	openOnStartup: boolean;
	focusSearchOnOpen: boolean;

	// ── New note / capture targets ────────────────────────────────────────
	newNoteFolder: string;
	captureTarget: CaptureTarget;
	/** Only used when `captureTarget` is "file". */
	quickCaptureFile: string;
	/** Optional heading to append under, e.g. "Log". Empty appends at the end. */
	captureHeading: string;
	quickCaptureFormat: string;
}

export const DEFAULT_SETTINGS: HomeSettings = {
	logoKind: "icon",
	logoIcon: "house",
	logoImagePath: "",
	logoScale: 1.2,
	logoColorSource: "default",
	logoColor: "#7c3aed",

	showWordmark: true,
	wordmark: "",
	font: "text",
	fontSize: 1.8,
	fontWeight: 600,
	fontColorSource: "default",
	fontColor: "#7c3aed",

	showQuote: false,
	quoteFile: "",
	quoteRotation: "daily",
	quotePosition: "above",

	searchPlaceholder: "Search your vault…",
	maxResults: 8,
	searchDelay: 0,
	markdownOnly: true,
	searchContent: true,
	showExcerpt: true,
	showMatchSource: true,
	showUnresolvedLinks: false,
	showPath: true,
	highlightWithAccent: true,
	showShortcutHints: true,

	showActions: true,
	actionStyle: "pill",
	actions: [
		{
			id: "act-new-note",
			label: "New page",
			icon: "file-plus",
			kind: "new-note",
			target: "",
			enabled: true,
		},
		{
			id: "act-capture",
			label: "Quick capture",
			icon: "zap",
			kind: "quick-capture",
			target: "",
			// Off by default — switch it on in settings if you want it.
			enabled: false,
		},
	],

	showRecents: true,
	maxRecents: 8,
	storeRecents: true,
	recentsStore: [],

	showBookmarks: true,
	maxBookmarks: 8,

	replaceNewTabs: true,
	openOnStartup: false,
	focusSearchOnOpen: true,

	newNoteFolder: "",
	captureTarget: "daily",
	quickCaptureFile: "",
	captureHeading: "",
	quickCaptureFormat: "- {{time}} {{text}}",
};
