/**
 * Performance benchmarks for critical frontend paths.
 * Run: npx playwright test tests/perf-benchmark.spec.js --reporter=list
 */

const { test, expect } = require("playwright/test");

const BASE_URL = "http://127.0.0.1:8787";

/**
 * Helper to measure async function execution time inside the browser.
 */
async function measure(page, fnBody, args = []) {
  return page.evaluate(
    ({ body, args }) => {
      const fn = new Function("return " + body)();
      const start = performance.now();
      const result = fn(...args);
      // Handle both sync and promise results
      if (result && typeof result.then === "function") {
        return result.then((r) => ({ result: r, duration: performance.now() - start }));
      }
      return { result, duration: performance.now() - start };
    },
    { body: fnBody, args }
  );
}

test.describe("Performance Benchmarks", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector("#dashboard-view", { timeout: 5000 });
  });

  test("page load time < 1s", async ({ page }) => {
    const navigationTiming = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      return nav ? nav.loadEventEnd - nav.startTime : null;
    });
    expect(navigationTiming).not.toBeNull();
    expect(navigationTiming).toBeLessThan(1000);
    console.log(`  Page load: ${navigationTiming.toFixed(1)}ms`);
  });

  test("dashboard render time < 200ms", async ({ page }) => {
    const timing = await measure(page, String(() => {
      const start = performance.now();
      window.renderDashboard && window.renderDashboard();
      return performance.now() - start;
    }));
    console.log(`  Dashboard render: ${timing.result.toFixed(1)}ms`);
    expect(timing.result).toBeLessThan(200);
  });

  test("view switching: dashboard → contracts < 100ms", async ({ page }) => {
    const timing = await measure(page, String(() => {
      const start = performance.now();
      window.setView("contracts");
      return performance.now() - start;
    }));
    console.log(`  View switch (dashboard→contracts): ${timing.result.toFixed(1)}ms`);
    expect(timing.result).toBeLessThan(100);
  });

  test("view switching: contracts → review < 100ms", async ({ page }) => {
    await page.evaluate(() => window.setView("contracts"));
    const timing = await measure(page, String(() => {
      const start = performance.now();
      window.setView("review");
      return performance.now() - start;
    }));
    console.log(`  View switch (contracts→review): ${timing.result.toFixed(1)}ms`);
    expect(timing.result).toBeLessThan(100);
  });

  test("diff engine: small text (< 500 chars) < 50ms", async ({ page }) => {
    const oldText = "甲方同意向乙方提供技术服务，乙方同意支付相应费用。双方本着平等互利的原则签订本合同。";
    const newText = "甲方同意向乙方提供技术服务及咨询服务，乙方同意按照约定支付相应费用。双方本着平等互利、诚实信用的原则签订本协议。";
    const { duration } = await measure(
      page,
      String((a, b) => window.buildInlineDiffHtml(a, b)),
      [oldText, newText]
    );
    console.log(`  Diff engine (small): ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(50);
  });

  test("diff engine: medium text (~2000 chars) < 200ms", async ({ page }) => {
    const oldText = "本合同由甲方（以下简称甲方）与乙方（以下简称乙方）于2024年1月1日签订。".repeat(50);
    const newText = "本协议由甲方（以下简称甲方）与乙方（以下简称乙方）于2024年6月1日签署。".repeat(50);
    const { duration } = await measure(
      page,
      String((a, b) => window.buildInlineDiffHtml(a, b)),
      [oldText, newText]
    );
    console.log(`  Diff engine (medium): ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(200);
  });

  test("clause split: small contract (< 2KB) < 100ms", async ({ page }) => {
    const text = `
第一条 合同目的
甲方委托乙方开发软件系统。

第二条 交付时间
乙方应于2024年12月31日前完成交付。

第三条 付款方式
甲方分三期支付，每期人民币十万元。
    `.trim();
    const { duration } = await measure(
      page,
      String((t) => window.splitVersionClauses(t, "perf-test-1")),
      [text]
    );
    console.log(`  Clause split (small): ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(100);
  });

  test("clause split: medium contract (~10KB) < 300ms", async ({ page }) => {
    const clauses = Array.from({ length: 20 }, (_, i) => `
第${i + 1}条 条款标题
本条详细规定了双方在合作过程中的权利义务，包括但不限于信息保密、知识产权归属、违约责任等方面的内容。双方应严格遵守本条约定，任何一方违反本条规定的，应承担相应的法律责任。
    `.trim()).join("\n\n");
    const { duration } = await measure(
      page,
      String((t) => window.splitVersionClauses(t, "perf-test-2")),
      [clauses]
    );
    console.log(`  Clause split (medium): ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(300);
  });

  test("clause split LRU cache hit < 5ms", async ({ page }) => {
    const text = "第一条 目的\n本合同旨在规范双方合作。\n\n第二条 范围\n合作范围包括技术开发。";
    // First call warms cache
    await page.evaluate((t) => window.splitVersionClauses(t, "perf-cache-test"), text);
    // Second call should hit cache
    const { duration } = await measure(
      page,
      String((t) => window.splitVersionClauses(t, "perf-cache-test")),
      [text]
    );
    console.log(`  Clause split cache hit: ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(5);
  });

  test("infer review fields: small text < 50ms", async ({ page }) => {
    const text = "技术服务合同\n甲方：科技有限公司\n乙方：咨询服务公司\n本合同由甲方委托乙方提供技术咨询服务。";
    const { duration } = await measure(
      page,
      String((t) => window.inferNewReviewFields(t)),
      [text]
    );
    console.log(`  Infer fields (small): ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(50);
  });

  test("rapid view switching (50x) total < 500ms", async ({ page }) => {
    const views = ["dashboard", "contracts", "review", "playbooks", "counterparties"];
    const { duration } = await measure(
      page,
      String((views) => {
        const start = performance.now();
        for (let i = 0; i < 50; i++) {
          window.setView(views[i % views.length]);
        }
        return performance.now() - start;
      }),
      [views]
    );
    console.log(`  Rapid view switch (50x): ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(500);
  });
});
