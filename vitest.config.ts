import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // The macOS Intel runner is an x86_64 image and runs the jsdom suites
    // roughly 2-3x slower than Linux, Windows and the Apple Silicon image.
    // The slowest AccountsScreen cases take ~2.2s locally, which left too
    // little headroom under the 5s default and timed out only on that runner.
    testTimeout: 15000,
    exclude: [
      ...configDefaults.exclude,
      "packages/**",
      "examples/**",
      // Standalone fixture packages own their Node test runner; Vitest must
      // not collect node:test files from them as root test suites.
      "fixtures/**",
      "**/.codex-run/**",
      "**/.worktrees/**",
      // Agent worktrees live here and hold a full checkout, so without this
      // vitest collects a second copy of every suite plus the `.test.mjs`
      // scripts the pattern below only excludes at the repo root.
      "**/.claude/**",
      "scripts/**/*.test.mjs",
    ],
    setupFiles: ["src/test/setup.ts"],
    globals: true,
  },
});
