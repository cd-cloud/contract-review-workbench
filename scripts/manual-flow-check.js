const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const workspace = path.resolve(__dirname, "..");
const contractPath = process.env.MANUAL_FLOW_CONTRACT || path.join(workspace, "data", "files", "shareholder-agreement-20260510.docx");
const artifactDir = path.join(workspace, "data", "manual-flow-check");
// Default to Playwright's bundled Chromium; override with PLAYWRIGHT_EXECUTABLE_PATH.
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickIfPresent(page, selector, label) {
  const locator = page.locator(selector).first();
  if (!(await locator.count())) return false;
  if (!(await locator.isEnabled())) return false;
  await locator.click();
  console.log(`clicked: ${label}`);
  return true;
}

async function waitForAnalysis(page) {
  const deadline = Date.now() + 240000;
  let lastText = "";
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText().catch(() => "");
    const statusLines = text
      .split(/\n+/)
      .filter((line) => /Codex|分析|审阅|失败|完成|风险|建议/.test(line))
      .slice(0, 12);
    const current = statusLines.join(" | ");
    if (current && current !== lastText) {
      console.log(`status: ${current.slice(0, 500)}`);
      lastText = current;
    }
    const waitingCount = (text.match(/等待 Codex 审阅/g) || []).length;
    const hasAnalysisResult = /Codex 已自动完成审阅分析|分析完成|建议修改|采纳修改|Codex 未返回/.test(text) || waitingCount === 0;
    if (hasAnalysisResult && /生成拟发送版本/.test(text)) return text;
    if (/失败|Error|报错/.test(text)) return text;
    await sleep(3000);
  }
  throw new Error("Timed out waiting for automatic Codex analysis");
}

async function main() {
  if (!fs.existsSync(contractPath)) throw new Error(`Missing test contract: ${contractPath}`);
  fs.mkdirSync(artifactDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  const logs = [];
  page.on("console", (msg) => logs.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", (error) => logs.push({ type: "pageerror", text: error.message }));

  await page.goto(pathToFileURL(path.join(workspace, "index.html")).href, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-open-upload]");
  await page.screenshot({ path: path.join(artifactDir, "01-home.png"), fullPage: true });

  await page.click("[data-open-upload]");
  await page.setInputFiles("#clean-file-input", contractPath);
  await page.screenshot({ path: path.join(artifactDir, "02-file-selected.png"), fullPage: true });
  await page.waitForFunction(() => document.querySelector("#clean-text-input")?.value?.length > 0, null, { timeout: 30000 });
  const parsedValue = await page.locator("#clean-text-input").inputValue();
  if (parsedValue.length < 200 || parsedValue.includes("文件解析失败")) {
    await page.screenshot({ path: path.join(artifactDir, "02-upload-parse-problem.png"), fullPage: true });
    throw new Error(`Uploaded file was not parsed into contract text: ${parsedValue.slice(0, 300)}`);
  }
  await page.click("[data-autofill-new-review-local]");
  await page.fill("#contract-name-input", `手动流程测试-股东协议-${Date.now()}`);
  await page.fill("#counterparty-input", "测试相对方");
  await page.fill("#party-role-input", "甲方");
  await page.fill("#contract-background-input", "用于验证 Codex Legal Skill 可视化审阅台的端到端流程，重点观察条款切分、建议匹配、采纳动作、拟发送版本和导出。");
  await page.screenshot({ path: path.join(artifactDir, "02-upload-filled.png"), fullPage: true });
  await page.click("#upload-form button[type='submit']");

  await page.waitForSelector("#review-view.active", { timeout: 10000 });
  await page.screenshot({ path: path.join(artifactDir, "03-review-started.png"), fullPage: true });
  const analysisText = await waitForAnalysis(page);
  await page.screenshot({ path: path.join(artifactDir, "04-after-analysis.png"), fullPage: true });

  const clauseCards = await page.locator("[data-clause-card]").count();
  const subclauseCards = await page.locator("[data-subclause-card]").count();
  const adoptButtons = await page.locator("[data-adopt-clause-risk]").count();
  const contractAdoptButtons = await page.locator("[data-adopt-contract-risk]").count();

  if (clauseCards > 0) {
    await page.locator("[data-clause-card]").first().dblclick();
    await page.screenshot({ path: path.join(artifactDir, "05-card-dblclick.png"), fullPage: true });
  }

  let suggestionAction = "skipped";
  if (adoptButtons > 0) {
    await page.locator("[data-adopt-clause-risk]").first().click();
    await sleep(15000);
    suggestionAction = "clicked-clause-adopt";
  } else if (contractAdoptButtons > 0) {
    await page.locator("[data-adopt-contract-risk]").first().click();
    await sleep(2000);
    suggestionAction = "clicked-contract-adopt";
  }
  await page.screenshot({ path: path.join(artifactDir, "06-after-suggestion-action.png"), fullPage: true });

  await clickIfPresent(page, "[data-generate-send-version]", "generate send version");
  await sleep(15000);
  await page.screenshot({ path: path.join(artifactDir, "07-after-generate-send-version.png"), fullPage: true });

  let downloadName = "";
  if (await page.locator("[data-export-word-redline]").count()) {
    const downloadPromise = page.waitForEvent("download", { timeout: 30000 }).catch(() => null);
    await page.locator("[data-export-word-redline]").first().click();
    const download = await downloadPromise;
    if (download) {
      downloadName = download.suggestedFilename();
      await download.saveAs(path.join(artifactDir, downloadName));
    }
  }

  const bodyText = await page.locator("body").innerText();
  const result = {
    clauseCards,
    subclauseCards,
    adoptButtons,
    contractAdoptButtons,
    suggestionAction,
    downloadName,
    hasMojibake: /鍚|鎷|鏈|寰|涓|鏉|绗|瀹|瑙|闃|�|\?\?\?/.test(bodyText),
    hasAnalysisFailure: /失败|Error|报错/.test(bodyText),
    bodyExcerpt: bodyText.slice(0, 2000),
    analysisExcerpt: analysisText.slice(0, 2000),
    logs: logs.slice(-30),
    artifacts: artifactDir,
  };
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
