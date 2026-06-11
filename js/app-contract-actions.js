function setActiveContract(contractId) {
  Store.mutate("set-active-contract", (draft) => {
    draft.activeContractId = contractId;
    draft.activeClauseId = draft.clauses.find((clause) => clause.contractId === contractId)?.id || null;
    const updates = getContractUpdates(contractId);
    draft.activeUpdateId = updates.at(-1)?.id || null;
  });
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      activeContractId: state.activeContractId,
      activeClauseId: state.activeClauseId,
      activeUpdateId: state.activeUpdateId,
    }).catch(() => {});
  }
}

function ensureInitialUpdate(targetState, contract) {
  targetState.updates = targetState.updates || [];
  const exists = targetState.updates.some((item) => item.contractId === contract.id && item.type === "初稿上传");
  if (exists) return;
  targetState.updates.push({
    id: uid("upd"),
    contractId: contract.id,
    type: "初稿上传",
    note: "通过新建审阅上传合同初稿。",
    materialKind: contract.initialMaterialKind || "version",
    versionText: contract.redlineText || contract.cleanText || contract.text || "",
    acceptedText: contract.cleanText || contract.text || "",
    rejectedText: contract.rejectedText || "",
    revisionText: contract.redlineText || contract.cleanText || contract.text || "",
    commentsText: contract.commentsText || "",
    paragraphs: contract.paragraphs || [],
    sourceType: contract.sourceType || "text",
    fileName: contract.fileName || "",
    feedbackDeadline: contract.feedbackDeadline || "",
    knowledgeEligible: false,
    hasClean: false,
    hasRedline: Boolean(contract.redlineText),
    hasComments: Boolean(contract.commentsText),
    createdAt: contract.createdAt || today(),
  });
}

function scheduleAutomaticCodexReview(contractId, reason = "auto") {
  const contract = state.contracts.find((item) => item.id === contractId);
  if (!contract) return;
  const material = getWorkbenchMaterial(contract);
  if (!material?.text?.trim()) return;
  const jobKey = material.sourceKey || contract.id;
  const existing = (state.autoReviewJobs || {})[jobKey];
  if (["queued", "running"].includes(existing?.status) && !isStaleCodexJob(existing, STALE_JOB_TIMEOUT_MS)) return;
  Store.mutate("queue-auto-review", (draft) => {
    draft.autoReviewJobs = draft.autoReviewJobs || {};
    draft.autoReviewJobs[jobKey] = {
      status: "queued",
      reason,
      message: "AI 自动审阅已排队",
      queuedAt: new Date().toISOString(),
    };
  });
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      autoReviewJobs: state.autoReviewJobs,
    }).catch(() => {});
  }
  saveState();
  setTimeout(() => runAutomaticCodexReview(contractId, jobKey, reason), 0);
  return;
  state.autoReviewJobs[jobKey] = {
    status: "queued",
    reason,
    message: "AI 自动审阅已排队",
    queuedAt: new Date().toISOString(),
  };
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      autoReviewJobs: state.autoReviewJobs,
    }).catch(() => {});
  }
  saveState();
  setTimeout(() => runAutomaticCodexReview(contractId, jobKey, reason), 0);
}

function isStaleCodexJob(job, maxAgeMs) {
  const updatedAt = [job?.updatedAt, job?.startedAt, job?.queuedAt]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0];
  return Boolean(updatedAt && Date.now() - updatedAt > maxAgeMs);
}

