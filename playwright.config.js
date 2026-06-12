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
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8787",
    trace: "on-first-retry",
    headless: true,
    // Playwright will use its bundled Chromium by default.
    // Override with PLAYWRIGHT_EXECUTABLE_PATH if you prefer a system browser.
  },
  webServer: {
    command: "node scripts/start-ai-server.js --profile basic",
    url: "http://127.0.0.1:8787",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      LEGAL_WORKBENCH_PORT: "8787",
      NODE_ENV: "test",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
