import { App, TFile, prepareFuzzySearch, type SearchResult } from "obsidian";
import type { HomeSettings } from "./types";

/** Why a file matched — shown on the row so the result explains itself. */
export type MatchSource = "name" | "alias" | "heading" | "tag" | "path" | "content";

export interface HighlightedText {
	text: string;
	matches: [number, number][];
}

export interface FileMatch {
	/** Null for unresolved links — a note that is linked to but does not exist yet. */
	file: TFile | null;
	path: string;
	basename: string;
	extension: string;
	unresolved: boolean;
	score: number;
	source: MatchSource;
	/** Character ranges in `basename` that matched, for highlighting. */
	matches: [number, number][];
	/** The alias/tag text that matched, when `source` is one of those. */
	context?: string;

	// ── Filled in by the content pass ────────────────────────────────────
	/** Total term occurrences in the note body. */
	matchCount?: number;
	/** The note's H1, and the section heading the match sits under. */
	headings?: HighlightedText[];
	/** A snippet of note body around the match. */
	excerpt?: HighlightedText;
}

/** Files bigger than this are skipped by content search to keep typing responsive. */
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
/** Total bytes a single content pass will read before giving up. */
const CONTENT_BUDGET = 24 * 1024 * 1024;

export class VaultSearch {
	constructor(
		private app: App,
		private settings: HomeSettings,
	) {}

	/**
	 * Fast pass: filenames, paths, aliases, headings and tags. Everything here
	 * comes from the metadata cache, so it is synchronous and safe per keystroke.
	 */
	queryMetadata(input: string): FileMatch[] {
		const q = input.trim();
		if (!q) return [];

		const fuzzy = prepareFuzzySearch(q);
		const best = new Map<string, FileMatch>();

		const offer = (match: FileMatch) => {
			const existing = best.get(match.path);
			if (!existing || match.score > existing.score) best.set(match.path, match);
		};

		for (const file of this.app.vault.getFiles()) {
			if (this.settings.markdownOnly && file.extension !== "md") continue;

			const byName = fuzzy(file.basename);
			if (byName) {
				offer({
					...this.base(file),
					score: byName.score,
					source: "name",
					matches: clamp(byName, file.basename),
				});
			} else {
				const byPath = fuzzy(file.path);
				if (byPath) {
					offer({
						...this.base(file),
						score: byPath.score - 1,
						source: "path",
						matches: [],
					});
				}
			}

			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;

			for (const alias of toArray(cache.frontmatter?.aliases)) {
				const hit = fuzzy(alias);
				if (hit) {
					offer({
						...this.base(file),
						score: hit.score - 0.5,
						source: "alias",
						matches: [],
						context: alias,
					});
				}
			}

			for (const heading of cache.headings ?? []) {
				const hit = fuzzy(heading.heading);
				if (hit) {
					offer({
						...this.base(file),
						score: hit.score - 2,
						source: "heading",
						matches: [],
						context: heading.heading,
					});
				}
			}

			for (const tag of this.tagsOf(cache)) {
				const hit = fuzzy(tag);
				if (hit) {
					offer({
						...this.base(file),
						score: hit.score - 2.5,
						source: "tag",
						matches: [],
						context: tag,
					});
				}
			}
		}

		if (this.settings.showUnresolvedLinks) {
			for (const name of this.unresolvedLinkNames()) {
				const hit = fuzzy(name);
				if (!hit) continue;
				offer({
					file: null,
					path: name,
					basename: name,
					extension: "md",
					unresolved: true,
					score: hit.score - 3,
					source: "name",
					matches: clamp(hit, name),
				});
			}
		}

		return [...best.values()]
			.sort((a, b) => b.score - a.score)
			.slice(0, this.settings.maxResults);
	}

	/**
	 * Adds match counts, headings and excerpts to rows that already matched on
	 * metadata, so a filename hit still shows where the term appears in the body.
	 */
	async enrich(
		input: string,
		matches: FileMatch[],
		signal: { aborted: boolean },
		onUpdate: () => void,
	): Promise<void> {
		const terms = splitTerms(input);
		if (!terms.length) return;

		for (const match of matches) {
			if (signal.aborted) return;
			if (!match.file || match.file.stat.size > MAX_CONTENT_BYTES) continue;

			const detail = await this.readDetail(match.file, terms);
			if (signal.aborted) return;
			if (!detail) continue;

			Object.assign(match, detail);
			onUpdate();
			await sleep(0);
		}
	}