async function runAutomaticCodexReview(contractId, expectedSourceKey, reason = "auto") {
  const contract = state.contracts.find((item) => item.id === contractId);
  if (!contract) return;
  const material = getWorkbenchMaterial(contract);
  const jobKey = material.sourceKey || contract.id;
  if (expectedSourceKey && jobKey !== expectedSourceKey) return;
  Store.mutate("start-auto-review", (draft) => {
    draft.autoReviewJobs = draft.autoReviewJobs || {};
    draft.autoReviewJobs[jobKey] = {
      ...(draft.autoReviewJobs[jobKey] || {}),
      status: "running",
      reason,
      message: "AI 正在自动进行条款切分与审阅分析",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }, { save: false });
  if (typeof persistBackendAuxState === "function") {
    persistBackendAuxState({
      autoReviewJobs: state.autoReviewJobs,
    }).catch(() => {});
  }
  setAnalysisStatus(contract.id, "queued", "AI 宸茶嚜鍔ㄥ紑濮嬪悎鍚屽闃呭垎鏋愶紝骞朵細鍚屾椂杩斿洖鏉℃鍒囧垎...");
  saveState();
  renderReview();
  try {
    setAnalysisStatus(contract.id, "queued", "AI 姝ｅ湪鑷姩杩愯 Legal Skill 瀹￠槄鍒嗘瀽...");
    const result = await runLegalSkillAnalysis(contract, material.text);
    if (state.activeContractId !== contract.id) return;
    if (getWorkbenchMaterial(contract).sourceKey !== jobKey) {
      Store.mutate("supersede-auto-review", (draft) => {
        draft.autoReviewJobs = draft.autoReviewJobs || {};
        draft.autoReviewJobs[jobKey] = {
          status: "superseded",
          reason,
          message: "当前版本已切换，本次自动审阅结果未写入",
          completedAt: new Date().toISOString(),
        };
      });
      if (typeof persistBackendAuxState === "function") {
        persistBackendAuxState({
          autoReviewJobs: state.autoReviewJobs,
        }).catch(() => {});
      }
      saveState();
      return;
    }
    applyLegalSkillResult(contract, result, splitVersionClauses(material.text, material.sourceKey));
    const prepared = await ensureAnalysisHasCodexSegmentation(contract);
    const clauses = splitVersionClauses(prepared.text, prepared.sourceKey);
    Store.mutate("complete-auto-review", (draft) => {
      draft.findings = (draft.findings || []).filter((finding) => finding.contractId !== contract.id);
      draft.findings.push(...getStoredSkillFindings(contract, clauses));
      draft.autoReviewJobs = draft.autoReviewJobs || {};
      draft.autoReviewJobs[jobKey] = {
        status: "completed",
        reason,
        message: "AI 自动审阅分析已完成",
        completedAt: new Date().toISOString(),
      };
    }, { save: false });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        autoReviewJobs: state.autoReviewJobs,
        findings: state.findings,
      }).catch(() => {});
    }
    recordAudit("鑷姩杩愯 AI Legal Skill 鍒嗘瀽", { contractName: contract.name, note: reason });
    saveState();
    renderReview();
    showToast("AI 宸茶嚜鍔ㄥ畬鎴愬闃呭垎鏋愩€?");
  } catch (error) {
    Store.mutate("fail-auto-review", (draft) => {
      draft.autoReviewJobs = draft.autoReviewJobs || {};
      draft.autoReviewJobs[jobKey] = {
        status: "failed",
        reason,
        message: error.message || String(error),
        failedAt: new Date().toISOString(),
      };
    }, { save: false });
    if (typeof persistBackendAuxState === "function") {
      persistBackendAuxState({
        autoReviewJobs: state.autoReviewJobs,
      }).catch(() => {});
    }
    setAnalysisStatus(contract.id, "failed", error.message || String(error));
    saveState();
    renderReview();
    showToast(`AI 鑷姩瀹￠槄澶辫触锛?{error.message || String(error)}`, "error");
  }
}

async function ensureAnalysisHasCodexSegmentation(contract) {
  let material = getWorkbenchMaterial(contract);
  const status = getClauseSegmentationStatus(material.text, material.sourceKey);
  if (status.source === "ai") return material;
  setAnalysisStatus(contract.id, "queued", "完整审阅未返回可用条款切分，正在补跑 AI 语义切分...");
  await ensureCodexSegmentation(contract, material);
  material = getWorkbenchMaterial(contract);
  const repaired = getClauseSegmentationStatus(material.text, material.sourceKey);
  if (repaired.source !== "ai") throw new Error("AI 审阅结果缺少可用条款切分，且补充切分未完成。");
  return material;
}

