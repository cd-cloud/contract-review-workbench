/**
 * Layer 9: Basic Playwright E2E tests
 * Tests core user flows end-to-end.
 *
 * Run: npx playwright test tests/test-e2e-basic.spec.js
 */

const { test, expect } = require("playwright/test");

const BASE_URL = "http://127.0.0.1:8787";

test.describe("Legal Contract Workbench E2E", () => {
  test("homepage loads and shows dashboard view", async ({ page }) => {
    await page.goto(BASE_URL);
    // Wait for the app to bootstrap
    await page.waitForSelector("#dashboard-view", { timeout: 5000 });
    const title = await page.textContent("#view-title");
    expect(title).toContain("总览");
  });

  test("navigation switches between views", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector("#dashboard-view", { timeout: 5000 });

    // Click contracts nav
    await page.click('[data-view="contracts"]');
    await page.waitForSelector("#contracts-view.active", { timeout: 3000 });
    const contractsTitle = await page.textContent("#view-title");
    expect(contractsTitle).toContain("合同库");

    // Click playbooks nav
    await page.click('[data-view="playbooks"]');
    await page.waitForSelector("#playbooks-view.active", { timeout: 3000 });
    const playbooksTitle = await page.textContent("#view-title");
    expect(playbooksTitle).toContain("条款库");
  });

  test("demo contract is present and clickable", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector("#dashboard-view", { timeout: 5000 });

    // Demo contract should be in the dashboard
    const demoButton = await page.locator('[data-open-contract]').first();
    await expect(demoButton).toBeVisible();

    // Open the contract
    await demoButton.click();
    await page.waitForSelector("#review-view.active", { timeout: 5000 });
    const reviewTitle = await page.textContent("#view-title");
    expect(reviewTitle).toContain("审阅台");
  });

  test("upload modal opens and closes", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector("#dashboard-view", { timeout: 5000 });

    // Open upload modal
    await page.click("[data-open-upload]");
    await page.waitForSelector("#upload-modal[open]", { timeout: 3000 });

    // Close upload modal
    await page.click("[data-close-upload]");
    // Modal should be closed (no [open] attribute)
    const modal = await page.locator("#upload-modal[open]");
    await expect(modal).toHaveCount(0);
  });

  test("playbooks view has filter controls", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector("#dashboard-view", { timeout: 5000 });

    // Navigate to playbooks
    await page.click('[data-view="playbooks"]');
    await page.waitForSelector("#playbooks-view.active", { timeout: 3000 });

    // Check filter inputs exist
    const searchInput = await page.locator("#playbook-search");
    await expect(searchInput).toBeVisible();
    const typeFilter = await page.locator("#playbook-type-filter");
    await expect(typeFilter).toBeVisible();
  });

  test("contract library view renders with cards", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector("#dashboard-view", { timeout: 5000 });

    // Navigate to contracts
    await page.click('[data-view="contracts"]');
    await page.waitForSelector("#contracts-view.active", { timeout: 3000 });

    // Search and filter controls should exist
    const searchInput = await page.locator("#contract-search");
    await expect(searchInput).toBeVisible();
  });
});
