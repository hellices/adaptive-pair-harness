import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts", "scripts/test/**/*.test.ts",
      "poc/native-session-continuity/test/**/*.test.mts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      exclude: ["**/test/**", "**/dist/**"],
    },
  },
});
