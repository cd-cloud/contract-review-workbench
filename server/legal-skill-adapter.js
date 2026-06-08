const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { getProviderStatus } = require("../scripts/ai-runner-lib");
const { parseRunnerJson } = require("./utils");
const { splitClauses, classifyClause } = require("../lib/contract-splitter");

const SKILL_PATH = process.env.LEGAL_WORK_ORCHESTRATOR_SKILL || path.join(process.env.USERPROFILE || "", ".codex", "skills", "legal-work-orchestrator", "SKILL.md");
const PROVIDER_STATUS = getProviderStatus();
const EXPLICIT_RUNNER_SCRIPT = Object.prototype.hasOwnProperty.call(process.env, "LEGAL_SKILL_RUNNER_SCRIPT");
const DEFAULT_RUNNER_SCRIPT = PROVIDER_STATUS.mode === "openai-compatible" ? "scripts/ai-skill-runner.js" : "scripts/codex-skill-runner.js";
const RUNNER_SCRIPT = process.env.LEGAL_SKILL_ALLOW_FALLBACK === "1" && !EXPLICIT_RUNNER_SCRIPT
  ? ""
  : EXPLICIT_RUNNER_SCRIPT
    ? process.env.LEGAL_SKILL_RUNNER_SCRIPT
    : DEFAULT_RUNNER_SCRIPT;
const RUNNER_COMMAND = process.env.LEGAL_SKILL_COMMAND || (RUNNER_SCRIPT ? process.execPath : "");
const RUNNER_ARGS = RUNNER_SCRIPT ? [path.resolve(process.cwd(), RUNNER_SCRIPT), ...parseRunnerArgs(process.env.LEGAL_SKILL_ARGS_JSON)] : parseRunnerArgs(process.env.LEGAL_SKILL_ARGS_JSON);

// Desktop / packaged builds: if no AI runner is actually configured, allow local fallback
// so the app remains usable out-of-the-box (local rule-based review instead of crashing).
// NOTE: Only auto-enable fallback in packaged (production) builds; in dev/test, keep strict.
const isPackaged = process.env.NODE_ENV === "production" || process.env.ELECTRON_IS_PACKAGED === "1";
if (!RUNNER_COMMAND && isPackaged && process.env.LEGAL_SKILL_ALLOW_FALLBACK !== "1") {
  process.env.LEGAL_SKILL_ALLOW_FALLBACK = "1";
}

function parseRunnerArgs(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (error) {
    return [];
  }
}

async function analyzeLegalReview(request, options = {}) {
  if (RUNNER_COMMAND) {
    return runConfiguredSkillCommand(request, options);
  }
  if (process.env.LEGAL_SKILL_ALLOW_FALLBACK !== "1") {
    throw new Error("AI Legal Skill Runner 未配置。请使用 npm run server:ai / npm run server:kimi，或配置 LEGAL_SKILL_RUNNER_SCRIPT。");
  }
  const result = buildFallbackSkillResult(request);
  result.__costMeta = { model: "fallback", provider: "local", source: result.source, estimatedCostCny: 0 };
  return result;
}

function getRunnerStatus() {
  const runnerScriptExists = RUNNER_SCRIPT ? fs.existsSync(path.resolve(process.cwd(), RUNNER_SCRIPT)) : false;
  const skillExists = fs.existsSync(SKILL_PATH);
  const usesCodexCli = PROVIDER_STATUS.mode === "codex-cli";
  const ready = Boolean(
    RUNNER_COMMAND &&
    (!RUNNER_SCRIPT || runnerScriptExists) &&
    (!usesCodexCli || PROVIDER_STATUS.codexRunnable) &&
    (!usesCodexCli || skillExists)
  );
  const summary = ready
    ? "本机 Codex CLI + legal-work-orchestrator 已就绪。"
    : RUNNER_COMMAND
      ? "本机 AI 审阅未就绪，请检查 Codex CLI 和 legal-work-orchestrator skill。"
      : "本机 AI 审阅未启用，当前使用本地规则兜底。";
  return {
    configured: Boolean(RUNNER_COMMAND),
    ready,
    summary,
    command: RUNNER_COMMAND || null,
    args: RUNNER_ARGS,
    runnerScript: RUNNER_SCRIPT || null,
    runnerScriptExists,
    skillPath: SKILL_PATH,
    skillExists,
    provider: PROVIDER_STATUS.provider,
    model: PROVIDER_STATUS.model,
    codexCommand: PROVIDER_STATUS.codexCommand || null,
    codexExists: Boolean(PROVIDER_STATUS.codexExists),
    codexRunnable: Boolean(PROVIDER_STATUS.codexRunnable),
    codexDetail: PROVIDER_STATUS.codexDetail || "",
    baseUrlConfigured: PROVIDER_STATUS.baseUrlConfigured,
    apiKeyConfigured: PROVIDER_STATUS.apiKeyConfigured,
    mode: RUNNER_COMMAND ? (usesCodexCli ? "codex-cli-local-skill" : `configured-runner:${PROVIDER_STATUS.provider}`) : "fallback",
  };
}

