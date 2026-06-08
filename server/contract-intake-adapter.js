const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { getProviderStatus } = require("../scripts/ai-runner-lib");
const { parseRunnerJson } = require("./utils");
const { createRunnerHealthTracker } = require("./runner-health");

function getRunnerConfig() {
  const providerStatus = getProviderStatus();
  return {
    providerStatus,
    runner: process.env.CONTRACT_INTAKE_RUNNER_SCRIPT || (providerStatus.mode === "openai-compatible" ? "scripts/ai-intake-runner.js" : "scripts/codex-intake-runner.js"),
    allowFallback: process.env.CONTRACT_INTAKE_ALLOW_FALLBACK === "1",
  };
}

function getStaticRunnerStatus() {
  const runnerConfig = getRunnerConfig();
  return {
    configured: Boolean(runnerConfig.runner),
    runnerScript: runnerConfig.runner,
    runnerScriptExists: Boolean(runnerConfig.runner && fs.existsSync(path.resolve(process.cwd(), runnerConfig.runner))),
    provider: runnerConfig.providerStatus.provider,
    mode: runnerConfig.providerStatus.mode,
    providerMode: runnerConfig.providerStatus.mode,
    model: runnerConfig.providerStatus.model || "",
    allowFallback: runnerConfig.allowFallback,
    apiKeyConfigured: runnerConfig.providerStatus.apiKeyConfigured,
    baseUrlConfigured: runnerConfig.providerStatus.baseUrlConfigured,
    codexRunnable: runnerConfig.providerStatus.codexRunnable,
    codexDetail: runnerConfig.providerStatus.codexDetail || "",
  };
}

const runnerHealth = createRunnerHealthTracker("Contract intake runner", getStaticRunnerStatus);

function getRunnerStatus() {
  return runnerHealth.getStatus();
}

function runContractIntake(request) {
  const runnerConfig = getRunnerConfig();
  const startedAt = Date.now();
  runnerHealth.startRun();
  return runConfiguredContractIntake(request, runnerConfig).catch((error) => {
    if (!runnerConfig.allowFallback) {
      runnerHealth.markFailure({
        error: error.message || String(error),
        durationMs: Date.now() - startedAt,
        source: path.basename(runnerConfig.runner || ""),
      });
      throw new Error(`AI contract intake failed: ${error.message || String(error)}`);
    }
    const result = {
      ok: true,
      source: "backend-fallback",
      fallbackReason: error.message || String(error),
      intake: buildFallbackContractIntake(request),
    };
    runnerHealth.markFallback({
      error: error.message || String(error),
      fallbackReason: result.fallbackReason,
      durationMs: Date.now() - startedAt,
      source: result.source,
    });
    return result;
  }).then((result) => {
    if (result?.source !== "backend-fallback") {
      runnerHealth.markSuccess({
        durationMs: Date.now() - startedAt,
        source: result?.source || path.basename(runnerConfig.runner || ""),
      });
    }
    return result;
  });
}

function runConfiguredContractIntake(request, runnerConfig = getRunnerConfig()) {
  return new Promise((resolve, reject) => {
    const runnerPath = path.resolve(process.cwd(), runnerConfig.runner);
    const child = execFile(process.execPath, [runnerPath], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || ""}`.trim()));
        return;
      }
      try {
        resolve({
          ok: true,
          source: path.basename(runnerConfig.runner),
          ...parseRunnerJson(stdout),
        });
      } catch (parseError) {
        reject(parseError);
      }
    });
    child.stdin.write(JSON.stringify(request || {}, null, 2));
    child.stdin.end();
  });
}

function buildFallbackContractIntake(request = {}) {
  const text = String(request.contractText || "").replace(/\r/g, "").trim();
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const titleLine = lines.find((line) => /合同|协议|订单|备忘录|条款|NDA/i.test(line) && line.length <= 60) || lines[0] || "待确认合同";
  const partyA = extractPartyName(text, "甲方");
  const partyB = extractPartyName(text, "乙方");
  const companies = extractCompanyNames(text);
  const counterparty = partyB || partyA || companies[0] || "";
  const contractType = inferContractType(text);
  const purpose = inferPurpose(contractType, text);
  const missingFacts = [];
  if (!counterparty) missingFacts.push("counterparty");
  if (!partyA && !partyB) missingFacts.push("our_role");
  if (!text) missingFacts.push("contract_text");
  return {
    contractName: cleanupValue(titleLine).slice(0, 80) || "待确认合同",
    contractType,
    counterparty,
    ourRole: partyA && partyB ? "待确认" : partyA ? "甲方（待确认）" : partyB ? "乙方（待确认）" : "待确认",
    purpose,
    businessBackground: [
      `Local fallback identified the contract as ${contractType}.`,
      counterparty ? `Possible counterparty: ${counterparty}.` : "Counterparty could not be identified reliably.",
      `Possible purpose: ${purpose}.`,
      missingFacts.length ? `Please confirm: ${missingFacts.join(", ")}.` : "Please confirm role, business background, and negotiation priorities before formal review.",
    ].join("\n"),
    confidence: text ? 48 : 0,
    missingFacts,
  };
}

function extractPartyName(text, label) {
  const match = String(text || "").match(new RegExp(`${label}\\s*[：:]\\s*([^\\n]{2,100})`));
  return cleanupValue(match?.[1] || "");
}

function extractCompanyNames(text) {
  const matches = String(text || "").match(/[\u4e00-\u9fa5A-Za-z0-9()（）·\-.]{2,80}(?:公司|有限合伙|企业|中心|研究院|事务所)/g) || [];
  return [...new Set(matches.map(cleanupValue).filter(Boolean))];
}

function cleanupValue(value) {
  return String(value || "").replace(/[，。；;].*$/, "").replace(/["“”‘’]/g, "").trim();
}

function inferContractType(text) {
  const source = String(text || "");
  if (/保密|NDA|Confidential/i.test(source)) return "保密协议";
  if (/SaaS|API|软件|平台|系统|技术服务/i.test(source)) return "SaaS / 技术服务合同";
  if (/股权|增资|投资|股东|治理/.test(source)) return "股权投资或股东协议";
  if (/数据|个人信息|隐私|处理协议/.test(source)) return "数据处理或数据服务协议";
  if (/采购|供货|订单/.test(source)) return "采购或供货合同";
  return "商业合同";
}

function inferPurpose(contractType, text) {
  const source = `${contractType}\n${String(text || "").slice(0, 1200)}`;
  if (/保密|NDA|Confidential/i.test(source)) return "约定合作中的保密义务";
  if (/SaaS|API|软件|平台|系统|技术服务/i.test(source)) return "约定软件、平台、API 或技术服务的提供与使用";
  if (/股权|增资|投资|股东|治理/.test(source)) return "约定投资、股权安排及公司治理";
  if (/数据|个人信息|隐私|处理协议/.test(source)) return "约定数据或个人信息处理规则";
  if (/采购|供货|订单/.test(source)) return "约定采购、供货或交付安排";
  return `处理${contractType}相关交易安排`;
}

module.exports = { runContractIntake, getRunnerStatus, buildFallbackContractIntake, _resetRunnerStatusForTesting: () => runnerHealth.resetForTesting() };
