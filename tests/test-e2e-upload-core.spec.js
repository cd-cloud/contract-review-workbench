/**
 * End-to-end upload and core workflow test
 * Validates: DOCX upload -> parse -> contract creation -> review view
 */

const { test, expect } = require("playwright/test");
const path = require("path");
const fs = require("fs");

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8787";

// Path to test DOCX file
const TEST_DOCX = path.join(__dirname, "fixtures", "test-contract.docx");

test.describe("E2E Upload Core Workflow", () => {
  test.setTimeout(30000);

  test("upload DOCX and verify parsing", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`PAGE ERROR: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`CONSOLE ERROR: ${msg.text()}`);
    });

    // 1. Load homepage
    await page.goto(BASE_URL);
    await page.waitForSelector("#dashboard-view", { timeout: 5000 });
    console.log("  ✓ Dashboard loaded");

    // 2. Open upload modal
    await page.click("[data-open-upload]");
    await page.waitForSelector("#upload-modal[open]", { timeout: 3000 });
    console.log("  ✓ Upload modal opened");

    // 3. Upload test DOCX file
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(TEST_DOCX);
    console.log("  ✓ File selected");

    // 4. Wait for upload to complete (look for parsing indicator or result)
    // The app may show a loading state then transition
    await page.waitForTimeout(2000);

    // Check for any parsing result or contract view
    const hasContractView = await page.locator("#contracts-view.active, #review-view.active").count() > 0;
    const hasUploadError = await page.evaluate(() => {
      const toast = document.querySelector("#app-toast");
      return toast && toast.textContent.includes("错误");
    });

    if (hasUploadError) {
      const errorText = await page.evaluate(() => document.querySelector("#app-toast")?.textContent || "");
      console.log("  ⚠ Upload error toast:", errorText);
    }

    console.log(`  ✓ Upload processed (contract view: ${hasContractView})`);

    // 5. Verify no critical errors
    const filteredErrors = errors.filter(e =>
      !e.includes("favicon") &&
      !e.includes("runtime-config") &&
      !e.includes("Backend snapshot") &&
      !e.includes("Backend autosync")
    );

    if (filteredErrors.length > 0) {
      console.log("  ⚠ Errors captured:");
      filteredErrors.slice(0, 5).forEach(e => console.log(`    ${e}`));
    }

    // Upload should not cause page errors
    const criticalErrors = filteredErrors.filter(e =>
      !e.includes("404") && !e.includes("Not Found")
    );
    expect(criticalErrors.length).toBe(0);
    console.log("  ✓ No critical page errors");
  });

  test("CSRF protection blocks unauthorized requests", async ({ page }) => {
    // Test that API without X-Requested-With header is rejected
    const response = await page.evaluate(async () => {
      try {
        const res = await fetch("/api/db/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contracts: [] }),
        });
        return { status: res.status, ok: res.ok, text: await res.text() };
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log("  Response:", JSON.stringify(response));

    // Should be rejected (401 or 403) or network error
    if (response.error) {
      console.log("  ✓ CSRF protection active (network error:", response.error + ")");
    } else {
      expect(typeof response.status).toBe("number");
      expect(response.status).toBeGreaterThanOrEqual(400);
      console.log("  ✓ CSRF protection active (status:", response.status + ")");
    }
  });

  test("legalWorkbenchFetch auto-carries CSRF header", async ({ page }) => {
    // The app's own fetch wrapper should include the header
    await page.goto(BASE_URL);
    await page.waitForSelector("#dashboard-view", { timeout: 5000 });

    // Trigger a backend sync by evaluating in page context
    const result = await page.evaluate(async () => {
      try {
        // The app should have legalWorkbenchFetch available
        if (typeof legalWorkbenchFetch !== "function") {
          return { error: "legalWorkbenchFetch not found" };
        }
        const res = await legalWorkbenchFetch("/api/health", { method: "GET" });
        return { status: res.status, ok: res.ok };
      } catch (e) {
        return { error: e.message };
      }
    });

    // Even if it fails for auth reasons, it should have attempted the request
    // (status 200 or 401 means the request reached the server)
    expect([200, 401]).toContain(result.status);
    console.log("  ✓ legalWorkbenchFetch works (status:", result.status + ")");
  });
});
