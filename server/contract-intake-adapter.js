const { execFile } = require("child_process");
const path = require("path");
const { getProviderStatus } = require("../scripts/ai-runner-lib");
const { parseRunnerJson } = require("./utils");

const PROVIDER_STATUS = getProviderStatus();
const RUNNER = process.env.CONTRACT_INTAKE_RUNNER_SCRIPT || (PROVIDER_STATUS.mode === "openai-compatible" ? "scripts/ai-intake-runner.js" : "scripts/codex-intake-runner.js");
const ALLOW_FALLBACK = process.env.CONTRACT_INTAKE_ALLOW_FALLBACK === "1";

function runContractIntake(request) {
  return runConfiguredContractIntake(request).catch((error) => {
    if (!ALLOW_FALLBACK) {
      throw new Error(`AI 合同信息填充失败：${error.message || String(error)}`);
    }
    return {
      ok: true,
      source: "backend-fallback",
      fallbackReason: error.message || String(error),
      intake: buildFallbackContractIntake(request),
    };
  });
}

function runConfiguredContractIntake(request) {
  return new Promise((resolve, reject) => {
    const runnerPath = path.resolve(process.cwd(), RUNNER);
    const child = execFile(process.execPath, [runnerPath], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || ""}`.trim()));
        return;
      }
      try {
        resolve({
          ok: true,
          source: path.basename(RUNNER),
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
  if (!counterparty) missingFacts.push("相对方名称");
  if (!partyA && !partyB) missingFacts.push("我方角色");
  if (!text) missingFacts.push("合同正文");
  return {
    contractName: cleanupValue(titleLine).slice(0, 80) || "待确认合同",
    contractType,
    counterparty,
    ourRole: partyA && partyB ? "待确认" : partyA ? "甲方（待确认）" : partyB ? "乙方（待确认）" : "待确认",
    purpose,
    businessBackground: [
      `系统根据上传文本生成了本地兜底识别结果：合同类型暂定为${contractType}。`,
      counterparty ? `当前识别到的相对方可能为：${counterparty}。` : "当前未能稳定识别相对方名称。",
      `合同目的初步判断为：${purpose}。`,
      missingFacts.length ? `正式审阅前仍建议确认：${missingFacts.join("、")}。` : "建议在正式审阅前确认我方角色、交易背景和谈判底线。",
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
  if (/保密|NDA|Confidential/i.test(source)) return "约定双方在合作、接洽或资料交换中的保密义务";
  if (/SaaS|API|软件|平台|系统|技术服务/i.test(source)) return "约定软件、平台、API 或技术服务的提供和使用安排";
  if (/股权|增资|投资|股东|治理/.test(source)) return "约定投资、股权安排及公司治理机制";
  if (/数据|个人信息|隐私|处理协议/.test(source)) return "约定数据、个人信息或相关服务的处理与使用规则";
  if (/采购|供货|订单/.test(source)) return "约定采购、供货或交付安排";
  return `处理${contractType}相关的交易安排`;
}

module.exports = { runContractIntake, buildFallbackContractIntake };