function runConfiguredSkillCommand(request, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = buildRunnerPayload(request);
    const child = execFile(RUNNER_COMMAND, RUNNER_ARGS, { maxBuffer: 40 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || ""}`.trim()));
        return;
      }
      try {
        const parsed = parseRunnerJson(stdout);
        const result = {
          ok: true,
          source: "configured-legal-skill-runner",
          runner: getRunnerStatus(),
          request,
          ...parsed,
        };
        result.__costMeta = { model: getRunnerStatus().model || "unknown", provider: getRunnerStatus().provider || "unknown", source: result.source };
        resolve(result);
      } catch (parseError) {
        reject(new Error(`Skill command did not return JSON: ${parseError.message}`));
      }
    });

    // Support cancellation via AbortController
    if (options.signal) {
      const onAbort = () => {
        try { child.kill("SIGTERM"); } catch (e) {}
        setTimeout(() => {
          try { if (!child.killed) child.kill("SIGKILL"); } catch (e) {}
        }, 3000);
        reject(new Error("AI analysis was cancelled"));
      };
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
      child.on("close", () => {
        try { options.signal.removeEventListener("abort", onAbort); } catch (e) {}
      });
    }

    child.stdin.write(JSON.stringify(payload, null, 2));
    child.stdin.end();
  });
}

function buildRunnerPayload(request) {
  const skillInstructions = fs.existsSync(SKILL_PATH) ? fs.readFileSync(SKILL_PATH, "utf8") : "";
  return {
    instruction: "Use legal-work-orchestrator first and route to legal-contract-orchestrator where available. If the current provider is Kimi, Moonshot, or another OpenAI-compatible model without local Codex skills, complete the same lawyer-style contract review directly. First perform the full legal review internally, then normalize the completed work into the structured JSON expected by the workbench. Return clauseSegmentation based on legal meaning rather than regex-only parsing. If request.clauses is empty, treat it as an automatic segmentation task and prioritize clauseSegmentation with empty risk arrays. If a chapter title duplicates its only child clause title or first line, keep only one node. For add-clause suggestions, fill targetInsertPosition and linkedClauseIds whenever the suggestion belongs near an existing chapter or clause; reserve pure contractLevelRisks for suggestions with no reasonable card-level location. Do not output the same add-clause suggestion in multiple places.",
    skillInstructions,
    expectedOutput: {
      response: {
        contractSummary: {},
        clauseSegmentation: [
          {
            stableId: "stable short id",
            order: 1,
            title: "条款标题；无明确标题则为空字符串",
            text: "合同原文中的完整条款文本",
            type: "条款类型",
            chapterTitle: "所属章节；没有则为空字符串",
            hierarchyLevel: "preface / article / chapter",
          },
        ],
        contractLevelRisks: [
          {
            severity: "high / medium / low",
            actionType: "add_clause / comment_only",
            title: "风险标题",
            issue: "具体问题",
            consequence: "不处理的法律或商业后果",
            suggestion: "具体处理动作",
            proposedClauseText: "可直接新增的条款文本",
            targetInsertPosition: "建议插入位置",
            businessRationale: "为什么需要这样改",
            adoptionNote: "采纳说明或谈判提示",
            negotiationBottomLine: "我方底线",
            acceptableFallback: "可接受让步版本",
            linkedClauseIds: ["会联动影响的其他条款 ID"],
            qualityScore: 0,
          },
        ],
        clauseAnalyses: [
          {
            clauseId: "request.clauses 中的稳定 ID",
            title: "条款标题",
            clauseType: "条款类型",
            severity: "high / medium / low",
            actionType: "replace_clause / revise_clause / delete_clause / comment_only",
            issue: "具体问题",
            consequence: "不处理的法律或商业后果",
            proposedRevision: "可直接替换或修改的文本",
            targetText: "原文中需要替换的片段；没有则为空字符串",
            replacementText: "替换后的具体文本；没有则为空字符串",
            commentText: "给业务或对方的批注意见；没有则为空字符串",
            negotiationPosition: "谈判立场",
            fallbackText: "备选文本",
            businessDecision: "需要业务确认的问题；没有则为空字符串",
            adoptionNote: "采纳说明或谈判提示",
            negotiationBottomLine: "我方底线",
            acceptableFallback: "可接受让步版本",
            linkedClauseIds: ["会联动影响的其他条款 ID"],
            qualityScore: 0,
          },
        ],
        missingFacts: [],
        businessSummary: "",
      },
    },
    request,
  };
}

function buildFallbackSkillResult(request) {
  const skillLoaded = fs.existsSync(SKILL_PATH);
  const clauses = Array.isArray(request.clauses) && request.clauses.length ? request.clauses : splitClauses(request.contract_text || "");
  const contractType = inferContractType(request.contract_text || "", request.contract_type);
  const purpose = inferPurpose(contractType, request.business_background);
  const clauseAnalyses = clauses.flatMap((clause) => analyzeClause(clause, request));
  const contractLevelRisks = analyzeContractLevelRisks(clauses, request);
  const allRisks = [...contractLevelRisks, ...clauseAnalyses];
  const riskLevel = allRisks.some((item) => normalizeSeverity(item.severity) === "high")
    ? "high"
    : allRisks.some((item) => normalizeSeverity(item.severity) === "medium")
      ? "medium"
      : "low";

  return {
    ok: true,
    source: skillLoaded ? "local-bridge-fallback-with-skill-instructions" : "local-bridge-fallback",
    skill: "legal-work-orchestrator",
    downstreamSkill: "legal-contract-orchestrator",
    skillPath: SKILL_PATH,
    request,
    response: {
      contractSummary: {
        contractName: request.contract_name || "",
        contractType,
        purpose,
        ourRole: request.represented_party || "",
        counterparty: request.counterparty || "",
        riskLevel,
        completionScore: completionScore(clauses),
        positionDeviationLevel: null,
      },
      clauseSegmentation: clauses.map((clause, index) => ({
        stableId: clause.stableId || clause.id || `fallback-${index + 1}`,
        order: index + 1,
        title: clause.title || "",
        text: clause.text || "",
        type: clause.type || classifyClause(clause.text, clause.title),
        chapterTitle: clause.chapterTitle || "",
        hierarchyLevel: clause.hierarchyLevel || "article",
      })),
      contractLevelRisks,
      clauseAnalyses,
      missingFacts: inferMissingFacts(request),
      businessSummary: buildBusinessSummary(contractType, riskLevel, contractLevelRisks),
    },
  };
}


function inferContractType(text, fallback) {
  if (fallback && fallback !== "待识别") return fallback;
  if (/SaaS|API|软件|平台|系统|技术服务/i.test(text)) return "SaaS / 技术服务合同";
  if (/数据|数据集|语料|采购/.test(text)) return "数据采购或数据服务合同";
  if (/保密|NDA|秘密信息/i.test(text)) return "保密协议";
  return "商业服务合同";
}

function inferPurpose(contractType, fallback) {
  if (fallback && fallback !== "待识别") return fallback;
  if (contractType.includes("SaaS") || contractType.includes("技术")) return "采购或提供 AI / SaaS / API 技术服务";
  if (contractType.includes("数据")) return "采购、交付或使用数据资源";
  return "规范双方商业合作权利义务";
}

function analyzeClause(clause, request) {
  const findings = [];
  const text = clause.text || "";
  const push = (severity, issue, proposedRevision, negotiationPosition = "", fallbackText = "") => {
    const linkedClauseIds = inferLinkedClauseIds(clause, request);
    findings.push({
      clauseId: clause.id,
      title: clause.title,
      clauseType: clause.type || classifyClause(text, clause.title),
      severity,
      actionType: inferClauseActionType(proposedRevision),
      issue,
      consequence: severity === "high" ? "可能影响核心风险分配或后续履约争议处理。" : "建议结合交易背景进一步确认。",
      proposedRevision,
      negotiationPosition,
      negotiationBottomLine: negotiationPosition || inferNegotiationBottomLine(clause.type || classifyClause(text, clause.title)),
      fallbackText: fallbackText || proposedRevision,
      acceptableFallback: fallbackText || proposedRevision,
      linkedClauseIds,
      businessDecision: severity === "high" ? "需要业务或管理层确认" : "",
      qualityScore: scoreSuggestionQuality({ proposedRevision, fallbackText, negotiationPosition, linkedClauseIds, request }),
    });
  };

  function inferClauseActionType(proposedRevision = "") {
    const source = String(proposedRevision || "");
    if (/删除|删去|移除|不建议保留/.test(source)) return "delete_clause";
    if (/替换为|修改为|改为|全文替换/.test(source)) return "replace_clause";
    return source.trim() ? "revise_clause" : "comment_only";
  }

  if (/训练|模型|数据/.test(text) && !/不得|禁止|书面同意|仅限/.test(text)) {
    push(
      "high",
      "数据或模型训练用途边界不清。",
      "明确数据使用目的、是否可用于模型训练、授权范围、留存期限和删除机制。",
      "我方应优先坚持未经书面同意不得用于通用模型训练。",
      "未经甲方事先书面同意，乙方不得将甲方输入数据、输出内容、业务数据或其衍生数据用于训练、微调或改进任何通用模型；乙方仅可在提供、维护和保障本服务安全所必需的范围内处理相关数据。"
    );
  }
  if (/付款|费用|账期/.test(text) && /六十|60|九十|90/.test(text)) {
    push(
      "medium",
      "付款账期较长或回款约束不足。",
      "缩短账期，增加逾期付款违约责任，并明确发票争议不影响无争议金额支付。",
      "",
      "甲方应在收到合法有效发票后三十日内支付无争议款项；甲方对部分金额有异议的，不影响其按期支付无争议部分。逾期付款的，甲方应按每日万分之三支付违约金。"
    );
  }
  if (/责任限制|赔偿/.test(text) && !/例外|不适用|保密|知识产权|数据/.test(text)) {
    push(
      "high",
      "责任上限缺少例外事项。",
      "将保密、知识产权侵权、数据安全、故意或重大过失排除在责任上限之外。",
      "",
      "除保密义务、知识产权侵权、数据安全事件、个人信息保护责任以及一方故意或重大过失导致的损失外，任一方在本合同项下的累计赔偿责任以甲方过去十二个月已支付服务费为上限。"
    );
  }
  if (/个人信息|隐私/.test(text) && !/处理目的|处理方式|删除|安全措施/.test(text)) {
    push(
      "medium",
      "个人信息处理机制不完整。",
      "补充处理目的、处理方式、安全措施、协助响应个人权利请求和删除返还机制。",
      "",
      "如服务涉及个人信息处理，双方应另行签署数据处理协议或在本合同中明确处理目的、处理方式、个人信息种类、保存期限、安全措施、个人权利请求协助机制以及合同终止后的删除或返还安排。"
    );
  }
  return findings;
}

function analyzeContractLevelRisks(clauses) {
  const present = new Set(clauses.map((clause) => clause.type || classifyClause(clause.text, clause.title)));
  return [
    ["保密", "medium"],
    ["知识产权", "high"],
    ["责任限制", "high"],
    ["争议解决", "medium"],
  ]
    .filter(([type]) => !present.has(type))
    .map(([type, severity]) => ({
      severity,
      actionType: "add_clause",
      title: `缺少${type}条款`,
      issue: `未识别到独立的${type}条款。`,
      consequence: "关键风险分配缺失，可能影响履约、争议解决或资产归属判断。",
      suggestion: `补充完整的${type}条款，并与合同类型、我方角色和交易背景匹配。`,
      proposedClauseText: buildFallbackSuggestedClauseText(type),
      negotiationBottomLine: `至少补充可执行的${type}机制，避免仅作原则性表述。`,
      acceptableFallback: `可先补充简版${type}条款，并在附件或订单中细化执行细节。`,
      linkedClauseIds: [],
      qualityScore: 72,
    }));
}

function inferLinkedClauseIds(clause, request) {
  const type = clause.type || classifyClause(clause.text, clause.title);
  const clauses = Array.isArray(request.clauses) ? request.clauses : [];
  const linkedTypes = {
    责任限制: ["赔偿", "违约责任", "保密", "知识产权", "数据使用", "个人信息保护"],
    期限与终止: ["付款", "数据使用", "保密", "知识产权"],
    数据使用: ["个人信息保护", "保密", "知识产权", "责任限制"],
    个人信息保护: ["数据使用", "保密", "责任限制"],
    知识产权: ["保密", "责任限制", "赔偿"],
  }[type] || [];
  return clauses.filter((item) => item.id !== clause.id && linkedTypes.includes(item.type)).map((item) => item.id).slice(0, 6);
}

function inferNegotiationBottomLine(type) {
  const map = {
    数据使用: "未经书面同意不得将客户数据、输入输出或业务数据用于通用模型训练。",
    个人信息保护: "必须明确处理目的、范围、安全措施、分包、删除返还和事件通知机制。",
    责任限制: "保密、知识产权、数据安全、故意或重大过失不应适用责任上限。",
    付款: "至少保留无争议金额按期支付和逾期救济。",
    期限与终止: "便利终止不得免除已发生费用、不可取消资源成本和终止后存续义务。",
  };
  return map[type] || "应保留义务主体、适用范围、触发条件、例外事项和违约后果。";
}

function scoreSuggestionQuality({ proposedRevision, fallbackText, negotiationPosition, linkedClauseIds, request }) {
  let score = 30;
  if (String(proposedRevision || "").length >= 40) score += 25;
  if (String(fallbackText || "").length >= 40) score += 15;
  if (String(negotiationPosition || "").length >= 12) score += 10;
  if ((linkedClauseIds || []).length) score += 10;
  if (request.represented_party && request.represented_party !== "待识别") score += 5;
  if (request.contract_type && request.contract_type !== "待识别") score += 5;
  return Math.min(score, 100);
}

function buildFallbackSuggestedClauseText(type) {
  const templates = {
    保密: "双方应对在合作过程中获知的商业秘密、技术资料、客户信息及其他非公开信息承担保密义务，未经披露方书面同意不得向第三方披露或用于本合同目的之外的用途。",
    知识产权: "双方既有知识产权仍归原权利人所有；因履行本合同形成的成果、软件、模型、数据处理成果及文档的权属、许可范围和终止后处理方式应以本合同或附件明确约定为准。",
    责任限制: "除保密、知识产权侵权、数据安全、个人信息保护、故意或重大过失及依法不得限制责任的情形外，任一方累计赔偿责任以本合同项下过去十二个月已支付或应支付费用为上限。",
    争议解决: "因本合同产生的争议，双方应先友好协商；协商不成的，任一方可向有管辖权的人民法院提起诉讼。本合同适用中华人民共和国法律。",
  };
  return templates[type] || `请补充${type}条款，明确义务主体、适用范围、触发条件、例外事项、违约后果和终止后处理。`;
}

function completionScore(clauses) {
  const present = new Set(clauses.map((clause) => clause.type || classifyClause(clause.text, clause.title)));
  const core = ["服务范围", "付款", "知识产权", "数据使用", "个人信息保护", "保密", "责任限制", "期限与终止", "争议解决"];
  return Math.round((core.filter((type) => present.has(type)).length / core.length) * 100);
}

function inferMissingFacts(request) {
  return [
    request.represented_party ? null : "我方角色",
    request.counterparty ? null : "相对方身份",
    request.business_background ? null : "交易背景和商业目的",
  ].filter(Boolean);
}

function buildBusinessSummary(contractType, riskLevel, contractLevelRisks) {
  return `${contractType} 当前整体风险为${riskLevel}；合同级待补事项 ${contractLevelRisks.length} 项。建议先处理高风险条款，再进入对方版本谈判或终稿沉淀。`;
}

const { normalizeSeverity } = require("../lib/normalize");
const { isChapterHeading, isArticleHeading, isMainArticleHeading, isDecimalClauseHeading, extractExplicitArticleTitle, isExplicitHeadingLine, isExplicitHeadingText, extractClauseTitle, isDocumentControlNotice, isContractTitleOnly, isPartyInfoChunk, isPartyInfoLine } = require("../lib/contract-parsing");

module.exports = {
  analyzeLegalReview,
  getRunnerStatus,
};
