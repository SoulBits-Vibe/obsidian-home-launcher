import type { QuoteRotation } from "./types";

export interface Quote {
	text: string;
	/** Optional attribution, taken from a trailing " — Author" or " -- Author". */
	source?: string;
}

/**
 * Reads a quote note into individual entries.
 *
 * Two shapes are accepted, so you can keep the file however you already write:
 *   - one entry per line (bullets, blockquotes and blank lines are tolerated)
 *   - multi-line entries separated by a `---` rule
 *
 * Headings and YAML frontmatter are ignored, so a quote file can still be a
 * normal note with a title at the top.
 */
export function parseQuotes(raw: string): Quote[] {
	const body = stripFrontmatter(raw).trim();
	if (!body) return [];

	const hasRules = /^---\s*$/m.test(body);
	const blocks = hasRules ? body.split(/^---\s*$/m) : body.split("\n");

	const quotes: Quote[] = [];
	for (const block of blocks) {
		const text = block
			.split("\n")
			.map((line) =>
				line
					.replace(/^\s*[-*+]\s+/, "") // list marker
					.replace(/^\s*>\s?/, "") // blockquote marker
					.trim(),
			)
			.filter((line) => line && !/^#{1,6}\s/.test(line))
			.join(" ")
			.trim();

		if (text) quotes.push(splitSource(text));
	}
	return quotes;
}

/**
 * Splits a trailing attribution. Only an em dash or a double hyphen counts —
 * a single hyphen appears mid-sentence far too often to be a safe delimiter.
 */
function splitSource(line: string): Quote {
	const idx = Math.max(line.lastIndexOf(" — "), line.lastIndexOf(" -- "));
	if (idx <= 0) return { text: line };

	const source = line
		.slice(idx)
		.replace(/^\s*(—|--)\s*/, "")
		.trim();

	return source ? { text: line.slice(0, idx).trim(), source } : { text: line };
}

/**
 * Chooses which quote to show. `offset` advances the selection so clicking can
 * step through the file without changing the mode.
 */
export function pickQuote(
	quotes: Quote[],
	rotation: QuoteRotation,
	offset = 0,
): Quote | null {
	if (!quotes.length) return null;

	if (rotation === "random") {
		return quotes[Math.floor(Math.random() * quotes.length)];
	}

	// Whole days since the epoch, in local time, so it turns over at midnight.
	const now = new Date();
	const days = Math.floor(
		new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86_400_000,
	);
	return quotes[(((days + offset) % quotes.length) + quotes.length) % quotes.length];
}

/** Drops a leading YAML frontmatter block. */
function stripFrontmatter(text: string): string {
	if (!text.startsWith("---")) return text;
	const close = text.indexOf("\n---", 3);
	if (close < 0) return text;
	const lineEnd = text.indexOf("\n", close + 1);
	return lineEnd < 0 ? "" : text.slice(lineEnd + 1);
}