async function autofillNewReviewFromLocalRules() {
  const form = document.querySelector("#upload-form");
  const statusNode = document.querySelector("#new-review-autofill-status");
  const textNode = document.querySelector("#clean-text-input");
  const fileInput = document.querySelector("#clean-file-input");
  try {
    if (statusNode) statusNode.textContent = "正在用本地规则快速识别...";
    let text = textNode.value.trim();
    if (!text && fileInput?.files?.[0]) {
      const result = await readUploadedFile(fileInput.files[0]);
      cacheUploadedFileResult(textNode, result);
      textNode.value = result.displayText || "";
      text = textNode.value.trim();
    }
    if (!text) {
      if (statusNode) statusNode.textContent = "请先上传文件或粘贴合同正文";
      return;
    }
    const parsed = inferNewReviewFields(text);
    fillIfEmpty("#contract-name-input", parsed.name);
    fillIfEmpty("#counterparty-input", parsed.counterparty);
    fillIfEmpty("#party-role-input", parsed.ourRole);
    fillIfEmpty("#contract-type-input", parsed.type);
    fillIfEmpty("#contract-background-input", parsed.background);
    fillIfEmpty("#contract-jurisdiction-input", "待确认");
    if (form) {
      form.dataset.detectedContractType = parsed.type || "";
      form.dataset.detectedPurpose = parsed.purpose || "";
      form.dataset.detectedJurisdiction = "待确认";
      form.dataset.detectedMissingFacts = "";
    }
    if (statusNode) {
      const type = parsed.type || "合同类型待确认";
      const jurisdiction = form?.dataset.detectedJurisdiction || "待确认";
      const party = parsed.counterparty ? ` | 相对方 ${parsed.counterparty}` : "";
      statusNode.textContent = `本地规则已识别：${type} | 法域 ${jurisdiction}${party}`;
    }
  } catch (error) {
    if (statusNode) statusNode.textContent = `本地快速填充失败：${error.message || error}`;
  }
}
async function autofillNewReviewFromMaterial() {
  const form = document.querySelector("#upload-form");
  const statusNode = document.querySelector("#new-review-autofill-status");
  const textNode = document.querySelector("#clean-text-input");
  const fileInput = document.querySelector("#clean-file-input");
  try {
    if (statusNode) statusNode.textContent = "正在让 AI 阅读合同并填充信息...";
    let text = textNode.value.trim();
    if (!text && fileInput?.files?.[0]) {
      const result = await readUploadedFile(fileInput.files[0]);
      cacheUploadedFileResult(textNode, result);
      textNode.value = result.displayText || "";
      text = textNode.value.trim();
    }
    if (!text) {
      if (statusNode) statusNode.textContent = "请先上传文件或粘贴合同正文";
      return;
    }
    const result = await runContractIntake(text);
    const intake = result?.intake || {};
    fillIfEmpty("#contract-name-input", intake.contractName);
    fillIfEmpty("#counterparty-input", intake.counterparty);
    fillIfEmpty("#party-role-input", intake.ourRole);
    fillIfEmpty("#contract-type-input", intake.contractType);
    fillIfEmpty("#contract-background-input", intake.businessBackground);
    fillIfEmpty("#contract-jurisdiction-input", intake.jurisdiction || "待确认");
    if (form) {
      form.dataset.detectedContractType = intake.contractType || "";
      form.dataset.detectedPurpose = intake.purpose || "";
      form.dataset.detectedJurisdiction = intake.jurisdiction || "待确认";
      form.dataset.detectedMissingFacts = Array.isArray(intake.missingFacts) ? intake.missingFacts.join("，") : "";
      form.dataset.detectedPromptVersion = intake.promptVersion || "";
      form.dataset.detectedSource = intake.source || "";
    }
    if (statusNode) {
      const confidence = Number.isFinite(Number(intake.confidence)) ? ` | 置信度 ${Math.round(Number(intake.confidence))}%` : "";
      const type = intake.contractType || "合同类型待确认";
      const jurisdiction = intake.jurisdiction || "待确认";
      const party = intake.counterparty ? ` | 相对方 ${intake.counterparty}` : "";
      const missing = Array.isArray(intake.missingFacts) && intake.missingFacts.length ? ` | 待补充 ${intake.missingFacts.length} 项` : "";
      const sourceMeta = intake.source ? ` | 来源 ${intake.source}` : "";
      const promptMeta = intake.promptVersion ? ` | ${intake.promptVersion}` : "";
      statusNode.textContent = `AI 已识别：${type} | 法域 ${jurisdiction}${party}${confidence}${missing}${sourceMeta}${promptMeta}`;
    }
  } catch (error) {
    if (statusNode) statusNode.textContent = `AI 信息填充失败：${error.message || error}`;
  }
}
function fillIfEmpty(selector, value) {
  const node = document.querySelector(selector);
  if (!node || !value) return;
  if (!node.value.trim()) node.value = value;
}

