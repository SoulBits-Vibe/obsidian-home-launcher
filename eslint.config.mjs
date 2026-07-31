import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Type-aware linting, matching the rules the Obsidian plugin reviewer runs.
 * The `no-unsafe-*` and floating-promise rules only work with type information,
 * which is why projectService is enabled rather than using the basic preset.
 */
export default tseslint.config(
	{
		ignores: ["main.js", "node_modules/**", "esbuild.config.mjs", "eslint.config.mjs"],
	},
	js.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// Obsidian's API uses optional members heavily; these two fire on
			// guards that are genuinely necessary against untyped internals.
			"@typescript-eslint/no-unnecessary-condition": "off",
			"@typescript-eslint/restrict-template-expressions": [
				"error",
				{ allowNumber: true },
			],
		},
	},
);
