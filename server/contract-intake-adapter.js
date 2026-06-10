const { createAiAdapter } = require("./base-adapter");

const adapter = createAiAdapter({
  name: "Contract intake runner",
  envRunnerScript: "CONTRACT_INTAKE_RUNNER_SCRIPT",
  envAllowFallback: "CONTRACT_INTAKE_ALLOW_FALLBACK",
  defaultOpenAiRunner: "scripts/ai-intake-runner.js",
  defaultCodexRunner: "scripts/codex-intake-runner.js",
  promptVersion: "agent-intake-v1",
  skillPath: "legal-work-orchestrator",
  downstreamSkill: "legal-contract-orchestrator",
  fallbackKey: "intake",
});

function runContractIntake(request) {
  return adapter.runWithFallback(request, adapter.runConfiguredCommand, buildFallbackContractIntake);
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
      `本地兜底识别结果：合同类型可能为“${contractType}”。`,
      counterparty ? `可能的相对方：${counterparty}。` : "暂未可靠识别出相对方，请人工确认。",
      `可能的合同目的：${purpose}。`,
      missingFacts.length ? `仍需补充确认：${missingFacts.join("。")}。` : "正式审阅前，请继续确认我方角色、交易背景和谈判重点。",
    ].join("\n"),
    confidence: text ? 48 : 0,
    missingFacts,
  };
}

function extractPartyName(text, label) {
  const match = String(text || "").match(new RegExp(`${label}\s*[：:]\s*([^\n]{2,100})`));
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

module.exports = {
  runContractIntake,
  getRunnerStatus: adapter.getRunnerStatus,
  buildFallbackContractIntake,
  _resetRunnerStatusForTesting: adapter._resetRunnerStatusForTesting,
};
