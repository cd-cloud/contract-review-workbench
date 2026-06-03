function extractInfo(contract, text) {
  const amount = text.match(/(?:人民币|RMB|¥)\s*([0-9,.]+万?元?)/i)?.[0] || "未识别";
  const term = text.match(/有效期[为：:]?([^。；\n]+)/)?.[1] || text.match(/期限[为：:]?([^。；\n]+)/)?.[1] || "未识别";
  const payment = text.match(/(?:付款|支付|账期)[^。；\n]{0,60}/)?.[0] || "未识别";
  const dispute = text.match(/(?:争议|管辖|仲裁|法院)[^。；\n]{0,90}/)?.[0] || "未识别";
  const purpose = contract.type === "SaaS 服务合同" ? "采购或提供 AI SaaS / API 服务" : `处理${contract.type}相关交易`;
  return { amount, term, payment, dispute, purpose };
}

function generateFindings(contract, clauses, sourceState = null) {
  // Browser fallback used when no stored Legal Skill result is available.
  // Keep the output shape aligned with the real skill response.
  const findings = [];
  const add = (clause, severity, title, issue, consequence, fix, negotiation) => {
    findings.push({
      id: uid("finding"),
      contractId: contract.id,
      clauseId: clause?.id || null,
      title,
      severity,
      issue,
      consequence,
      fix,
      negotiation,
      needsBusiness: severity !== "low",
      needsManagement: severity === "high",
      status: "待处理",
    });
    if (clause) clause.riskLevel = severity;
  };

  for (const clause of clauses) {
    const text = clause.text;
    if (clause.type === "数据使用" && /训练|模型|输入|输出|数据/.test(text) && !/书面同意|匿名化|去标识化|不得/.test(text)) {
      add(
        clause,
        "high",
        "数据使用授权边界不清",
        "条款允许或暗示可使用客户输入、输出或业务数据，但未区分服务必要处理、产品优化、模型训练和匿名化统计。",
        "可能引发客户数据权属、个人信息保护、商业秘密及模型训练合规争议。",
        "明确未经客户书面同意不得将客户数据用于通用模型训练；仅可在服务提供、维护、安全和性能优化必要范围内处理。",
        "可将匿名化、去标识化统计数据作为让步空间，但避免直接取得无限制训练授权。"
      );
    }
    if (clause.type === "个人信息保护" && !/处理目的|安全措施|删除|返还|委托处理/.test(text)) {
      add(
        clause,
        "high",
        "个人信息处理安排不足",
        "条款仅笼统要求遵守法律，未明确处理目的、处理方式、安全措施、删除返还和协助义务。",
        "涉及客户数据或终端用户个人信息时，可能导致合规义务无法分配，事故响应责任不清。",
        "补充个人信息处理附件或数据处理协议，明确处理目的、范围、期限、安全措施、分包、删除返还和事件通知机制。",
        "如交易时间紧，可先加入附件补签机制和上线前确认清单。"
      );
    }
    if (clause.type === "责任限制" && /三个月|3个月|不超过/.test(text) && !/保密|知识产权|故意|重大过失|数据/.test(text)) {
      add(
        clause,
        "medium",
        "责任上限过低且缺少例外",
        "责任上限以三个月费用为限，且未排除保密、知识产权、数据安全、故意或重大过失等核心风险。",
        "可能导致重大违约或数据/IP风险下救济不足，也可能在客户谈判中被集中挑战。",
        "建议调整为六至十二个月费用，并列明保密、知识产权侵权、数据安全、故意或重大过失不适用责任上限。",
        "可用更明确的间接损失排除换取合理责任上限。"
      );
    }
    if (clause.type === "付款" && /六十日|60日|六十个工作日|60个工作日/.test(text)) {
      add(
        clause,
        "medium",
        "付款账期较长",
        "付款周期为收到发票后六十日，可能给创业公司现金流带来压力。",
        "回款周期变长，影响服务资源投入和客户违约时的暂停服务空间。",
        "建议改为三十日内付款，并增加逾期暂停服务、到期未付加速到期或预付款机制。",
        "若客户强势，可保留六十日账期但要求较高逾期违约金或服务暂停权。"
      );
    }
    if (clause.type === "期限与终止" && /任何一方.*三十日.*终止|提前三十日.*终止/.test(text)) {
      add(
        clause,
        "medium",
        "任意终止权影响收入确定性",
        "双方均可提前三十日无因终止，未区分便利终止、违约终止及已投入成本补偿。",
        "客户可在项目投入后提前退出，导致部署、实施或算力资源成本无法覆盖。",
        "建议约定便利终止需支付已发生费用、不可取消资源成本和已完成服务费用。",
        "可接受客户便利终止，但应锁定最低服务期或不可退费用。"
      );
    }
  }

  findings.push(...evaluateRiskRules(contract, clauses, sourceState));

  const presentTypes = new Set(clauses.map((clause) => clause.type));
  const contextText = `${contract.type || ""}\n${contract.name || ""}\n${contract.purpose || ""}\n${contract.businessBackground || ""}\n${clauses.map((clause) => clause.text).join("\n").slice(0, 1200)}`;
  const requiredTypes = ["争议解决"];
  if (/SaaS|软件|技术|开发|模型|算法|数据|API|平台|成果|知识产权|股权|投资/.test(contextText)) requiredTypes.push("知识产权");
  if (/服务|采购|SaaS|技术|交付|付款|赔偿|违约|数据|模型/.test(contextText)) requiredTypes.push("责任限制");
  if (/保密|NDA|技术|数据|商业秘密|前期信息|投资|股权|客户信息/.test(contextText)) requiredTypes.push("保密");
  const missing = [...new Set(requiredTypes)].filter((type) => !presentTypes.has(type));
  missing.forEach((type) => {
    add(
      null,
      type === "知识产权" || type === "责任限制" ? "medium" : "low",
      `缺少${type}条款`,
      `当前文本未识别到独立的${type}条款，但是否必须补充需要结合合同性质、交易背景和已有条款覆盖情况判断。`,
      "如该事项确属本交易的核心风险，缺少明确约定可能导致后续履约或争议处理依据不足。",
      `建议先核查已有定义、通用义务或相关条款是否已经覆盖${type}事项；如覆盖不足，再补充与合同类型、我方角色和交易背景匹配的${type}条款。`,
      "优先使用条款库中的平衡版本作为谈判起点；简单短式协议可记录为暂不补充的理由。"
    );
  });

  return findings;
}

