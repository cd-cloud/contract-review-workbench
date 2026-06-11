/**
 * E2E stress tests - manual flow simulation
 */

const { test, expect } = require("playwright/test");

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8787";

async function waitForBootstrap(page) {
  await page.waitForSelector("#dashboard-view", { timeout: 5000 });
}

async function clickByEvaluate(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.click();
  }, selector);
}

test.describe("Manual Flow Simulation", () => {
  test("full user journey: dashboard → contracts → review → playbooks → counterparties", async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForBootstrap(page);

    // 1. Dashboard check
    const dashboardTitle = await page.textContent("#view-title");
    expect(dashboardTitle).toContain("总览");
    const stats = await page.locator(".stats-grid");
    await expect(stats).toBeVisible();

    // 2. Navigate to contracts
    await clickByEvaluate(page, '[data-view="contracts"]');
    await page.waitForSelector("#contracts-view.active", { timeout: 3000 });
    expect(await page.textContent("#view-title")).toContain("合同库");

    // 3. Back to dashboard and open demo contract
    await clickByEvaluate(page, '[data-view="dashboard"]');
    await page.waitForSelector("#dashboard-view.active", { timeout: 3000 });
    await clickByEvaluate(page, '[data-active-contract-open]');
    await page.waitForSelector("#review-view.active", { timeout: 5000 });
    expect(await page.textContent("#view-title")).toContain("审阅台");

    // 4. Check clause tree or workbench exists
    const hasClauses = await page.evaluate(() =>
      document.querySelectorAll("[data-clause-card], [data-workbench-clause]").length > 0
    );
    expect(hasClauses).toBe(true);

    // 5. Navigate to playbooks
    await clickByEvaluate(page, '[data-view="playbooks"]');
    await page.waitForSelector("#playbooks-view.active", { timeout: 3000 });
    expect(await page.textContent("#view-title")).toContain("条款库");

    // 6. Navigate to counterparties
    await clickByEvaluate(page, '[data-view="counterparties"]');
    await page.waitForSelector("#counterparties-view.active", { timeout: 3000 });
    expect(await page.textContent("#view-title")).toContain("相对方");

    // 7. Back to dashboard
    await clickByEvaluate(page, '[data-view="dashboard"]');
    await page.waitForSelector("#dashboard-view.active", { timeout: 3000 });
    expect(await page.textContent("#view-title")).toContain("总览");
  });

  test("modal open/close stress test", async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForBootstrap(page);

    for (let i = 0; i < 20; i++) {
      await clickByEvaluate(page, "[data-open-upload]");
      await page.waitForSelector("#upload-modal[open]", { timeout: 2000 });
      await clickByEvaluate(page, "[data-close-upload]");
      await page.waitForTimeout(100);
    }
    const modal = await page.locator("#upload-modal[open]");
    await expect(modal).toHaveCount(0);
  });

  test("rapid view switching stress test", async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForBootstrap(page);

    const views = ["dashboard", "contracts", "playbooks", "counterparties", "drafting"];
    for (let i = 0; i < 50; i++) {
      const view = views[i % views.length];
      await clickByEvaluate(page, `[data-view="${view}"]`);
    }
    // Final state should be stable
    const activeView = await page.locator(".view.active").first();
    await expect(activeView).toBeVisible();
  });

  test("review view interactions: open contract, check clause cards", async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForBootstrap(page);

    // Open demo contract
    await clickByEvaluate(page, '[data-active-contract-open]');
    await page.waitForSelector("#review-view.active", { timeout: 5000 });

    // Check workbench has clause cards
    const hasWorkbenchClauses = await page.evaluate(() =>
      document.querySelectorAll("[data-workbench-clause]").length > 0
    );
    expect(hasWorkbenchClauses).toBe(true);

    // Click on a clause to focus it
    await page.evaluate(() => {
      const clause = document.querySelector('[data-workbench-clause]');
      if (clause) clause.click();
    });
    await page.waitForTimeout(200);

    // Check some review-related elements exist
    const hasReviewContent = await page.evaluate(() =>
      document.querySelectorAll(".inline-clause-card, .chapter-card, .review-advice-sidebar").length > 0
    );
    expect(hasReviewContent).toBe(true);
  });

  test("contract library filter interaction", async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForBootstrap(page);

    await clickByEvaluate(page, '[data-view="contracts"]');
    await page.waitForSelector("#contracts-view.active", { timeout: 3000 });

    // Type in search box
    const searchBox = await page.locator("#contract-search");
    await searchBox.fill("SaaS");
    await page.waitForTimeout(300);

    // Clear search
    await searchBox.fill("");
    await page.waitForTimeout(200);

    // Check filter select exists and has options
    const hasStatusFilter = await page.evaluate(() =>
      document.querySelector("#contract-status-filter") !== null
    );
    expect(hasStatusFilter).toBe(true);
  });

  test("playbook filter interaction", async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForBootstrap(page);

    await clickByEvaluate(page, '[data-view="playbooks"]');
    await page.waitForSelector("#playbooks-view.active", { timeout: 3000 });

    // Search playbook
    const searchBox = await page.locator("#playbook-search");
    await searchBox.fill("保密");
    await page.waitForTimeout(300);

    // Check filter select exists
    const hasTypeFilter = await page.evaluate(() =>
      document.querySelector("#playbook-type-filter") !== null
    );
    expect(hasTypeFilter).toBe(true);

    // All should not crash
    expect(await page.textContent("#view-title")).toContain("条款库");
  });
});
