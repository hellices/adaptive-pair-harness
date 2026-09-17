import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Only generated output and build artifacts are ignored.
  {
    ignores: [
      "**/dist/**",
      "coverage/**",
      "apps/vscode-extension/.host-test/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    // Node globals used by the build, host-test, and release scripts.
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true }],
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: [
      "eslint.config.mjs",
      "vitest.config.ts",
      "poc/session-target/vitest.config.mts",
      "apps/vscode-extension/test/host/fixture/**",
    ],
  },
  {
    files: ["**/test/**"],
    rules: {
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 200, skipBlankLines: true, skipComments: true, IIFEs: true }],
    },
  },
  {
    files: ["apps/vscode-extension/test/host/fixture/**"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
    },
  },
);
