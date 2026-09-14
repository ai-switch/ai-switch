import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  timeout: 25_000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  workers: 2,
  use: { headless: true, browserName: "chromium", launchOptions: { channel: "chromium" } },
  webServer: {
    command: "node tests/browser/fixture-server.mjs",
    url: "http://127.0.0.1:43171/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  reporter: "list",
});