function riskRank(level) {
  return { high: 3, medium: 2, low: 1 }[level] || 1;
}

function hydrateContractAnalysis(targetState, contract) {
  targetState.clauses = targetState.clauses.filter((clause) => clause.contractId !== contract.id);
  targetState.findings = targetState.findings.filter((finding) => finding.contractId !== contract.id);
  contract.cleanText = contract.cleanText || contract.text || "";
  contract.redlineText = contract.redlineText || "";
  contract.commentsText = contract.commentsText || "";
  contract.text = contract.cleanText || contract.redlineText || contract.commentsText || "";
  contract.type = classifyContract(contract.text);
  const info = extractInfo(contract, contract.text);
  Object.assign(contract, info);
  contract.aiTags = [
    /API|SaaS|平台/.test(`${contract.text}\n${contract.commentsText}`) ? "API / SaaS" : null,
    /训练|模型|微调/.test(`${contract.text}\n${contract.commentsText}`) ? "模型训练" : null,
    /个人信息|隐私/.test(`${contract.text}\n${contract.commentsText}`) ? "个人信息" : null,
    /数据/.test(`${contract.text}\n${contract.commentsText}`) ? "数据" : null,
    /知识产权|算法|软件/.test(`${contract.text}\n${contract.commentsText}`) ? "知识产权" : null,
  ].filter(Boolean);

  const clauses = splitClauses(contract.text, contract.id);
  clauses.forEach((clause) => {
    clause.sourceKind = contract.clauseSource || "draft";
  });
  const findings = generateFindings(contract, clauses, targetState);
  const maxRisk = findings.reduce((max, finding) => Math.max(max, riskRank(finding.severity)), 1);
  contract.riskLevel = maxRisk >= 3 ? "high" : maxRisk === 2 ? "medium" : "low";
  contract.updatedAt = today();
  targetState.clauses.push(...clauses);
  targetState.findings.push(...findings);
  targetState.activeClauseId = clauses[0]?.id || null;
}

function ensureCounterparty(name) {
  const trimmed = name.trim() || "未命名相对方";
  let counterparty = state.counterparties.find((item) => item.name === trimmed);
  if (!counterparty) {
    counterparty = {
      id: uid("cp"),
      name: trimmed,
      type: "客户",
      industry: "未分类",
      importance: "普通",
      riskLevel: "low",
      notes: "由合同审阅流程自动创建。",
    };
    state.counterparties.push(counterparty);
  }
  return counterparty;
}