	/**
	 * Slow pass: finds notes whose *body* matches but whose metadata did not.
	 * Bails out as soon as `signal` is aborted, so a fast typist never waits on
	 * a stale query.
	 */
	async queryContent(
		input: string,
		exclude: Set<string>,
		limit: number,
		signal: { aborted: boolean },
		onMatch: (match: FileMatch) => void,
	): Promise<void> {
		const terms = splitTerms(input);
		if (!terms.length || limit <= 0) return;

		// Most-recently-modified first: the note you want is usually a recent one.
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => !exclude.has(f.path) && f.stat.size <= MAX_CONTENT_BYTES)
			.sort((a, b) => b.stat.mtime - a.stat.mtime);

		let found = 0;
		let bytes = 0;

		for (const file of files) {
			if (signal.aborted || found >= limit || bytes > CONTENT_BUDGET) return;

			bytes += file.stat.size;
			const detail = await this.readDetail(file, terms);
			if (signal.aborted) return;
			if (!detail) continue;

			found++;
			onMatch({
				...this.base(file),
				score: -10 - found, // always ranks below metadata hits
				source: "content",
				matches: [],
				...detail,
			});

			// Let the UI paint between files rather than blocking the frame.
			await sleep(0);
		}
	}

	// ── Content reading ───────────────────────────────────────────────────

	/**
	 * Reads a note and, if every term appears in the body, reports the match
	 * count, the surrounding headings and an excerpt.
	 */
	private async readDetail(
		file: TFile,
		terms: string[],
	): Promise<Pick<FileMatch, "matchCount" | "headings" | "excerpt"> | null> {
		const raw = await this.app.vault.cachedRead(file);

		// Frontmatter is properties, not prose — excerpting it just shows noise.
		const body = stripFrontmatter(raw);
		const offset = raw.length - body.length;
		const haystack = body.toLowerCase();

		const positions = terms.map((t) => haystack.indexOf(t));
		if (positions.some((p) => p < 0)) return null;

		let matchCount = 0;
		for (const term of terms) {
			let idx = haystack.indexOf(term);
			while (idx >= 0) {
				matchCount++;
				idx = haystack.indexOf(term, idx + term.length);
			}
		}

		const at = Math.min(...positions);
		return {
			matchCount,
			headings: this.headingsAround(file, at + offset, terms),
			excerpt: buildExcerpt(body, haystack, terms, at),
		};
	}

	/**
	 * The note's H1 plus the nearest heading above the match — the same "where
	 * am I in this document" context Omnisearch shows.
	 */
	private headingsAround(file: TFile, at: number, terms: string[]): HighlightedText[] {
		const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
		if (!headings.length) return [];

		const title = headings.find((h) => h.level === 1);

		// Last heading that starts before the match.
		let section: (typeof headings)[number] | undefined;
		for (const h of headings) {
			if (h.position.start.offset > at) break;
			section = h;
		}

		const out: HighlightedText[] = [];
		const add = (h?: (typeof headings)[number]) => {
			if (!h) return;
			const label = `${"#".repeat(h.level)} ${h.heading}`;
			if (out.some((existing) => existing.text === label)) return;
			out.push({ text: label, matches: findTerms(label, terms) });
		};

		add(title);
		if (section !== title) add(section);
		return out;
	}

	// ── Helpers ───────────────────────────────────────────────────────────

	private base(file: TFile) {
		return {
			file,
			path: file.path,
			basename: file.basename,
			extension: file.extension,
			unresolved: false,
		};
	}

	private tagsOf(cache: {
		tags?: { tag: string }[];
		frontmatter?: Record<string, unknown>;
	}): string[] {
		const tags = new Set<string>();
		for (const t of cache.tags ?? []) tags.add(t.tag.replace(/^#/, ""));
		for (const t of toArray(cache.frontmatter?.tags)) tags.add(t.replace(/^#/, ""));
		return [...tags];
	}

	/** Distinct link targets that no file satisfies yet. */
	private unresolvedLinkNames(): string[] {
		const names = new Set<string>();
		const unresolved = this.app.metadataCache.unresolvedLinks;
		for (const source of Object.keys(unresolved)) {
			for (const target of Object.keys(unresolved[source])) names.add(target);
		}
		return [...names];
	}
}

// ── Free functions ────────────────────────────────────────────────────────

function splitTerms(input: string): string[] {
	return input
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter((t) => t.length >= 2);
}

function toArray(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
	return [];
}

function clamp(hit: SearchResult, text: string): [number, number][] {
	return hit.matches
		.map(([start, end]) => [start, Math.min(end, text.length)] as [number, number])
		.filter(([start, end]) => start >= 0 && end > start);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Every occurrence of every term within `text`, for highlighting. */
function findTerms(text: string, terms: string[]): [number, number][] {
	const lower = text.toLowerCase();
	const out: [number, number][] = [];
	for (const term of terms) {
		let idx = lower.indexOf(term);
		while (idx >= 0) {
			out.push([idx, idx + term.length]);
			idx = lower.indexOf(term, idx + term.length);
		}
	}
	return out;
}

/** Drops a leading YAML frontmatter block so content search sees only the body. */
function stripFrontmatter(text: string): string {
	if (!text.startsWith("---")) return text;

	// Find the closing fence: a line containing only "---".
	const close = text.indexOf("\n---", 3);
	if (close < 0) return text;

	const lineEnd = text.indexOf("\n", close + 1);
	return lineEnd < 0 ? "" : text.slice(lineEnd + 1);
}

/**
 * The run of prose lines containing `at`, stopping at blank lines and headings
 * so an excerpt never runs across a section boundary or swallows "## " markup.
 */
function blockBounds(text: string, at: number): [number, number] {
	const isBoundary = (from: number, to: number) => {
		const line = text.slice(from, to).trim();
		return line === "" || line.startsWith("#");
	};

	let start = text.lastIndexOf("\n", at) + 1;
	let end = text.indexOf("\n", at);
	if (end < 0) end = text.length;

	while (start > 0) {
		const prevEnd = start - 1;
		const prevStart = text.lastIndexOf("\n", prevEnd - 1) + 1;
		if (prevStart >= prevEnd || isBoundary(prevStart, prevEnd)) break;
		start = prevStart;
	}

	while (end < text.length) {
		const nextStart = end + 1;
		let nextEnd = text.indexOf("\n", nextStart);
		if (nextEnd < 0) nextEnd = text.length;
		if (nextStart >= nextEnd || isBoundary(nextStart, nextEnd)) break;
		end = nextEnd;
	}

	return [start, end];
}

/** Pulls ~160 characters of context around the first match, on word boundaries. */
function buildExcerpt(
	text: string,
	haystack: string,
	terms: string[],
	at: number,
): HighlightedText {
	const radius = 80;
	const [blockStart, blockEnd] = blockBounds(text, at);

	let start = Math.max(blockStart, at - radius);
	let end = Math.min(blockEnd, at + radius);

	// Snap outward to whitespace so words are not sliced in half.
	while (start > blockStart && !/\s/.test(text[start - 1])) start--;
	while (end < blockEnd && !/\s/.test(text[end])) end++;

	const raw = text.slice(start, end).replace(/\s+/g, " ").trim();
	const prefix = start > blockStart ? "…" : "";
	const suffix = end < blockEnd ? "…" : "";
	const excerpt = `${prefix}${raw}${suffix}`;

	return { text: excerpt, matches: findTerms(excerpt, terms) };
}

/** Render `text` into `el`, wrapping matched ranges so they can be styled. */
export function renderHighlighted(
	el: HTMLElement,
	text: string,
	matches: [number, number][],
): void {
	if (!matches.length) {
		el.setText(text);
		return;
	}

	const ordered = [...matches].sort((a, b) => a[0] - b[0]);
	let cursor = 0;

	for (const [start, end] of ordered) {
		if (start < cursor) continue; // skip overlaps
		if (start > cursor) el.appendText(text.slice(cursor, start));
		el.createSpan({ cls: "home-launcher-highlight", text: text.slice(start, end) });
		cursor = end;
	}

	if (cursor < text.length) el.appendText(text.slice(cursor));
}
