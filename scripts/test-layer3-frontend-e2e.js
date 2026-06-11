/**
 * Layer 3: Frontend end-to-end test with Playwright
 * Tests the complete contract review workflow in the browser without AI.
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const workspace = path.resolve(__dirname, "..");
const artifactDir = path.join(workspace, "data", "frontend-e2e-test");
const localChrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((item) => fs.existsSync(item));

const sampleContract = `技术服务合同

甲方：北京科技有限公司
乙方：上海云服务股份有限公司

鉴于甲方拟采购乙方提供的云计算服务，双方经友好协商，达成如下协议。

第一条 服务范围
1.1 乙方应向甲方提供基于云平台的计算、存储及网络服务。
1.2 服务内容包括：虚拟机实例、对象存储、负载均衡及数据库服务。

第二条 服务费用与付款
2.1 服务费用按实际使用量计费，单价详见附件《价格清单》。
2.2 甲方应于每月收到账单后十五个工作日内支付上月费用。
2.3 逾期付款的，甲方应按日万分之五支付滞纳金。

第三条 知识产权
3.1 乙方保留其提供的软件、平台及相关技术的全部知识产权。
3.2 甲方在使用服务过程中产生的数据及成果归甲方所有。

第四条 保密义务
4.1 双方应对在履行本合同过程中知悉的对方商业秘密予以保密。
4.2 保密义务不因本合同终止而失效，持续有效三年。

第五条 违约责任
5.1 任何一方违反本合同约定，应赔偿守约方因此遭受的直接损失。
5.2 乙方因服务中断造成甲方损失的，赔偿责任不超过上月服务费用总额。

第六条 期限与终止
6.1 本合同有效期为一年，自签署之日起算。
6.2 任何一方提前三十日书面通知对方，可终止本合同。

第七条 争议解决
7.1 因本合同引起的争议，双方应友好协商解决。
7.2 协商不成的，任何一方均可向甲方所在地有管辖权的人民法院提起诉讼。
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Prefer local Chrome/Edge when available; otherwise use Playwright's bundled Chromium
  fs.mkdirSync(artifactDir, { recursive: true });

  const logs = [];
  const errors = [];

  const browser = await chromium.launch({ headless: true, executablePath: localChrome || undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    logs.push({ type: msg.type(), text: msg.text() });
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  // Step 1: Open the app
  await page.goto(pathToFileURL(path.join(workspace, "index.html")).href, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-open-upload]");
  await page.screenshot({ path: path.join(artifactDir, "01-home.png"), fullPage: true });
  console.log("  ✓ Page loaded");

  // Step 2: Open upload dialog
  await page.click("[data-open-upload]");
  await page.waitForSelector("#upload-form");
  await page.screenshot({ path: path.join(artifactDir, "02-upload-dialog.png"), fullPage: true });
  console.log("  ✓ Upload dialog opened");

  // Step 3: Paste contract text
  await page.fill("#clean-text-input", sampleContract);
  await sleep(500);
  console.log("  ✓ Contract text pasted");

  // Step 4: Click local autofill
  await page.click("[data-autofill-new-review-local]");
  await sleep(1500);
  await page.screenshot({ path: path.join(artifactDir, "03-autofilled.png"), fullPage: true });
  console.log("  ✓ Local autofill clicked");

  // Step 5: Fill contract name and submit
  await page.fill("#contract-name-input", `前端E2E测试-${Date.now()}`);
  await page.fill("#counterparty-input", "上海云服务股份有限公司");
  await page.fill("#party-role-input", "甲方");
  await page.click("#upload-form button[type='submit']");

  // Step 6: Wait for review view
  await page.waitForSelector("#review-view.active", { timeout: 15000 });
  await sleep(2000);
  await page.screenshot({ path: path.join(artifactDir, "04-review-loaded.png"), fullPage: true });
  console.log("  ✓ Review view loaded");

  // Step 7: Verify clause cards rendered
  const clauseCards = await page.locator("[data-clause-card]").count();
  const subclauseCards = await page.locator("[data-subclause-card]").count();
  console.log(`  ✓ Clause cards: ${clauseCards}, Subclause cards: ${subclauseCards}`);

  // Step 8: Verify no critical JS errors
  const criticalErrors = errors.filter((e) => !/ResizeObserver|source map|deprecated/i.test(e));
  if (criticalErrors.length > 0) {
    console.warn("  ⚠ JS errors detected:", criticalErrors.slice(0, 5));
  } else {
    console.log("  ✓ No critical JS errors");
  }

  // Step 9: Verify body text has expected content
  const bodyText = await page.locator("body").innerText();
  const hasServiceScope = /服务范围/.test(bodyText);
  const hasPayment = /付款|费用/.test(bodyText);
  const hasConfidentiality = /保密/.test(bodyText);
  const hasNoMojibake = !/鍚|鎷|鏈|寰|涓|鏉|绗|瀹|瑙|闃|�|\?\?\?/.test(bodyText);
  console.log(`  ✓ Content check: serviceScope=${hasServiceScope}, payment=${hasPayment}, confidentiality=${hasConfidentiality}, noMojibake=${hasNoMojibake}`);

  // Step 10: Interact with clause card (double click first card)
  if (clauseCards > 0) {
    await page.locator("[data-clause-card]").first().dblclick();
    await sleep(1000);
    await page.screenshot({ path: path.join(artifactDir, "05-card-dblclick.png"), fullPage: true });
    console.log("  ✓ Clause card double-clicked");
  }

  const result = {
    clauseCards,
    subclauseCards,
    hasServiceScope,
    hasPayment,
    hasConfidentiality,
    hasNoMojibake,
    criticalErrors: criticalErrors.slice(0, 10),
    logs: logs.filter((l) => l.type === "error" || l.type === "warning").slice(0, 10),
    artifacts: artifactDir,
  };

  await browser.close();

  // Assertions
  if (clauseCards === 0 && subclauseCards === 0) {
    throw new Error("No clause cards rendered");
  }
  if (!hasNoMojibake) {
    throw new Error("Mojibake detected in page content");
  }
  if (criticalErrors.length > 3) {
    throw new Error(`Too many critical JS errors: ${criticalErrors.length}`);
  }

  console.log("\nLayer 3: Frontend E2E tests passed.");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Layer 3 test failed:", error);
  process.exit(1);
});
