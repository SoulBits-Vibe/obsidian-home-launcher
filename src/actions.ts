import {
	App,
	Modal,
	Notice,
	TFile,
	TFolder,
	normalizePath,
	moment,
} from "obsidian";
import type { HomeAction, HomeSettings } from "./types";

/**
 * Obsidian re-exports moment as `typeof Moment`, a namespace type, which loses
 * its call signature under strict type checking — every `moment()` call then
 * resolves to `any` and silently defeats the unsafe-call/member-access rules.
 *
 * Narrowing it here restores type safety at the call sites without bundling a
 * second copy of moment into the plugin.
 */
interface MomentLike {
	format(template?: string): string;
}
const now = (): MomentLike => (moment as unknown as () => MomentLike)();

/**
 * Executes an action described by settings data. Every button on the page runs
 * through here, so adding a new button is a settings change, not a code change.
 */
export class ActionRunner {
	constructor(
		private app: App,
		private settings: HomeSettings,
	) {}

	async run(action: HomeAction): Promise<void> {
		try {
			switch (action.kind) {
				case "new-note":
					await this.newNote();
					break;
				case "quick-capture":
					this.quickCapture();
					break;
				case "command":
					this.runCommand(action.target);
					break;
				case "file":
					await this.openFile(action.target);
					break;
				case "folder":
					this.revealFolder(action.target);
					break;
				case "search":
					this.runSearch(action.target);
					break;
				case "url":
					this.openUrl(action.target);
					break;
			}
		} catch (err) {
			console.error(`Home Launcher: action "${action.label}" failed`, err);
			new Notice(`Could not run "${action.label}" — see console.`);
		}
	}

	// ── Individual action kinds ───────────────────────────────────────────

	/**
	 * Creates and opens a new note. Unlike the injected-button approach this
	 * talks to the file manager directly instead of guessing at command ids.
	 */
	async newNote(): Promise<TFile> {
		const folderPath = this.settings.newNoteFolder.trim();
		let parent: TFolder | null = null;

		if (folderPath) {
			const existing = this.app.vault.getAbstractFileByPath(normalizePath(folderPath));
			if (existing instanceof TFolder) {
				parent = existing;
			} else {
				parent = await this.app.vault.createFolder(normalizePath(folderPath));
			}
		} else {
			parent = this.app.fileManager.getNewFileParent("");
		}

		const file = await this.app.vault.create(this.untitledPath(parent), "");
		await this.app.workspace.getLeaf(false).openFile(file);
		return file;
	}

