import "obsidian";

/**
 * Minimal typings for the internal APIs this plugin touches. These are not part
 * of Obsidian's public API and may change between releases — every call site
 * guards for absence.
 */
declare module "obsidian" {
	interface BookmarkItem {
		type: "file" | "folder" | "search" | "graph" | "group";
		title?: string;
		path?: string;
		query?: string;
		subpath?: string;
		items?: BookmarkItem[];
	}

	interface App {
		commands: {
			executeCommandById(id: string): boolean;
			listCommands(): { id: string; name: string }[];
			commands: Record<string, { id: string; name: string }>;
		};
		internalPlugins: {
			getPluginById(id: string): {
				enabled: boolean;
				instance?: {
					openGlobalSearch?(query: string): void;
					getBookmarks?(): BookmarkItem[];
					/** Core Daily Notes settings. */
					options?: {
						folder?: string;
						format?: string;
						template?: string;
					};
					[key: string]: unknown;
				};
			} | null;
		};
	}

}
