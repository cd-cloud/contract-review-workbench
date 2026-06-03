/**
 * Playwright configuration
 * Uses the already-downloaded Chromium executable.
 */

const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "on-first-retry",
    headless: true,
    // Use the already-downloaded Chromium (avoid headless-shell requirement)
    channel: "chromium",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