	/**
	 * Next free "Untitled" name in a folder, matching Obsidian's own numbering.
	 * Built on the public Vault API rather than the undocumented
	 * FileManager.createNewMarkdownFile, which could change without notice.
	 */
	private untitledPath(folder: TFolder | null): string {
		const dir = folder && folder.path !== "/" ? `${folder.path}/` : "";

		let candidate = `${dir}Untitled.md`;
		let n = 0;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			n++;
			candidate = `${dir}Untitled ${n}.md`;
		}
		return candidate;
	}

	quickCapture(): void {
		new QuickCaptureModal(this.app, this.captureTargetPath(), async (text) => {
			const line = this.settings.quickCaptureFormat
				.replace(/\{\{text\}\}/g, text)
				.replace(/\{\{time\}\}/g, now().format("HH:mm"))
				.replace(/\{\{date\}\}/g, now().format("YYYY-MM-DD"));

			const file = await this.resolveCaptureFile();
			await this.appendLine(file, line, this.settings.captureHeading.trim());
			new Notice(`Captured to ${file.basename}`);
		}).open();
	}

	/** The path capture will write to, for display before anything is created. */
	captureTargetPath(): string {
		return this.settings.captureTarget === "daily"
			? this.dailyNotePath()
			: normalizePath(this.settings.quickCaptureFile.trim() || "Capture.md");
	}

	/** Today's daily note path, following the core Daily Notes settings. */
	private dailyNotePath(): string {
		const options =
			this.app.internalPlugins.getPluginById("daily-notes")?.instance?.options ?? {};
		const format = options.format?.trim() || "YYYY-MM-DD";
		const folder = options.folder?.trim() ?? "";
		const name = `${now().format(format)}.md`;
		return normalizePath(folder ? `${folder}/${name}` : name);
	}

	/** Finds today's note (or the configured file), creating it if missing. */
	private async resolveCaptureFile(): Promise<TFile> {
		const path = this.captureTargetPath();
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;

		await this.ensureParentFolder(path);

		// Seed a new daily note from the configured template, as Daily Notes does.
		let initial = "";
		if (this.settings.captureTarget === "daily") {
			const templatePath =
				this.app.internalPlugins.getPluginById("daily-notes")?.instance?.options?.template;
			if (templatePath) {
				const template = this.app.vault.getAbstractFileByPath(
					normalizePath(templatePath.endsWith(".md") ? templatePath : `${templatePath}.md`),
				);
				if (template instanceof TFile) {
					initial = await this.app.vault.read(template);
				}
			}
		}

		return this.app.vault.create(path, initial);
	}

	/**
	 * Appends a line, optionally at the end of a named section so repeat captures
	 * stay in order under that heading rather than stacking above each other.
	 */
	private async appendLine(file: TFile, line: string, heading: string): Promise<void> {
		// Vault.process reads and writes atomically, so a capture can't clobber an
		// edit made between a separate read and write.
		await this.app.vault.process(file, (content) => {
			const gap = content.length && !content.endsWith("\n") ? "\n" : "";

			if (!heading) return `${content}${gap}${line}\n`;

			const lines = content.split("\n");
			const wanted = heading.replace(/^#+\s*/, "").toLowerCase();

			let start = -1;
			let level = 0;
			for (let i = 0; i < lines.length; i++) {
				const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
				if (m && m[2].trim().toLowerCase() === wanted) {
					start = i;
					level = m[1].length;
					break;
				}
			}

			// No such heading yet — add it at the end, then the line under it.
			if (start < 0) return `${content}${gap}\n## ${heading}\n${line}\n`;

			// Walk to the end of that section: next heading of the same or higher level.
			let end = lines.length;
			for (let i = start + 1; i < lines.length; i++) {
				const m = /^(#{1,6})\s+/.exec(lines[i]);
				if (m && m[1].length <= level) {
					end = i;
					break;
				}
			}

			// Step back over trailing blank lines so the entry sits with its section.
			while (end > start + 1 && lines[end - 1].trim() === "") end--;

			lines.splice(end, 0, line);
			return lines.join("\n");
		});
	}

	private runCommand(commandId: string): void {
		if (!commandId) {
			new Notice("This button has no command assigned yet.");
			return;
		}
		const ok = this.app.commands.executeCommandById(commandId);
		if (!ok) new Notice(`Command not found: ${commandId}`);
	}

	private async openFile(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) {
			new Notice(`File not found: ${path}`);
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	private revealFolder(path: string): void {
		const folder = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(folder instanceof TFolder)) {
			new Notice(`Folder not found: ${path}`);
			return;
		}
		// Obsidian has no "open folder" concept — reveal it in the file explorer.
		const explorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
		if (!explorer) {
			new Notice("File explorer is not open.");
			return;
		}
		void this.app.workspace.revealLeaf(explorer);
		this.app.workspace.trigger("reveal-folder", folder);
	}

	private runSearch(query: string): void {
		// Called as a method rather than extracted to a variable, so `this` stays
		// bound to the search plugin instance.
		const search = this.app.internalPlugins.getPluginById("global-search")?.instance;
		if (!search?.openGlobalSearch) {
			new Notice("The core search plugin is disabled.");
			return;
		}
		search.openGlobalSearch(query);
	}

	private openUrl(url: string): void {
		if (!/^https?:\/\//i.test(url)) {
			new Notice("Only HTTP and HTTPS links are allowed.");
			return;
		}
		window.open(url, "_blank");
	}

	private async ensureParentFolder(path: string): Promise<void> {
		const parts = path.split("/");
		parts.pop();
		if (!parts.length) return;
		const dir = parts.join("/");
		if (!this.app.vault.getAbstractFileByPath(dir)) {
			await this.app.vault.createFolder(dir);
		}
	}
}

class QuickCaptureModal extends Modal {
	private value = "";

	constructor(
		app: App,
		private targetPath: string,
		private onSubmit: (text: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText("Quick capture");

		const input = contentEl.createEl("textarea", {
			cls: "home-launcher-capture-input",
			attr: { rows: "4", placeholder: "What's on your mind?" },
		});
		input.focus();
		input.addEventListener("input", () => (this.value = input.value));

		// Enter submits, Shift+Enter adds a newline.
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" && !evt.shiftKey) {
				evt.preventDefault();
				void this.submit();
			}
		});

		const footer = contentEl.createDiv({ cls: "home-launcher-capture-footer" });
		footer.createSpan({
			cls: "home-launcher-capture-target",
			text: `→ ${this.targetPath}`,
		});
		const save = footer.createEl("button", { cls: "mod-cta", text: "Capture" });
		save.addEventListener("click", () => void this.submit());
	}

	private async submit(): Promise<void> {
		const text = this.value.trim();
		if (!text) return;
		this.close();
		await this.onSubmit(text);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
