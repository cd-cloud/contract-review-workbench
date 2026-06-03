const fs = require("fs");

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);
  });
}

const { normalizeSeverity } = require("../lib/normalize");
const { isChapterHeading, isArticleHeading, isMainArticleHeading, isDecimalClauseHeading, extractExplicitArticleTitle, isExplicitHeadingLine, isExplicitHeadingText, extractClauseTitle, isDocumentControlNotice, isContractTitleOnly, isPartyInfoChunk, isPartyInfoLine } = require("../lib/contract-parsing");
const { splitClauses, classifyClause } = require("../lib/contract-splitter");

function classifyContract(text, fallback = "") {
  if (fallback && !/待识别|unknown|\?{2,}/i.test(fallback)) return fallback;
  if (/股东协议|股东会|董事会|增资|出资|股权|创始人|投资人|优先认购|清算|回购|反稀释|退出/.test(text)) return "股东协议 / 公司治理协议";
  if (/SaaS|API|软件|平台|系统|技术服务/i.test(text)) return "SaaS / 技术服务合同";
  if (/数据|语料|标注|训练/.test(text)) return "数据采购或数据服务合同";
  if (/保密|NDA|秘密信息/i.test(text)) return "保密协议";
  return "商业服务合同";
}


function issue(clause, severity, issueText, consequence, proposedRevision, negotiationPosition = "", fallbackText = "") {
  return {
    clauseId: clause?.id || null,
    title: clause?.title || issueText,
    clauseType: clause?.type || "",
    severity,
    actionType: inferClauseActionType(proposedRevision),
    issue: issueText,
    consequence,
    proposedRevision,
    negotiationPosition,
    fallbackText: fallbackText || proposedRevision,
    negotiationBottomLine: negotiationPosition || "应保留可执行的义务主体、适用范围、例外事项和违约后果。",
    acceptableFallback: fallbackText || proposedRevision,
    linkedClauseIds: [],
    qualityScore: Math.min(100, 40 + (String(proposedRevision || "").length >= 40 ? 30 : 0) + (String(fallbackText || "").length >= 40 ? 15 : 0) + (String(negotiationPosition || "").length >= 12 ? 15 : 0)),
    businessDecision: normalizeSeverity(severity) === "high" ? "需要管理层或业务负责人确认可接受边界。" : "",
  };
}

function inferClauseActionType(proposedRevision = "") {
  const text = String(proposedRevision || "");
  if (/删除|删去|移除|不建议保留/.test(text)) return "delete_clause";
  if (/替换为|修改为|改为|全文替换/.test(text)) return "replace_clause";
  return text.trim() ? "revise_clause" : "comment_only";
}

function analyzeClause(clause, contractType) {
  const text = clause.text || "";
  const findings = [];

  if (/股东协议|公司治理/.test(contractType)) {
    if (/董事会|股东会|重大事项|否决|表决/.test(text) && !/清单|附件|具体事项|金额|阈值|比例/.test(text)) {
      findings.push(issue(clause, "high", "治理/否决事项边界不够清晰", "重大事项、金额阈值或表决机制不清，可能导致公司经营事项被过度阻滞，或投资人保护性权利难以执行。", "补充重大事项清单、金额阈值、表决比例、会议召集和未回复视为弃权/反对的后果，并区分日常经营与特别事项。", "建议坚持将否决事项限定为融资、并购、清算、核心资产处置、预算外大额支出等重大事项。"));
    }
    if (/创始人|离职|回购|锁定|竞业/.test(text) && !/期限|价格|触发|善意离职|恶意离职|除外/.test(text)) {
      findings.push(issue(clause, "high", "创始人约束和回购机制不完整", "创始人离职、违约或不履职时缺少明确处理机制，可能影响控制权稳定和投资人预期。", "明确锁定期、全职投入义务、善意/恶意离职分类、回购触发条件、回购价格、程序和例外。", "可将恶意离职、重大违约、竞业违约设置为低价回购；善意离职可采用公允价格或分期释放。"));
    }
    if (/知识产权|专利|著作权|软件|算法|职务成果/.test(text) && !/归属|转让|许可|职务|交付|开源/.test(text)) {
      findings.push(issue(clause, "high", "知识产权归属和创始人贡献未闭合", "创业公司核心资产可能存在权属瑕疵，影响融资、并购和后续商业化。", "明确创始人、员工、外包方在设立前后形成的技术、代码、商标、域名、算法和资料归公司所有或独占许可，并要求签署转让/确认文件。"));
    }
    if (/反稀释|清算优先|优先认购|共同出售|领售|随售|信息权/.test(text) && !/适用条件|例外|程序|比例|期限/.test(text)) {
      findings.push(issue(clause, "medium", "投资人特殊权利缺少适用边界", "特殊权利范围过宽或程序不清，可能影响后续融资和公司治理效率。", "为特殊权利补充适用条件、例外情形、行权程序、期限和与后续融资文件的衔接规则。"));
    }
  }

  if (/数据|训练|模型/.test(text) && !/不得|禁止|书面同意|仅限/.test(text)) {
    findings.push(issue(clause, "high", "数据或模型训练用途边界不清", "可能引发数据合规、商业秘密和模型训练授权争议。", "明确数据使用目的、授权范围、是否可用于模型训练、留存期限、安全措施和删除机制。"));
  }
  if (/责任|赔偿/.test(text) && !/上限|例外|间接损失|故意|重大过失/.test(text)) {
    findings.push(issue(clause, "medium", "违约责任缺少上限或例外结构", "责任边界不清，可能导致赔偿争议或风险无法量化。", "补充赔偿责任范围、责任上限、不适用上限的例外事项和间接损失排除。"));
  }
  if (/争议|法院|仲裁|管辖/.test(text) && !/适用法律|仲裁机构|所在地|专属/.test(text)) {
    findings.push(issue(clause, "medium", "争议解决安排不完整", "管辖、适用法律或仲裁机构不清会增加争议处理成本。", "明确适用法律、管辖法院或仲裁机构、仲裁地、语言和临时救济安排。"));
  }

  return findings;
}

