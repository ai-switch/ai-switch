import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  // Runs only from the external tarball consumer via verify:tarball.
  testIgnore: "packaged-host.spec.ts",
  timeout: 25_000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  workers: 2,
  use: { headless: true },
  projects: [
    { name: "chromium", use: { browserName: "chromium", launchOptions: { channel: "chromium" } } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "node tests/browser/fixture-server.mjs",
    url: "http://127.0.0.1:43171/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  reporter: "list",
});