function inferNewReviewFields(text) {
  const normalized = String(text || "").replace(/\r/g, "").trim();
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const usefulLines = lines.filter((line) => !isLikelyDocumentControlLine(line));
  const name = inferContractName(usefulLines) || `${classifyContract(normalized)}审阅`;
  const parties = inferContractParties(usefulLines);
  const type = classifyContract(normalized);
  const purpose = inferContractPurpose(type, normalized, name);
  return {
    name,
    type,
    purpose,
    counterparty: parties.counterparty,
    ourRole: parties.ourRole,
    background: buildInferredBackground(type, purpose, parties, usefulLines),
  };
}

function isLikelyDocumentControlLine(line) {
  const compact = String(line || "").replace(/\s+/g, "");
  return /^(严格保密|保密|机密|confidential|strictlyconfidential|draft|草稿|草稿版)$/i.test(compact) || /仅供|不得外传|未经.*不得/.test(compact);
}

function inferContractName(lines) {
  const candidates = lines.slice(0, 30).filter((line) => /合同|协议|订单|备忘录|条款书|NDA/i.test(line));
  const title = candidates.find((line) => line.length <= 40 && !/[：:]/.test(line)) || candidates[0] || lines[0] || "";
  return cleanupExtractedValue(title).slice(0, 60);
}

function inferContractParties(lines) {
  const joined = lines.slice(0, 80).join("\n");
  const partyA = extractPartyName(joined, "甲方") || extractPartyName(joined, "披露方") || extractPartyName(joined, "提供方");
  const partyB = extractPartyName(joined, "乙方") || extractPartyName(joined, "接收方") || extractPartyName(joined, "服务方");
  const company = extractCompanyNames(joined);
  const counterparty = partyB || partyA || company[0] || "";
  const ourRole = partyA && partyB ? `甲方（请确认我方是否为 ${partyA}）` : partyA ? "甲方（请确认）" : "";
  return { partyA, partyB, counterparty, ourRole };
}

function extractPartyName(text, label) {
  const pattern = new RegExp(`${label}\\s*[：:]\\s*([^\\n；;，,]{2,80})`);
  const match = String(text || "").match(pattern);
  return cleanupExtractedValue(match?.[1] || "");
}

function extractCompanyNames(text) {
  const matches = String(text || "").match(/[\u4e00-\u9fa5A-Za-z0-9（）()·]{2,60}(?:公司|有限合伙|企业|机构|中心|大学|研究院|事务所)/g) || [];
  return [...new Set(matches.map(cleanupExtractedValue).filter(Boolean))];
}

function cleanupExtractedValue(value) {
  return String(value || "")
    .replace(/^[：:]?(以下简称|以下称|称为).*?[：:]/g, "")
    .replace(/[；;。].*$/g, "")
    .replace(/["“”‘’]/g, "")
    .trim();
}

function inferContractPurpose(type, text, name) {
  const context = `${name}\n${text.slice(0, 1500)}`;
  if (/保密|NDA|Confidential/i.test(context)) return "约定双方在项目接触、合作洽谈或资料交换过程中的保密义务";
  if (/股东|投资|增资|股权|公司治理/.test(context)) return "约定股权投资、股东权利义务及公司治理安排";
  if (/SaaS|API|软件|平台|服务/.test(context)) return "采购或提供软件、SaaS/API 或技术服务";
  if (/数据|模型|训练|算法/.test(context)) return "约定数据、模型、算法或相关技术合作安排";
  return `处理${type || "本合同"}相关交易安排`;
}

function buildInferredBackground(type, purpose, parties, lines) {
  const firstRecital = lines.find((line) => /鉴于|背景|合作目的|项目/.test(line) && line.length <= 120);
  return [
    `系统根据上传文件初步识别：合同类型为${type || "待确认"}。`,
    parties.counterparty ? `相对方可能为：${parties.counterparty}。` : "",
    `合同目的可能为：${purpose}。`,
    firstRecital ? `文件中的背景线索：${firstRecital}` : "请补充商业背景、核心诉求、谈判重点或业务底线。",
  ]
    .filter(Boolean)
    .join("\n");
}