function contractLevelRisks(clauses, contractType) {
  const present = new Set(clauses.map((clause) => clause.type || classifyClause(clause.text, clause.title)));
  const required = /股东协议|公司治理/.test(contractType)
    ? [
        ["出资与股权", "high", "缺少或未识别到完整的出资与股权结构安排。"],
        ["公司治理", "high", "缺少或未识别到股东会/董事会/重大事项机制。"],
        ["创始人限制", "medium", "缺少或未识别到创始人锁定、离职或回购机制。"],
        ["股权转让", "medium", "缺少或未识别到股权转让限制、优先购买或共同出售机制。"],
        ["知识产权", "high", "缺少或未识别到核心知识产权归属安排。"],
        ["争议解决", "medium", "缺少或未识别到争议解决条款。"],
      ]
    : [
        ["保密", "medium", "缺少或未识别到独立保密条款。"],
        ["知识产权", "high", "缺少或未识别到独立知识产权条款。"],
        ["违约责任", "medium", "缺少或未识别到违约责任条款。"],
        ["争议解决", "medium", "缺少或未识别到争议解决条款。"],
      ];
  return required
    .filter(([type]) => !present.has(type))
    .map(([type, severity, summary]) => ({
      severity,
      actionType: "add_clause",
      title: `缺少${type}条款`,
      issue: summary,
      consequence: "关键风险分配或治理机制缺失，可能影响履约、融资、争议处理或核心资产归属。",
      suggestion: `补充完整的${type}条款，并与合同类型、我方角色和交易背景匹配。`,
      proposedClauseText: `请补充${type}条款，明确义务主体、适用范围、触发条件、例外事项、违约后果和终止后处理。`,
      negotiationBottomLine: `至少补充可执行的${type}机制，避免仅作原则性表述。`,
      acceptableFallback: `可先补充简版${type}条款，并在附件或订单中细化执行细节。`,
      linkedClauseIds: [],
      qualityScore: 70,
    }));
}

function completionScore(clauses, contractType) {
  const present = new Set(clauses.map((clause) => clause.type || classifyClause(clause.text, clause.title)));
  const core = /股东协议|公司治理/.test(contractType)
    ? ["出资与股权", "公司治理", "创始人限制", "股权转让", "投资人权利", "知识产权", "保密", "违约责任", "争议解决"]
    : ["服务范围", "付款", "知识产权", "数据使用", "保密", "违约责任", "争议解决"];
  return Math.round((core.filter((type) => present.has(type)).length / core.length) * 100);
}

function buildResult(payload) {
  const request = payload.request || payload;
  const text = request.contract_text || "";
  const clauses = Array.isArray(request.clauses) && request.clauses.length
    ? request.clauses.map((clause, index) => ({ ...clause, type: clause.type || classifyClause(clause.text, clause.title), number: clause.number || index + 1 }))
    : splitClauses(text);
  const contractType = classifyContract(text, request.contract_type);
  const clauseAnalyses = clauses.flatMap((clause) => analyzeClause(clause, contractType));
  const contractLevel = contractLevelRisks(clauses, contractType);
  const all = [...contractLevel, ...clauseAnalyses];
  const riskLevel = all.some((item) => normalizeSeverity(item.severity) === "high") ? "high" : all.some((item) => normalizeSeverity(item.severity) === "medium") ? "medium" : "low";
  return {
    response: {
      contractSummary: {
        contractName: request.contract_name || "",
        contractType,
        purpose: request.business_background || (/股东协议|公司治理/.test(contractType) ? "规范股东权利义务、公司治理、股权流转和创始人/投资人安排。" : "规范双方交易权利义务。"),
        ourRole: request.represented_party || "",
        counterparty: request.counterparty || "",
        riskLevel,
        completionScore: completionScore(clauses, contractType),
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
      contractLevelRisks: contractLevel,
      clauseAnalyses,
      missingFacts: [
        request.represented_party ? null : "我方角色",
        request.business_background ? null : "交易背景和商业目的",
        /股东协议|公司治理/.test(contractType) ? "公司基本情况、股权结构、投资轮次、各方持股比例和控制权诉求" : null,
      ].filter(Boolean),
      businessSummary: `${contractType} 当前整体风险为 ${riskLevel}；识别条款 ${clauses.length} 条，合同级待补事项 ${contractLevel.length} 项，条款级风险 ${clauseAnalyses.length} 项。`,
    },
  };
}

readStdin()
  .then((input) => {
    const payload = JSON.parse(input || "{}");
    process.stdout.write(JSON.stringify(buildResult(payload), null, 2));
  })
  .catch((error) => {
    process.stderr.write(error.stack || String(error));
    process.exit(1);
  });
