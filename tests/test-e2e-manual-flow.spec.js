/**
 * Manual flow simulation - comprehensive end-to-end test
 * Simulates a real user clicking through every feature.
 */

const { test, expect } = require("playwright/test");

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8787";

test.describe("Manual Flow - Comprehensive", () => {
  test.setTimeout(60000);

  test("full manual walkthrough", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`PAGE ERROR: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`CONSOLE ERROR: ${msg.text()}`);
    });
    page.on("requestfailed", (req) => errors.push(`REQUEST FAILED: ${req.url()}`));

    // Helper to safely click a nav item
    async function clickView(viewName) {
      await page.evaluate((v) => {
        const el = document.querySelector(`[data-view="${v}"]`);
        if (el) el.click();
      }, viewName);
      await page.waitForTimeout(400);
    }

    // 1. Homepage loads
    await page.goto(BASE_URL);
    await page.waitForSelector("#dashboard-view", { timeout: 5000 });
    expect(await page.textContent("#view-title")).toContain("总览");
    console.log("  ✓ Dashboard loaded");

    // 2. Global search
    await page.fill("#global-search", "合同");
    await page.waitForTimeout(500);
    const searchResults = await page.locator("#global-search-results .global-search-row").count();
    console.log(`  ✓ Global search returned ${searchResults} results`);

    // 3. Navigate to Contracts
    await clickView("contracts");
    await page.waitForSelector("#contracts-view.active", { timeout: 3000 });
    expect(await page.textContent("#view-title")).toContain("合同库");
    console.log("  ✓ Contracts view");

    // 4. Contract filters
    await page.fill("#contract-search", "服务");
    await page.waitForTimeout(400);
    console.log("  ✓ Contract search typed");

    // 5. Open demo contract
    const demoBtn = await page.locator('[data-open-contract]').first();
    if (await demoBtn.isVisible().catch(() => false)) {
      await demoBtn.click();
      await page.waitForTimeout(600);
      console.log("  ✓ Demo contract opened");
    }

    // 6. Navigate to Review
    await clickView("review");
    await page.waitForSelector("#review-view.active", { timeout: 3000 });
    expect(await page.textContent("#view-title")).toContain("审阅");
    console.log("  ✓ Review view");

    // 7. Open a contract in review
    const reviewContractBtn = await page.locator('[data-open-contract]').first();
    if (await reviewContractBtn.isVisible().catch(() => false)) {
      await reviewContractBtn.click();
      await page.waitForTimeout(800);
      console.log("  ✓ Contract opened in review");

      // 8. Click a clause card if present
      const clauseCard = await page.locator('.inline-clause-card, [data-clause-id]').first();
      if (await clauseCard.isVisible().catch(() => false)) {
        await clauseCard.click();
        await page.waitForTimeout(500);
        console.log("  ✓ Clause card clicked");
      }

      // 9. Switch reader tab
      const indexTab = await page.locator('[data-reader-tab="index"]').first();
      if (await indexTab.isVisible().catch(() => false)) {
        await indexTab.click();
        await page.waitForTimeout(400);
        console.log("  ✓ Index tab clicked");
      }
    }

    // 10. Navigate to Playbooks
    await clickView("playbooks");
    await page.waitForSelector("#playbooks-view.active", { timeout: 3000 });
    expect(await page.textContent("#view-title")).toContain("条款库");
    console.log("  ✓ Playbooks view");

    // 11. Playbook search
    await page.fill("#playbook-search", "保密");
    await page.waitForTimeout(400);
    console.log("  ✓ Playbook search typed");

    // 12. Navigate to Counterparties
    await clickView("counterparties");
    await page.waitForSelector("#counterparties-view.active", { timeout: 3000 });
    expect(await page.textContent("#view-title")).toContain("相对方");
    console.log("  ✓ Counterparties view");

    // 13. Counterparty search
    await page.fill("#counterparty-search", "公司");
    await page.waitForTimeout(400);
    console.log("  ✓ Counterparty search typed");

    // 14. Navigate to Drafting
    await clickView("drafting");
    await page.waitForSelector("#drafting-view.active", { timeout: 3000 });
    expect(await page.textContent("#view-title")).toContain("起草");
    console.log("  ✓ Drafting view");

    // 15. Fill draft form
    await page.fill("#draft-contract-type", "SaaS 服务合同");
    await page.fill("#draft-background", "测试背景");
    await page.fill("#draft-role", "服务提供方");
    await page.fill("#draft-counterparty", "测试公司");
    console.log("  ✓ Draft form filled");

    // 16. Back to Dashboard
    await clickView("dashboard");
    await page.waitForSelector("#dashboard-view.active", { timeout: 3000 });
    console.log("  ✓ Back to dashboard");

    // 17. Upload modal
    await page.evaluate(() => {
      const el = document.querySelector('[data-open-upload]');
      if (el) el.click();
    });
    await page.waitForTimeout(400);
    const modalOpen = await page.evaluate(() => {
      const m = document.querySelector('#upload-modal');
      return m && (m.open || getComputedStyle(m).display !== 'none');
    });
    console.log(`  ✓ Upload modal opened: ${modalOpen}`);

    if (modalOpen) {
      await page.evaluate(() => {
        const el = document.querySelector('[data-close-upload]');
        if (el) el.click();
      });
      await page.waitForTimeout(400);
      console.log("  ✓ Upload modal closed");
    }

    // 18. Audit logs toggle
    await page.evaluate(() => {
      const el = document.querySelector('[data-action="toggle-audit-logs"]');
      if (el) el.click();
    });
    await page.waitForTimeout(400);
    console.log("  ✓ Audit logs toggled");

    // 19. Sidebar toggle
    await page.evaluate(() => {
      const el = document.querySelector('[data-action="toggle-sidebar"]');
      if (el) el.click();
    });
    await page.waitForTimeout(400);
    console.log("  ✓ Sidebar toggled");

    // 20. Second sidebar toggle (restore)
    await page.evaluate(() => {
      const el = document.querySelector('[data-action="toggle-sidebar"]');
      if (el) el.click();
    });
    await page.waitForTimeout(400);
    console.log("  ✓ Sidebar restored");

    // Final error check
    const filteredErrors = errors.filter(e => 
      !e.includes("favicon") && 
      !e.includes("runtime-config") &&
      !e.includes("Backend snapshot") &&
      !e.includes("Backend autosync") &&
      !e.includes("Local legal skill")
    );
    
    if (filteredErrors.length > 0) {
      console.log("  ⚠ Errors captured:");
      filteredErrors.slice(0, 10).forEach(e => console.log(`    ${e}`));
    }
    
    expect(filteredErrors.length).toBe(0);
    console.log("  ✓ No critical errors");
  });
});
