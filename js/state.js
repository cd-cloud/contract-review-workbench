const STORAGE_KEY = "legal-contract-workbench-mvp";
const MAX_AUDIT_LOGS = 500;
const uploadedFileCache = new Map();

const clauseTypes = [
  "服务范围",
  "交付与验收",
  "付款",
  "知识产权",
  "数据使用",
  "个人信息保护",
  "保密",
  "陈述与保证",
  "合规承诺",
  "违约责任",
  "责任限制",
  "赔偿",
  "期限与终止",
  "争议解决",
  "通知",
  "其他",
];

const sampleContract = `AI SaaS 服务协议

第一条 服务内容
乙方向甲方提供智能客服 SaaS 系统及 API 调用服务，服务内容以订单和后台开通功能为准。

第二条 费用与付款
甲方应在收到发票后六十日内支付服务费。逾期付款的，每逾期一日按未付款项的万分之一支付违约金。

第三条 数据与模型
甲方上传的数据归甲方所有。乙方可为改进服务目的使用甲方输入数据及输出内容，但双方未另行约定数据是否可用于模型训练。

第四条 个人信息保护
如服务涉及个人信息处理，双方应遵守适用法律规定，但本协议未明确个人信息处理目的、处理方式、安全措施及删除机制。

第五条 知识产权
乙方平台、模型、算法、软件及相关知识产权归乙方所有。甲方因使用服务产生的业务数据归甲方所有。

第六条 保密
双方对在合作过程中获知的商业秘密和非公开信息承担保密义务，保密期限为协议终止后三年。

第七条 责任限制
任何一方在本协议项下的累计赔偿责任不超过甲方过去三个月已支付服务费。

第八条 期限与终止
协议有效期一年。任何一方提前三十日书面通知可终止协议。

第九条 争议解决
因本协议产生的争议，提交乙方所在地人民法院管辖。

第十条 通知
双方通知以合同首页载明的电子邮件或书面地址发出。`;

