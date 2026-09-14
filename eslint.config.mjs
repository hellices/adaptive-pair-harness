import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Only generated output and build artifacts are ignored. Release-critical
  // host tests and scripts are linted with full type information.
  {
    ignores: [
      "**/dist/**",
      "coverage/**",
      "apps/vscode-extension/.host-test/**",
      "apps/vscode-extension/test/host/fixture/**",
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
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
);
