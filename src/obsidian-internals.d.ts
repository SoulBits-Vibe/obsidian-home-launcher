import "obsidian";

/**
 * Minimal typings for the internal APIs this plugin touches. These are not part
 * of Obsidian's public API and may change between releases — every call site
 * guards for absence.
 *
 * Everything here is typed precisely on purpose. An index signature such as
 * `[key: string]: unknown` makes member access resolve to `any`, which silently
 * defeats strict type checking at every call site that reads these objects.
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

	/** Core Daily Notes settings, used to resolve today's note. */
	interface DailyNotesOptions {
		folder?: string;
		format?: string;
		template?: string;
	}

	interface InternalPluginInstance {
		openGlobalSearch?(query: string): void;
		getBookmarks?(): BookmarkItem[];
		options?: DailyNotesOptions;
	}

	interface InternalPluginWrapper {
		enabled: boolean;
		instance?: InternalPluginInstance;
	}

	interface ObsidianCommand {
		id: string;
		name: string;
	}

	interface App {
		commands: {
			executeCommandById(id: string): boolean;
			listCommands(): ObsidianCommand[];
		};
		internalPlugins: {
			getPluginById(id: string): InternalPluginWrapper | null;
		};
	}
}