const seedData = {
  activeContractId: "contract-demo",
  activeClauseId: null,
  contracts: [
    {
      id: "contract-demo",
      name: "示例：智能客服 SaaS 服务协议",
      type: "SaaS 服务合同",
      purpose: "采购 AI SaaS 系统及 API 调用服务",
      businessBackground: "客户采购智能客服 SaaS 及 API 调用服务，重点关注客户数据是否可用于模型训练、服务稳定性、责任上限和争议解决安排。",
      status: "审阅中",
      ourRole: "服务提供方",
      counterpartyId: "cp-starry",
      counterpartyName: "星河智能科技有限公司",
      amount: "未识别",
      term: "一年",
      payment: "收到发票后六十日",
      jurisdiction: "待确认",
      governingLaw: "待确认",
      dispute: "乙方所在地人民法院管辖",
      text: sampleContract,
      cleanText: sampleContract,
      redlineText: `AI SaaS 服务协议

第三条 数据与模型
甲方上传的数据归甲方所有。乙方仅可为提供、维护和安全保障本服务之目的处理甲方数据。未经甲方事先书面同意，乙方不得将甲方输入数据、输出内容或业务数据用于通用模型训练。

第七条 责任限制
任何一方在本协议项下的累计赔偿责任不超过甲方过去六个月已支付服务费；但保密义务、知识产权侵权、数据安全事件、故意或重大过失不适用该责任上限。`,
      commentsText: `客户邮件摘要：
1. 客户要求明确乙方不得使用客户数据训练通用模型。
2. 客户希望责任上限提高至十二个月服务费。
3. 业务可接受六个月责任上限，但要求保留间接损失排除。
4. 请法务确认个人信息处理附件是否必须签署。`,
      clauseSource: "clean",
      riskLevel: "high",
      aiTags: ["API 调用", "模型训练", "个人信息", "客户数据"],
      createdAt: "2026-05-21",
      updatedAt: "2026-05-21",
    },
  ],
  clauses: [],
  findings: [],
  counterparties: [
    {
      id: "cp-starry",
      name: "星河智能科技有限公司",
      type: "客户",
      industry: "企业软件",
      importance: "重要",
      riskLevel: "medium",
      notes: "历史上较关注责任上限和数据使用范围，接受过乙方所在地法院管辖。",
    },
  ],
  negotiations: [
    {
      id: "neg-demo",
      contractId: "contract-demo",
      counterpartyId: "cp-starry",
      clauseId: null,
      round: 1,
      counterpartyPosition: "要求将责任上限提高至十二个月服务费。",
      ourResponse: "建议接受六个月服务费作为折中，但数据侵权、保密和故意违约不适用责任上限。",
      finalResult: "待谈判",
      concession: "部分让步",
      reason: "客户金额较大，商业上可接受有限提高责任上限。",
      decisionMaker: "业务负责人确认",
      captured: true,
      createdAt: "2026-05-21",
    },
  ],
  updates: [
    {
      id: "upd-demo",
      contractId: "contract-demo",
      type: "对方反馈",
      note: "客户邮件要求明确不得使用客户数据训练通用模型，并要求提高责任上限。",
      hasClean: false,
      hasRedline: false,
      hasComments: true,
      createdAt: "2026-05-21",
    },
  ],
  playbooks: [
    {
      id: "pb-data-use",
      type: "数据使用",
      contractTypes: ["SaaS 服务合同", "数据采购合同", "模型训练合作协议"],
      ourRole: "服务提供方",
      standard: "未经客户事先书面同意，服务提供方不得将客户数据用于通用模型训练；仅可在提供、维护、改进本客户服务的必要范围内处理客户数据。",
      fallback: "可使用经匿名化、去标识化且无法识别客户或个人的数据用于产品安全、性能优化和统计分析。",
      forbidden: "服务提供方可不受限制地使用客户输入、输出及业务数据训练或优化任何模型。",
      negotiation: "优先区分客户业务数据、个人信息、匿名化统计数据和模型改进数据，避免笼统授权。",
      usageCount: 3,
      updatedAt: "2026-05-21",
    },
    {
      id: "pb-liability-cap",
      type: "责任限制",
      contractTypes: ["SaaS 服务合同", "技术服务合同"],
      ourRole: "服务提供方",
      standard: "任一方累计赔偿责任以过去十二个月已支付或应支付费用为限，但保密、知识产权侵权、数据安全、故意或重大过失责任除外。",
      fallback: "任一方累计赔偿责任以过去六个月已支付费用为限，核心例外事项不适用责任上限。",
      forbidden: "任何情况下服务方均不承担任何赔偿责任，或所有责任均以三个月费用为绝对上限且无例外。",
      negotiation: "金额过低时容易被客户拒绝，可用六个月或十二个月费用换取明确间接损失排除。",
      usageCount: 5,
      updatedAt: "2026-05-21",
    },
  ],
  riskRules: [
    {
      id: "rr-data-training",
      type: "数据使用",
      title: "模型训练授权边界不清",
      severity: "high",
      actionType: "revise_clause",
      pattern: "训练|模型|输入|输出|数据",
      missingPattern: "书面同意|匿名化|去标识化|不得",
      issue: "条款允许或暗示可使用客户输入、输出或业务数据，但未明确模型训练、产品优化和匿名化统计的边界。",
      suggestion: "明确未经客户书面同意不得将客户数据用于通用模型训练；仅可在服务提供、维护、安全和性能优化必要范围内处理。",
      status: "active",
      source: "高频审阅规则",
      createdAt: "2026-05-23",
    },
    {
      id: "rr-liability-cap-exception",
      type: "责任限制",
      title: "责任上限缺少核心例外",
      severity: "medium",
      actionType: "revise_clause",
      pattern: "责任|赔偿|不超过|上限",
      missingPattern: "保密|知识产权|故意|重大过失|数据",
      issue: "责任限制条款未排除保密、知识产权、数据安全、故意或重大过失等核心风险。",
      suggestion: "补充责任上限例外，至少排除保密义务、知识产权侵权、数据安全事件、故意或重大过失。",
      status: "active",
      source: "高频审阅规则",
      createdAt: "2026-05-23",
    },
    {
      id: "rr-personal-info-dpa",
      type: "个人信息保护",
      title: "个人信息处理安排不足",
      severity: "high",
      actionType: "revise_clause",
      pattern: "个人信息|隐私|用户信息",
      missingPattern: "处理目的|安全措施|删除|返还|委托处理|分包",
      issue: "条款仅笼统要求遵守法律，缺少个人信息处理目的、方式、安全措施、删除返还和协助义务。",
      suggestion: "补充个人信息处理附件或数据处理协议，明确处理目的、范围、期限、安全措施、分包、删除返还和事件通知机制。",
      status: "active",
      source: "高频审阅规则",
      createdAt: "2026-05-23",
    },
  ],
  auditLogs: [],
  aiSuggestionFeedback: [],
  auditLogsCollapsed: true,
  expandedTreeNodes: {},
  contractRiskDecisions: {},
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const normalized = normalizeWorkbenchState(parsed);
      if (normalized) return normalized;
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  const state = clone(seedData);
  hydrateContractAnalysis(state, state.contracts[0]);
  writeLocalState(state);
  return state;
}

