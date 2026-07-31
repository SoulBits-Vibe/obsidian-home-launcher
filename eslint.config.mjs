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
		// PluginSettingTab.display() is deprecated in favour of the declarative
		// getSettingDefinitions() API, which is @since 1.13.0. Adopting it would
		// force minAppVersion up to 1.13.0 and drop every user on an older build,
		// so this stays on display() deliberately.
		//
		// Revisit once 1.13 is widely adopted: raise minAppVersion, port
		// settings.ts to getSettingDefinitions (SettingDefinitionList suits the
		// button editor), then delete this override.
		files: ["src/settings.ts"],
		rules: {
			"@typescript-eslint/no-deprecated": "off",
		},
	},
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