function writeLocalState(nextState = state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  } catch (error) {
    // Debug: localStorage write failed
  }
}

function saveState(nextState = state, options = {}) {
  nextState.storageMeta = nextState.storageMeta || {};
  if (!options.preserveUpdatedAt) {
    nextState.storageMeta.updatedAt = new Date().toISOString();
    nextState.storageMeta.source = "browser-cache";
  }
  writeLocalState(nextState);
  if (!options.localOnly) {
    scheduleBackendSync(clone(nextState));
  }
}

function normalizeWorkbenchState(candidate) {
  if (!candidate?.contracts || !candidate?.clauses || !candidate?.findings) return null;
  const parsed = clone(candidate);
  delete parsed.currentView;
  parsed.updates = parsed.updates || [];
  parsed.contracts.forEach((contract) => {
    contract.cleanText = contract.cleanText || contract.text || "";
    contract.redlineText = contract.redlineText || "";
    contract.commentsText = contract.commentsText || "";
    contract.businessBackground = contract.businessBackground || "";
    contract.clauseSource = contract.clauseSource || "draft";
    contract.owner = contract.owner || "";
    contract.workflowStatus = contract.workflowStatus || contract.status || "初审";
  });
  parsed.clauseActions = parsed.clauseActions || {};
  parsed.analysisRequests = parsed.analysisRequests || {};
  parsed.insertedClauses = parsed.insertedClauses || {};
  parsed.insertionAudits = parsed.insertionAudits || {};
  parsed.clauseOrder = parsed.clauseOrder || {};
  parsed.subclauseOrder = parsed.subclauseOrder || {};
  parsed.subclauseMoves = parsed.subclauseMoves || [];
  parsed.subclauseReferenceMap = parsed.subclauseReferenceMap || {};
  parsed.legalSkillResults = parsed.legalSkillResults || {};
  parsed.visualQaJobs = parsed.visualQaJobs || {};
  parsed.visualQaReports = parsed.visualQaReports || {};
  parsed.visualQaAutoFixAudits = parsed.visualQaAutoFixAudits || {};
  parsed.riskRules = parsed.riskRules || clone(seedData.riskRules || []);
  parsed.auditLogs = parsed.auditLogs || [];
  parsed.aiSuggestionFeedback = parsed.aiSuggestionFeedback || [];
  parsed.auditLogsCollapsed = parsed.auditLogsCollapsed !== false;
  parsed.expandedTreeNodes = parsed.expandedTreeNodes || {};
  parsed.readerPaneTabs = parsed.readerPaneTabs || {};
  parsed.contractRiskDecisions = parsed.contractRiskDecisions || {};
  parsed.storageMeta = parsed.storageMeta || {};
  parsed.playbooks = (parsed.playbooks || []).map(normalizePlaybook);
  parsed.contracts.forEach((contract) => ensureInitialUpdate(parsed, contract));
  return parsed;
}

function replaceWorkbenchState(nextState, options = {}) {
  const normalized = normalizeWorkbenchState(nextState);
  if (!normalized) return false;
  state = normalized;
  state.storageMeta = {
    ...(state.storageMeta || {}),
    source: options.source || "backend",
    hydratedAt: new Date().toISOString(),
  };
  saveState(state, { localOnly: true, preserveUpdatedAt: true });
  return true;
}

function recordAudit(action, details = {}) {
  if (!state) return;
  state.auditLogs = state.auditLogs || [];
  state.auditLogs.unshift({
    id: uid("audit"),
    action,
    details,
    userId: "local-admin",
    createdAt: new Date().toISOString(),
  });
  state.auditLogs = state.auditLogs.slice(0, MAX_AUDIT_LOGS);
}
