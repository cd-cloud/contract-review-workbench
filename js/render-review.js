function renderReviewModeControl(contract) {
  const mode = state.reviewMode || "clean";
  const revisionAvailable = canUseRevisionMode(contract);
  return `
    <div class="reader-tabs" style="margin-bottom:14px">
      <button class="reader-tab ${mode === "clean" && !state.comparisonMode ? "active" : ""}" type="button" data-review-mode="clean">清洁模式</button>
      <button class="reader-tab ${mode === "revision" && !state.comparisonMode ? "active" : ""}" type="button" data-review-mode="revision" ${revisionAvailable ? "" : "disabled"}>修订模式</button>
    </div>
    ${revisionAvailable ? "" : `<p class="muted">只有初稿时不能使用修订模式。</p>`}
  `;
}

let reviewAdviceSyncCleanup = null;
let reviewAdviceSyncFrame = null;
let reviewAdviceSyncTimers = [];
let reviewAdviceLastSyncedId = "";

let __lastRenderState = null;

function captureRenderState() {
  return {
    contractId: state.activeContractId,
    activeUpdateId: state.activeUpdateId,
    reviewMode: state.reviewMode,
    comparisonMode: state.comparisonMode,
    contractRiskCollapsed: state.contractRiskCollapsed,
    clausesHash: JSON.stringify(state.clauses || []),
    findingsHash: JSON.stringify(state.findings || []),
    clauseActionsHash: JSON.stringify(state.clauseActions || {}),
    activeWorkbenchClauseId: state.activeWorkbenchClauseId,
    activeSubclauseId: state.activeSubclauseId,
    inlineCommentClauseId: state.inlineCommentClauseId,
  };
}

function isRenderStateUnchanged(last) {
  if (!last) return false;
  const current = captureRenderState();
  return (
    last.contractId === current.contractId &&
    last.activeUpdateId === current.activeUpdateId &&
    last.reviewMode === current.reviewMode &&
    last.contractRiskCollapsed === current.contractRiskCollapsed &&
    last.clausesHash === current.clausesHash &&
    last.findingsHash === current.findingsHash &&
    last.clauseActionsHash === current.clauseActionsHash &&
    last.activeWorkbenchClauseId === current.activeWorkbenchClauseId &&
    last.activeSubclauseId === current.activeSubclauseId &&
    last.inlineCommentClauseId === current.inlineCommentClauseId
  );
}

function renderReview() {
  resetClauseRiskFindingCache();
  const contract = state.contracts.find((item) => item.id === state.activeContractId);
  if (!contract) {
    if (reviewAdviceSyncCleanup) { reviewAdviceSyncCleanup(); reviewAdviceSyncCleanup = null; }
    views.review.innerHTML = `<div class="empty">请先新建或打开一份合同。</div>`;
    __lastRenderState = null;
    return;
  }

  // Skip re-rendering if nothing that affects the review view has changed.
  if (isRenderStateUnchanged(__lastRenderState)) {
    return;
  }

  const workbenchMaterial = getWorkbenchMaterial(contract);
  const workbenchClauses = splitVersionClauses(workbenchMaterial.text, workbenchMaterial.sourceKey);
  if (views.review?.classList.contains("active")) scheduleCodexSegmentation(contract, workbenchMaterial);
  if (views.review?.classList.contains("active")) scheduleVisualQaOnReviewOpen(contract, workbenchMaterial);

  // Preserve focus and scroll before rebuilding DOM
  const activeEl = document.activeElement;
  const focusId = activeEl?.id || activeEl?.dataset?.clauseCard || activeEl?.dataset?.subclauseCard || null;
  const focusTag = activeEl?.tagName?.toLowerCase();
  const focusSelector = activeEl?.matches?.("[data-clause-card]") ? `[data-clause-card="${activeEl.dataset.clauseCard}"]`
    : activeEl?.matches?.("[data-subclause-card]") ? `[data-subclause-card="${activeEl.dataset.subclauseCard}"]`
    : focusId ? `#${focusId}` : null;
  const focusCursor = (focusTag === "input" || focusTag === "textarea") ? { start: activeEl?.selectionStart, end: activeEl?.selectionEnd } : null;
  const scrollTop = views.review?.scrollTop || 0;

  views.review.innerHTML = `
    <div class="review-grid">
      ${renderReviewTopTools(contract, workbenchMaterial, workbenchClauses)}
      <section class="review-main">
        <div class="panel contract-risk-panel ${state.contractRiskCollapsed ? "collapsed" : ""}">
          ${renderContractBrief(contract, workbenchMaterial, workbenchClauses)}
        </div>
        <div class="panel contract-text">
          <h3 class="section-title">材料阅读</h3>
          ${renderMaterialReader(contract)}
        </div>
      </section>
    </div>
  `;
  setupReviewAdviceScrollSync();

  // Restore scroll and focus after rebuilding DOM
  if (views.review && scrollTop > 0) {
    views.review.scrollTop = scrollTop;
  }
  if (focusSelector) {
    const restored = document.querySelector(focusSelector);
    if (restored) {
      restored.focus();
      if (focusCursor && typeof restored.setSelectionRange === "function") {
        restored.setSelectionRange(focusCursor.start, focusCursor.end);
      }
    }
  }

  __lastRenderState = captureRenderState();
}

function renderReviewTopTools(contract, material, clauses) {
  const structureMaterial = getStructureWorkbenchMaterial(contract);
  const structureClauses = structureMaterial.text === material.text
    ? clauses
    : splitVersionClauses(structureMaterial.text, structureMaterial.sourceKey);
  const codexStatus = getCodexRunStatus(contract, material);
  return `
    <section class="panel review-top-tools">
      ${renderReviewNoticeBanner(contract, material, clauses, codexStatus)}
      <div class="review-contract-identity">
        <p class="eyebrow">Contract</p>
        <h3 class="section-title">${escapeHtml(contract.name)}</h3>
        <div class="chips">
          <span class="tag contract-type-chip" title="${escapeHtml(contract.type)}">${escapeHtml(contract.type)}</span>
          <span class="risk ${escapeHtml(contract.riskLevel)}">风险${riskLabel(contract.riskLevel)}</span>
          ${contract.jurisdiction ? `<span class="status-pill">法域：${escapeHtml(contract.jurisdiction)}</span>` : ""}
          ${contract.counterpartyName ? `<span class="status-pill">相对方：${escapeHtml(contract.counterpartyName)}</span>` : ""}
        </div>
        <p class="muted contract-purpose-line" title="${escapeHtml(contract.purpose)}">目的：${escapeHtml(contract.purpose || "未填写")}</p>
        ${contract.businessBackground ? `<p class="muted contract-purpose-line" title="${escapeHtml(contract.businessBackground)}">背景：${escapeHtml(contract.businessBackground)}</p>` : ""}
      </div>
      <div class="review-top-tool-grid">
        ${renderReviewNextActions(contract, clauses, codexStatus, material)}
        ${renderContractStructureOverview(contract, structureMaterial, structureClauses)}
        <section class="review-utility-panel">
          <h3 class="section-title">审阅模式</h3>
          ${renderReviewModeControl(contract)}
          <h3 class="section-title">版本对比</h3>
          <button class="small-button ${state.comparisonMode ? "active" : ""}" type="button" data-toggle-comparison="true">
            ${state.comparisonMode ? "退出对比" : "版本对比视图"}
          </button>
          <p class="muted">对比当前版本与上一版本的条款差异。</p>
          <h3 class="section-title">版本时间线</h3>
          ${renderReviewTimeline(contract.id)}
        </section>
      </div>
    </section>
  `;
}

function renderReviewNoticeBanner(contract, material, clauses, codexStatus) {
  const notices = [];
  const legalSource = codexStatus?.legalResult?.source || "";
  const isFallback = /fallback/i.test(legalSource);
  if (isFallback) {
    notices.push({
      tone: "high",
      title: "当前结果为本地兜底模式",
      detail: "本次审阅结果未经过完整模型审阅，仅供参考。正式对外发送前，请由人工复核。",
    });
  }
  const clauseCount = Array.isArray(clauses) ? clauses.length : 0;
  if (String(material?.text || "").length > 90000 || clauseCount > 220) {
    notices.push({
      tone: "medium",
      title: "本次可能不是全文分析",
      detail: `当前材料长度为 ${String(material?.text || "").length} 字符、条款 ${clauseCount} 条。模型请求会对超长文本或过多条款做裁剪，请重点人工复核后半部分及复杂附件。`,
    });
  }
  if (!notices.length) return "";
  return `
    <div class="review-top-notices">
      ${notices.map((notice) => `
        <div class="panel review-notice notice-${escapeHtml(notice.tone)}">
          <strong>${escapeHtml(notice.title)}</strong>
          <p>${escapeHtml(notice.detail)}</p>
        </div>
      `).join("")}
    </div>
  `;
}

function scheduleVisualQaOnReviewOpen(contract, material) {
  // Opening the workbench should stay cheap. Local visual guards run in renderVisualQaPanel;
  // model-backed Agent B checks are triggered by AI result changes, export, or manual action.
}

function renderVisualQaPanel(sourceKey, contract = null, material = null, clauses = []) {
  if (typeof getVisualQaState !== "function") return "";
  const { job, report } = getVisualQaState(sourceKey);
  const localIssues = contract && material ? buildLocalVisualGuardIssues(contract, material, clauses) : [];
  const staleFallbackReport = report
    && report.source === "visual-qa-fallback"
    && report.status !== "pass"
    && !localIssues.length
    && !["queued", "running", "failed", "deferred"].includes(job?.status);
  const effectiveReport = staleFallbackReport ? null : report;
  const running = ["queued", "running"].includes(job?.status);
  const failed = job?.status === "failed";
  const deferred = job?.status === "deferred";
  const status = running ? "running" : failed ? "failed" : effectiveReport?.status || "pending";
  const issues = effectiveReport
    ? [
        ...(effectiveReport.displayIssues || []),
        ...(effectiveReport.structureIssues || []),
        ...(effectiveReport.suggestionPlacementIssues || []),
        ...(effectiveReport.numberingIssues || []),
        ...(effectiveReport.blockingExportIssues || []),
      ]
    : [];
  const high = issues.filter((item) => item.severity === "high").length;
  const medium = issues.filter((item) => item.severity === "medium").length;
  const safeFixes = (effectiveReport?.autoFixes || []).filter((fix) => fix.safeToApply && !fix.applied);
  const localHigh = localIssues.filter((item) => item.severity === "high").length;
  const localMedium = localIssues.filter((item) => item.severity === "medium").length;
  const label = status === "blocked" ? "阻断" : status === "needs_attention" ? "需关注" : status === "pass" ? "通过" : job?.status === "queued" ? "已排队" : running ? "检查中" : failed ? "失败" : deferred ? "已节流" : "待检查";
  return `
    <section class="visual-qa-panel">
      <div class="section-header-row">
        <div>
          <p class="eyebrow">Visual QA</p>
          <h3 class="section-title">审阅台一致性检查</h3>
        </div>
        <span class="risk ${status === "blocked" || high ? "high" : medium || failed ? "medium" : "low"}">${escapeHtml(label)}</span>
      </div>
      <p class="muted">${escapeHtml(running || failed || deferred ? formatReviewJobSummary(job, "visual") : effectiveReport?.summary || "Agent B 模型检查已改为手动、AI结果更新后或导出前运行；普通编辑只使用本地即时兜底。")}</p>
      <div class="row-actions">
        <button class="small-button" type="button" data-run-visual-qa="${escapeHtml(sourceKey)}" ${running ? "disabled" : ""}>运行 Agent B 检查</button>
      </div>
      <div class="local-guard-strip">
        <span>Agent B 即时兜底</span>
        <strong class="risk ${localHigh ? "high" : localMedium ? "medium" : "low"}">${localHigh ? `高 ${localHigh}` : localMedium ? `中 ${localMedium}` : "通过"}</strong>
      </div>
      ${localIssues.length ? `<ul class="qa-issue-list local-guard-list">${localIssues.slice(0, 3).map((item) => `<li><strong>${escapeHtml(item.title)}</strong><span class="muted">${escapeHtml(item.detail)}</span></li>`).join("")}</ul>` : ""}
      ${
        effectiveReport
          ? `<div class="chips">
              <span class="status-pill">高 ${high}</span>
              <span class="status-pill">中 ${medium}</span>
              <span class="status-pill">自动修复候选 ${safeFixes.length}</span>
            </div>
            ${safeFixes.length ? `<button class="small-button" type="button" data-apply-visual-qa-fixes="${escapeHtml(sourceKey)}">执行 ${safeFixes.length} 项安全修复</button>` : ""}
            ${issues.length ? `<ul class="qa-issue-list">${issues.slice(0, 4).map((item) => `<li><strong>${escapeHtml(item.title)}</strong><span class="muted">${escapeHtml(item.recommendation || item.detail)}</span></li>`).join("")}</ul>` : ""}`
          : ""
      }
    </section>
  `;
}

function buildLocalVisualGuardIssues(contract, material, clauses = []) {
  const issues = [];
  const actions = getClauseActions(material.sourceKey);
  const findings = getAnalysisFindings(contract, clauses);
  findings
    .filter((finding) => finding.placementWarning || (finding.placementConfidence !== undefined && finding.placementConfidence < 0.42))
    .slice(0, 3)
    .forEach((finding) => {
      issues.push({
        severity: finding.placementWarning ? "medium" : "low",
        title: "AI 建议归属已校验",
        detail: finding.placementWarning || `${finding.title || "该建议"} 与当前条款匹配度较低，建议复核归属。`,
      });
    });
  const seenBodies = new Map();
  clauses.forEach((clause) => {
    const textKey = normalizeText(getEditedClauseText(material.sourceKey, clause)).slice(0, 180);
    if (textKey && seenBodies.has(textKey)) {
      issues.push({
        severity: "medium",
        title: "发现疑似重复条款正文",
        detail: `${seenBodies.get(textKey)} 与 ${clause.title || clause.id} 的正文高度一致，请确认是否为父子条款重复展示。`,
      });
    } else if (textKey) {
      seenBodies.set(textKey, clause.title || clause.id);
    }
    if (!String(clause.title || "").trim() && String(clause.text || "").trim().length < 20) {
      issues.push({
        severity: "medium",
        title: "条款标题或正文过短",
        detail: "可能是切分或展示异常，建议等待 AI 切分完成后复核。",
      });
    }
    const action = actions[clause.id] || {};
    if (action.editedText && normalizeText(action.editedText) === normalizeText(clause.text)) {
      issues.push({
        severity: "medium",
        title: "修改稿与原文一致",
        detail: `${clause.title || clause.id} 已记录修改，但修改文本与原文一致。`,
      });
    }
  });
  const checks = buildAutomaticReviewChecks(contract, material, clauses).slice(0, 3);
  checks.forEach((check) => issues.push({
    severity: check.severity || "medium",
    title: check.title,
    detail: check.detail || "本地即时校验发现需要复核的格式或结构问题。",
  }));
  return issues.slice(0, 6);
}

function referenceItem(item) {
  return `
    <div class="reference-item">
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.body)}</p>
      <span class="muted">${escapeHtml(item.meta)}</span>
    </div>
  `;
}

function renderReviewNextActions(contract, clauses, codexStatus = null, material = null) {
  const findings = getAnalysisFindings(contract, clauses);
  const highCount = findings.filter((finding) => finding.severity === "high").length;
  material = material || getWorkbenchMaterial(contract);
  const pendingEdits = Object.values(getClauseActions(material.sourceKey)).filter((action) => action.deleted || action.editedText || action.comment).length;
  codexStatus = codexStatus || getCodexRunStatus(contract, material);
  const legalSummary = codexStatus.legalSummary || summarizeLegalSkillResult(codexStatus.legalResult);
  const analysisRunning = codexStatus.running && !codexStatus.stale;
  const deadline = getLatestFeedbackDeadline(contract.id);
  const deadlineText = deadline ? "反馈期限：" + deadline : "尚未设置反馈期限";
  const title = codexStatus.stale
    ? "AI 状态可能已中断"
    : analysisRunning
      ? "AI 正在审阅合同"
      : legalSummary.hasSegmentation && !legalSummary.hasFindings
        ? "AI 已完成切分，需补跑审阅建议"
        : pendingEdits
          ? "复核并生成拟发送版本"
          : highCount
            ? "先处理高风险条款"
            : "运行 AI 或继续审阅";
  const actionDisabled = analysisRunning ? "disabled" : "";
  return `
    <div class="next-action-card">
      <p class="eyebrow">Next</p>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(deadlineText)} | 高风险 ${highCount} 项 | 已记录修改/批注 ${pendingEdits} 项</p>
      ${renderCodexStatusPanel(codexStatus)}
      <div class="stacked-actions">
        <button class="small-button" type="button" data-run-legal-skill="${contract.id}">运行 AI Legal Skill</button>
        <button class="small-button" type="button" data-run-visual-qa="${escapeHtml(material.sourceKey)}">运行 Agent B 检查</button>
        <button class="small-button" type="button" data-generate-send-version="${contract.id}" ${actionDisabled}>生成拟发送版本</button>
        <button class="small-button" type="button" data-export-word-redline="${contract.id}" ${actionDisabled}>导出 Word 红线/批注稿</button>
      </div>
    </div>
  `;
}

function getCodexRunStatus(contract, material) {
  if (typeof reconcileCodexSegmentationJob === "function") reconcileCodexSegmentationJob(contract, material);
  const sourceKey = material.sourceKey;
  const analysis = state.analysisJobs?.[contract.id] || null;
  const auto = state.autoReviewJobs?.[sourceKey] || null;
  const segmentation = state.segmentationJobs?.[sourceKey] || null;
  const visual = state.visualQaJobs?.[sourceKey] || null;
  const visualReport = state.visualQaReports?.[sourceKey] || null;
  const runner = state.runnerStatus || {};
  const legalResult = state.legalSkillResults?.[contract.id] || null;
  const legalSummary = summarizeLegalSkillResult(legalResult);
  const running = [analysis?.status, auto?.status, segmentation?.status].some((status) => ["queued", "running"].includes(status));
  const updatedAt = latestTimestamp([analysis?.updatedAt, analysis?.startedAt, auto?.updatedAt, auto?.startedAt, auto?.queuedAt, segmentation?.startedAt, segmentation?.completedAt]);
  const stale = Boolean(running && updatedAt && Date.now() - updatedAt > STALE_JOB_TIMEOUT_MS);
  return {
    sourceKey,
    backend: runner.ready ? "connected" : runner.configured === false || runner.error || runner.ready === false ? "unavailable" : "unknown",
    runnerMode: runner.mode || "",
    runnerSummary: runner.summary || "",
    analysis,
    auto,
    segmentation,
    visual,
    visualReport,
    legalResult,
    legalSummary,
    running,
    stale,
    updatedAt,
  };
}

function summarizeLegalSkillResult(result) {
  const meta = typeof normalizeRunnerResultMeta === "function" ? normalizeRunnerResultMeta(result) : {
    source: result?.source || "",
    isFallback: Boolean(result?.isFallback) || /fallback/i.test(result?.source || ""),
    fallbackReason: result?.fallbackReason || "",
    promptVersion: result?.promptVersion || result?.prompt_version || "",
    skillPath: result?.skillPath || result?.skill_path || "",
    downstreamSkill: result?.downstreamSkill || result?.downstream_skill || "",
    checkedAt: result?.checkedAt || result?.checked_at || "",
  };
  const response = result?.response || {};
  const segmentationCount = response.clauseSegmentation?.length || 0;
  const findingCount = (response.clauseAnalyses?.length || 0) + (response.contractLevelRisks?.length || 0);
  return {
    hasResult: Boolean(result),
    hasSegmentation: segmentationCount > 0,
    hasFindings: findingCount > 0,
    segmentationCount,
    findingCount,
    source: meta.source,
    promptVersion: meta.promptVersion,
    skillPath: meta.skillPath,
    downstreamSkill: meta.downstreamSkill,
    fallbackReason: meta.fallbackReason,
    checkedAt: meta.checkedAt,
    isFallback: meta.isFallback,
  };
}

function latestTimestamp(values) {
  return values
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0] || 0;
}

function renderCodexStatusPanel(status) {
  const workflowSteps = buildCodexWorkflowSteps(status);
  const legalSummary = status.legalSummary || summarizeLegalSkillResult(status.legalResult);
  const autoJob = legalSummary.hasResult && status.auto?.status === "failed" ? null : status.auto;
  const analysisJob = legalSummary.hasFindings && status.analysis?.status === "failed" ? null : status.analysis;
  const hasAiSegmentation = legalSummary.hasSegmentation;
  const segmentationJob = hasAiSegmentation && status.segmentation?.status === "failed" ? null : status.segmentation;
  const rows = [
    {
      label: "后端",
      value: status.backend === "connected" ? `已就绪${status.runnerMode ? ` | ${status.runnerMode}` : ""}` : status.backend === "unavailable" ? (status.runnerSummary || "本机 AI 未就绪") : "待确认",
      tone: status.backend === "connected" ? "low" : "medium",
    },
    {
      label: "自动审阅",
      value: formatReviewJobSummary(autoJob, "auto", status.legalResult ? "已生成结果" : "未运行"),
      tone: status.stale ? "medium" : jobTone(autoJob),
    },
    {
      label: "Legal Skill",
      value: legalSummary.hasFindings
        ? formatReviewJobSummary(analysisJob, "analysis", "审阅建议已写入")
        : legalSummary.hasSegmentation
          ? "已写入 AI 切分，未返回审阅建议"
          : formatReviewJobSummary(analysisJob, "analysis", "等待运行"),
      tone: legalSummary.hasFindings ? "low" : legalSummary.hasSegmentation ? "medium" : status.stale ? "medium" : jobTone(analysisJob),
    },
    {
      label: "结果来源",
      value: legalSummary.hasResult
        ? `${legalSummary.source || "unknown"}${legalSummary.promptVersion ? ` | ${legalSummary.promptVersion}` : ""}${legalSummary.isFallback ? " | fallback" : ""}`
        : "等待结果",
      tone: legalSummary.isFallback ? "medium" : "low",
    },
    {
      label: "Skill 链路",
      value: legalSummary.hasResult
        ? `${legalSummary.skillPath || "unknown"}${legalSummary.downstreamSkill ? ` -> ${legalSummary.downstreamSkill}` : ""}`
        : "等待结果",
      tone: "low",
    },
    {
      label: "语义切分",
      value: formatReviewJobSummary(segmentationJob, "segmentation", hasAiSegmentation ? "已有 AI 切分" : "等待切分"),
      tone: jobTone(segmentationJob),
    },
    {
      label: "Visual QA",
      value: formatVisualQaStatusForProgress(status.visual, status.visualReport),
      tone: status.visual?.status === "failed" ? "medium" : jobTone(status.visual),
    },
  ];
  const staleNote = status.stale
    ? `<p class="muted codex-status-warning">任务超过 3 分钟没有状态更新，可能已中断。可以点击“运行 AI Legal Skill”重试；如果 Visual QA 显示 404，请重启本地后端。</p>`
    : "";
  return `
    <div class="codex-status-panel">
      <div class="codex-workflow">
        ${workflowSteps.map((step) => `
          <div class="codex-workflow-step ${step.status}">
            <span>${escapeHtml(step.label)}</span>
            <strong>${escapeHtml(step.text)}</strong>
          </div>
        `).join("")}
      </div>
      ${rows.map((row) => `
        <div class="codex-status-row">
          <span>${escapeHtml(row.label)}</span>
          <strong class="risk ${row.tone}">${escapeHtml(row.value)}</strong>
        </div>
      `).join("")}
      ${staleNote}
    </div>
  `;
}

function formatVisualQaStatusForProgress(visual, report = null) {
  if (!visual) return "按需检查";
  if (["queued", "running", "deferred", "failed"].includes(visual.status)) return formatReviewJobSummary(visual, "visual", "按需检查");
  if (visual.status === "completed") {
    if (report?.source === "visual-qa-fallback") {
      return `本地兜底已检查${report?.promptVersion ? ` | ${report.promptVersion}` : ""}`;
    }
    return `Agent B 最近已检查${report?.promptVersion ? ` | ${report.promptVersion}` : ""}`;
  }
  return "按需检查";
}

function formatReviewJobSummary(job, kind = "job", fallback = "等待处理") {
  if (!job) return fallback;
  if (job.status === "completed") return kind === "visual" ? "最近已检查" : "已完成";
  if (job.status === "failed") {
    if (kind === "segmentation") return "语义切分暂未完成，已使用本地规则。";
    if (kind === "visual") return "界面校验暂未完成，可稍后重试。";
    if (kind === "auto" || kind === "analysis") return "AI 审阅暂未完成，可稍后重试。";
    return "暂未完成，可稍后重试。";
  }
  if (job.status === "deferred") return kind === "visual" ? "界面校验稍后自动处理。" : "稍后自动处理。";
  if (job.status === "running") {
    if (kind === "segmentation") return "正在进行语义切分。";
    if (kind === "visual") return "正在进行界面校验。";
    if (kind === "auto" || kind === "analysis") return "正在进行 AI 审阅。";
    return "运行中";
  }
  if (job.status === "queued") return "已排队";
  return fallback;
}

function buildCodexWorkflowSteps(status) {
  const legalSummary = status.legalSummary || summarizeLegalSkillResult(status.legalResult);
  const hasLegalResult = legalSummary.hasResult;
  const segmentationRunning = ["queued", "running"].includes(status.segmentation?.status);
  const analysisRunning = ["queued", "running"].includes(status.analysis?.status) || ["queued", "running"].includes(status.auto?.status);
  const visualRunning = ["queued", "running"].includes(status.visual?.status);
  const visualFallback = status.visualReport?.source === "visual-qa-fallback";
  const visualCompleted = status.visual?.status === "completed";
  return [
    {
      label: "阅读合同",
      text: analysisRunning ? "进行中" : hasLegalResult ? "已完成" : "等待启动",
      status: analysisRunning ? "running" : hasLegalResult ? "done" : "pending",
    },
    {
      label: "切分条款",
      text: segmentationRunning ? "进行中" : legalSummary.hasSegmentation ? "AI 已切分" : "待切分",
      status: segmentationRunning ? "running" : legalSummary.hasSegmentation ? "done" : "pending",
    },
    {
      label: "匹配风险",
      text: analysisRunning ? "生成中" : legalSummary.hasFindings ? "已落位" : hasLegalResult ? "未返回风险" : "等待分析",
      status: analysisRunning ? "running" : legalSummary.hasFindings ? "done" : "pending",
    },
    {
      label: "生成建议",
      text: analysisRunning ? "生成中" : legalSummary.hasFindings ? "已写入卡片" : legalSummary.hasSegmentation ? "未返回建议" : "等待分析",
      status: analysisRunning ? "running" : legalSummary.hasFindings ? "done" : "pending",
    },
    {
      label: "界面校验",
      text: visualRunning ? "检查中" : visualCompleted ? (visualFallback ? "本地兜底已检查" : "Agent B 已检查") : "后台兜底",
      status: visualRunning ? "running" : visualCompleted ? "done" : "pending",
    },
  ];
}

function formatJobStatus(job, fallback) {
  if (!job) return fallback;
  if (job.message) return job.message;
  if (job.status === "completed") return "已完成";
  if (job.status === "failed") return "失败";
  if (job.status === "running") return "运行中";
  if (job.status === "queued") return "已排队";
  return job.status || fallback;
}

function jobTone(job) {
  if (!job) return "low";
  if (job.status === "failed") return "medium";
  if (["queued", "running"].includes(job.status)) return "medium";
  return "low";
}

function renderContractStructureOverview(contract, material, clauses) {
  const actions = getClauseActions(material.sourceKey);
  const findings = getAnalysisFindings(contract, clauses);
  const findingClauseIds = new Set(findings.map((finding) => finding.clauseId).filter(Boolean));
  const typeGroups = clauses.reduce((groups, clause) => {
    const key = clause.type || "其他";
    groups[key] = groups[key] || [];
    groups[key].push(clause);
    return groups;
  }, {});
  const editedCount = Object.values(actions).filter((action) => action.editedText || action.deleted || action.comment).length;
  const highCount = findings.filter((finding) => finding.severity === "high").length;
  const missingCore = getMissingCoreClauseTypes(contract, clauses);
  return `
    <section class="structure-overview">
      <div class="section-header-row">
        <div>
          <p class="eyebrow">Map</p>
          <h3 class="section-title">合同结构概览</h3>
        </div>
      </div>
      <div class="structure-metrics">
        <span class="status-pill">${clauses.length} 条</span>
        <span class="risk ${highCount ? "high" : "low"}">高风险 ${highCount}</span>
        <span class="status-pill">已处理 ${editedCount}</span>
        ${missingCore.length ? `<span class="risk medium">缺核心 ${missingCore.length}</span>` : `<span class="risk low">核心条款较完整</span>`}
      </div>
      ${missingCore.length ? `<p class="muted">缺失核心：${escapeHtml(missingCore.join("、"))}</p>` : ""}
      <div class="structure-group-list">
        ${Object.entries(typeGroups)
          .map(([type, items]) => {
            const typeHigh = items.filter((clause) => getClauseRiskSummary(contract, clause, material.sourceKey, clause.id, clauses).severity === "high").length;
            return `
              <details class="structure-group" ${typeHigh ? "open" : ""}>
                <summary>
                  <span>${escapeHtml(type)}</span>
                  <span class="muted">${items.length} 条${typeHigh ? ` | 高风险 ${typeHigh}` : ""}</span>
                </summary>
                <div class="structure-clause-list">
                  ${items
                    .map((clause) => {
                      const action = actions[clause.id] || {};
                      const risk = getClauseRiskSummary(contract, clause, material.sourceKey, clause.id, clauses);
                      return `
                        <button class="structure-clause-link" type="button" data-workbench-clause="${clause.id}">
                          <span class="risk-dot ${risk.severity}"></span>
                          <span>${escapeHtml(clause.title || `第 ${clause.number || ""} 条`)}</span>
                          <span class="structure-flags">
                            ${findingClauseIds.has(clause.id) ? "AI" : ""}
                            ${action.editedText ? "改" : ""}
                            ${action.comment ? "批" : ""}
                            ${action.deleted ? "删" : ""}
                          </span>
                        </button>
                      `;
                    })
                    .join("")}
                </div>
              </details>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function getMissingCoreClauseTypes(contract, clauses) {
  const presentTypes = new Set(clauses.map((clause) => clause.type));
  const context = `${contract.type || ""}\n${contract.name || ""}\n${contract.purpose || ""}\n${contract.businessBackground || ""}`;
  return ["服务范围", "付款", "知识产权", "保密", "责任限制", "期限与终止", "争议解决", "数据使用", "个人信息保护"].filter((type) => {
    if (presentTypes.has(type)) return false;
    if (["数据使用", "个人信息保护"].includes(type)) return /数据|个人信息|隐私|模型|训练|SaaS|API|平台/.test(context);
    if (type === "知识产权") return /SaaS|软件|技术|开发|模型|算法|数据|API|平台|成果/.test(context);
    return true;
  });
}

function getReaderFilters() {
  state.readerFilters = state.readerFilters || { keyword: "", type: "", risk: "", queue: "" };
  return state.readerFilters;
}

function renderVersionComparisonPanel(contract) {
  const updates = getContractUpdates(contract.id);
  const activeIndex = updates.findIndex((u) => u.id === state.activeUpdateId);
  const currentUpdate = updates[activeIndex] || null;
  const previousUpdate = activeIndex > 0 ? updates[activeIndex - 1] : updates.at(-2);

  if (!currentUpdate || !previousUpdate) {
    return `<div class="empty">当前合同至少需要两个版本才能进行对比。</div>`;
  }

  const previousText = previousUpdate.acceptedText || previousUpdate.versionText || "";
  const currentText = currentUpdate.acceptedText || currentUpdate.versionText || "";

  if (!previousText || !currentText) {
    return `<div class="empty">版本文本不完整，无法进行对比。</div>`;
  }

  const { stats, html } = buildClauseLevelComparisonHtml(previousText, currentText);

  return `
    <div class="reader-toolbar">
      <div>
        <p class="eyebrow">Comparison</p>
        <h3 class="section-title">版本对比</h3>
        <p class="muted">
          ${escapeHtml(previousUpdate.type)} (${escapeHtml(previousUpdate.createdAt)})
          <span style="margin:0 8px">→</span>
          ${escapeHtml(currentUpdate.type)} (${escapeHtml(currentUpdate.createdAt)})
        </p>
        <div class="comparison-toolbar" style="margin-top:8px">
          <span class="status-pill" style="background:#d1f2eb;color:#0e6251">新增 ${stats.added}</span>
          <span class="status-pill" style="background:#fadbd8;color:#943126">删除 ${stats.deleted}</span>
          <span class="status-pill" style="background:#fdebd0;color:#7e5109">修改 ${stats.modified}</span>
          <span class="status-pill" style="background:#eaeded;color:#515a5a">未变 ${stats.unchanged}</span>
        </div>
      </div>
    </div>
    <div class="review-workspace-split">
      <div class="clause-stack">
        ${html}
      </div>
    </div>
  `;
}

function renderMaterialReader(contract) {
  if (state.comparisonMode) {
    return renderVersionComparisonPanel(contract);
  }
  return renderInlineClauseWorkbench(contract);
}

function scheduleCodexSegmentation(contract, material) {
  if (typeof ensureCodexSegmentation !== "function") return;
  if (typeof reconcileCodexSegmentationJob === "function") reconcileCodexSegmentationJob(contract, material);
  const jobKey = material.sourceKey || contract.id;
  if (state.viewBootstrappingSegmentation?.[jobKey] || ["queued", "running"].includes(state.autoReviewJobs?.[jobKey]?.status)) return;
  const status = getClauseSegmentationStatus(material.text, material.sourceKey);
  if (status.source === "ai" || ["running", "failed"].includes(state.segmentationJobs?.[jobKey]?.status)) return;
  state.viewBootstrappingSegmentation = state.viewBootstrappingSegmentation || {};
  state.viewBootstrappingSegmentation[jobKey] = true;
  setTimeout(() => ensureCodexSegmentation(contract, material).finally(() => {
    if (state.viewBootstrappingSegmentation) delete state.viewBootstrappingSegmentation[jobKey];
  }), 0);
}

function renderInlineClauseWorkbench(contract) {
  // Smoke marker: AI切分 is surfaced through segmentationStatus.label.
  const material = getWorkbenchMaterial(contract);
  const clauses = splitVersionClauses(material.text, material.sourceKey);
  if (!clauses.length) return `<div class="empty">当前版本没有可展示的合同文本</div>`;
  const placementClauses = getAdvicePlacementClauses(clauses);
  window.currentReviewPlacementContext = {
    contractId: contract.id,
    sourceKey: material.sourceKey,
    clauses: placementClauses,
  };
  const filters = getReaderFilters();
  const segmentationStatus = getClauseSegmentationStatus(material.text, material.sourceKey);
  const clauseTypes = [...new Set(clauses.map((clause) => clause.type).filter(Boolean))];
  const queueItems = buildReviewQueueItems(contract, material, clauses, placementClauses);
  const visibleClauses = clauses.filter((clause) => {
    const risk = getClauseRiskSummary(contract, clause, material.sourceKey, clause.id, placementClauses);
    const queue = getClauseAggregateQueueStatus(contract, material, clause, placementClauses);
    const matchesKeyword = !filters.keyword || `${clause.title}${clause.text}${clause.type}`.includes(filters.keyword);
    const matchesType = !filters.type || clause.type === filters.type;
    const matchesRisk = !filters.risk || risk.severity === filters.risk;
    const matchesQueue = !filters.queue || queue[filters.queue];
    return matchesKeyword && matchesType && matchesRisk && matchesQueue;
  });
  const selectedClause = clauses.find((clause) => clause.id === state.activeWorkbenchClauseId) || null;
  const tree = buildClauseTree(visibleClauses, material.sourceKey);
  return `
    <div class="reader-toolbar">
      <div>
        <p class="eyebrow">Material</p>
        <h3 class="section-title">${escapeHtml(material.title)}</h3>
        <p class="muted">${visibleClauses.length} / ${clauses.length} 个条款正在显示 | ${escapeHtml(segmentationStatus.label)}${segmentationStatus.count ? ` ${segmentationStatus.count} 条` : ""}${segmentationStatus.overlap ? ` | 匹配度 ${Math.round(segmentationStatus.overlap * 100)}%` : ""}</p>
        ${segmentationStatus.note ? `<p class="muted">${escapeHtml(segmentationStatus.note)}</p>` : ""}
        ${renderSegmentationJobStatus(material.sourceKey || contract.id)}
        ${renderReviewQueueBar(queueItems, filters.queue)}
      </div>
      <div class="reader-filter-row">
        <input id="reader-clause-search" placeholder="搜索当前合同条款" value="${escapeHtml(filters.keyword)}" />
        <select id="reader-type-filter">
          <option value="">全部类别</option>
          ${clauseTypes.map((type) => `<option value="${escapeHtml(type)}" ${filters.type === type ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}
        </select>
        <select id="reader-risk-filter">
          <option value="">全部风险</option>
          <option value="high" ${filters.risk === "high" ? "selected" : ""}>高风险</option>
          <option value="medium" ${filters.risk === "medium" ? "selected" : ""}>中风险</option>
          <option value="low" ${filters.risk === "low" ? "selected" : ""}>低风险</option>
        </select>
      </div>
    </div>
    <div class="review-workspace-split">
      <div class="clause-stack">
        ${tree.length ? tree.map((node) => renderClauseTreeNode(contract, material, node, clauses, selectedClause, clauses.length)).join("") : `<div class="empty">没有符合筛选条件的条款</div>`}
      </div>
      ${renderAdviceSidebar(contract, material, visibleClauses)}
    </div>
  `;
}

function renderAdviceSidebar(contract, material, clauses) {
  const adviceItems = collectAdviceSidebarItems(contract, material, clauses);
  return `
    <aside class="review-advice-sidebar" aria-label="AI 建议批注栏">
      <div class="advice-sidebar-header">
        <div>
          <p class="eyebrow">AI Comments</p>
          <h3 class="section-title">AI 建议批注</h3>
        </div>
        <span class="status-pill">${adviceItems.length} 条</span>
      </div>
      ${
        adviceItems.length
          ? `<div class="advice-comment-list">${adviceItems.map((item) => renderAdviceCommentItem(item)).join("")}</div>`
          : `<div class="empty compact-empty">当前筛选范围内暂无 AI 建议</div>`
      }
    </aside>
  `;
}

function collectAdviceSidebarItems(contract, material, clauses) {
  const items = [];
  const placementClauses = getAdvicePlacementClauses(clauses);
  const pushClauseAdvice = (clause, parentTitle = "") => {
    const clauseRisk = getClauseRiskSummary(contract, clause, material.sourceKey, clause.id, placementClauses);
    if (!clauseRisk?.fix || clauseRisk.severity === "low") return;
    items.push({
      clause,
      clauseRisk,
      parentTitle,
      html: renderClauseRiskAdvice(clauseRisk, material.sourceKey, clause.id, clause),
    });
  };
  clauses.forEach((clause) => {
    pushClauseAdvice(clause);
    splitSubclauses(clause).forEach((subclause) => {
      pushClauseAdvice(subclause, clause.title || "");
    });
  });
  return items;
}

function getAdvicePlacementClauses(clauses = []) {
  const flattened = [];
  clauses.forEach((clause) => {
    flattened.push(clause);
    splitSubclauses(clause).forEach((subclause) => flattened.push(subclause));
  });
  const seen = new Set();
  return flattened.filter((clause) => {
    if (!clause?.id || seen.has(clause.id)) return false;
    seen.add(clause.id);
    return true;
  });
}

function renderAdviceCommentItem(item) {
  const title = item.clause.title || item.clause.number || "对应条款";
  const targetAttrs = item.clause.parentId
    ? `data-workbench-subclause="${escapeHtml(item.clause.id)}" data-parent-clause="${escapeHtml(item.clause.parentId)}"`
    : `data-workbench-clause="${escapeHtml(item.clause.id)}"`;
  return `
    <section class="advice-comment-item" data-advice-comment-for="${escapeHtml(item.clause.id)}" data-advice-parent="${escapeHtml(item.clause.parentId || "")}">
      <button class="advice-comment-target" type="button" ${targetAttrs}>
        <span>${escapeHtml(item.parentTitle ? `${item.parentTitle} / ${title}` : title)}</span>
        <strong class="risk ${escapeHtml(item.clauseRisk.severity)}">风险${riskLabel(item.clauseRisk.severity)}</strong>
      </button>
      ${item.html}
    </section>
  `;
}

function getClauseQueueStatus(risk = {}, action = {}) {
  return {
    high: risk.severity === "high",
    ai: Boolean(risk.fix && risk.severity !== "low"),
    edited: Boolean(action.editedText),
    commented: Boolean(action.comment),
    deleted: Boolean(action.deleted),
  };
}

function buildReviewQueueItems(contract, material, clauses, placementClauses = getAdvicePlacementClauses(clauses)) {
  const counts = { high: 0, ai: 0, edited: 0, commented: 0, deleted: 0 };
  clauses.forEach((clause) => {
    const queue = getClauseAggregateQueueStatus(contract, material, clause, placementClauses);
    Object.keys(counts).forEach((key) => {
      if (queue[key]) counts[key] += 1;
    });
  });
  return [
    { key: "", label: "全部", count: clauses.length },
    { key: "high", label: "高风险", count: counts.high },
    { key: "ai", label: "AI 建议", count: counts.ai },
    { key: "edited", label: "已修改", count: counts.edited },
    { key: "commented", label: "有批注", count: counts.commented },
    { key: "deleted", label: "拟删除", count: counts.deleted },
  ];
}

function getClauseAggregateQueueStatus(contract, material, clause, placementClauses = getAdvicePlacementClauses(splitVersionClauses(material.text, material.sourceKey))) {
  const actions = getClauseActions(material.sourceKey);
  const queue = getClauseQueueStatus(getClauseRiskSummary(contract, clause, material.sourceKey, clause.id, placementClauses), actions[clause.id] || {});
  splitSubclauses(clause).forEach((subclause) => {
    const subQueue = getClauseQueueStatus(getClauseRiskSummary(contract, subclause, material.sourceKey, subclause.id, placementClauses), actions[subclause.id] || {});
    Object.keys(queue).forEach((key) => {
      queue[key] = queue[key] || subQueue[key];
    });
  });
  return queue;
}

function renderReviewQueueBar(items, activeKey) {
  return `
    <div class="review-queue-bar" aria-label="审阅队列">
      ${items.map((item) => `
        <button class="queue-chip ${activeKey === item.key ? "active" : ""}" type="button" data-review-queue="${escapeHtml(item.key)}">
          <span>${escapeHtml(item.label)}</span>
          <strong>${item.count}</strong>
        </button>
      `).join("")}
    </div>
  `;
}

function renderSegmentationJobStatus(contractId) {
  const job = state.segmentationJobs?.[contractId];
  if (!job || job.status === "completed") return "";
  if (job.status === "running") return `<p class="muted">AI 正在进行语义切分，完成后会自动更新条款卡片。</p>`;
  if (job.status === "failed") return `<p class="muted">语义切分暂未完成，当前已使用本地规则切分。</p>`;
  return "";
}

function renderCardQuickActions(material, clause, action = {}, options = {}) {
  const target = `${material.sourceKey}||${clause.id}`;
  const addButton = options.allowAdd === false ? "" : `<button class="icon-text-button" type="button" data-open-add-clause="${target}">新增</button>`;
  return `
    <div class="card-quick-actions" aria-label="条款快捷操作">
      ${addButton}
      <button class="icon-text-button" type="button" data-toggle-inline-comment="${target}">批注</button>
      <button class="icon-text-button danger" type="button" data-toggle-clause-delete="${target}">${action.deleted ? "撤销删除" : "删除"}</button>
      <span class="card-action-hint">卡片内处理</span>
    </div>
  `;
}

function renderInlineClauseEditor(material, clause, action = {}, text, label = "条款文本") {
  const open = state.inlineCommentClauseId === clause.id;
  if (!open) return "";
  const target = `${material.sourceKey}||${clause.id}`;
  const modeLabel = "批注";
  return `
    <div class="card-inline-editor">
      <div class="section-header-row">
        <strong>${modeLabel}</strong>
        <span class="muted">保存后将在审阅模式和导出稿中按修订/批注展示</span>
      </div>
      <label>
        批注
        <textarea data-clause-comment="${target}" placeholder="记录修改理由、谈判意见、需业务确认事项。">${escapeHtml(action.comment || "")}</textarea>
      </label>
      <div class="row-actions">
        <button class="small-button" type="button" data-save-clause-action="${target}">保存批注</button>
      </div>
    </div>
  `;
}

function renderDirectClauseEditor(material, clause, action = {}, text, label = "条款正文") {
  const target = `${material.sourceKey}||${clause.id}`;
  const title = getEditedClauseTitle(material.sourceKey, clause);
  const bodyText = stripEditableTitleFromText(text, title);
  return `
    <div class="direct-clause-editor">
      <textarea data-clause-edit="${target}" aria-label="${label}" placeholder="直接修改本条正文">${escapeHtml(bodyText)}</textarea>
    </div>
  `;
}

function renderEditableClauseTitle(material, clause, headingTag = "h4") {
  const title = getEditedClauseTitle(material.sourceKey, clause);
  if (!title && headingTag !== "h5") return "";
  const target = `${material.sourceKey}||${clause.id}`;
  return `
    <${headingTag} class="editable-clause-title-wrap">
      <textarea class="editable-clause-title" data-clause-title-edit="${target}" rows="1" aria-label="条款标题" placeholder="条款标题">${escapeHtml(title)}</textarea>
    </${headingTag}>
  `;
}

function stripEditableTitleFromText(text, title) {
  const source = String(text || "").trim();
  const cleanTitle = String(title || "").trim();
  if (!source || !cleanTitle) return source;
  const lines = source.split(/\n/);
  const first = String(lines[0] || "").trim();
  if (normalizeEditableTitleLine(first) === normalizeEditableTitleLine(cleanTitle)) {
    return lines.slice(1).join("\n").trimStart();
  }
  return source;
}

function normalizeEditableTitleLine(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[：:。；;，,、]$/u, "");
}

function wrapClauseBodyAnchor(sourceKey, clauseId, html) {
  const key = `${sourceKey}||${clauseId}`;
  return `<div class="clause-body-anchor ${state.focusedAdviceKey === key ? "focused" : ""}" data-clause-body-anchor="${key}">${html}</div>`;
}

function getReaderToolKey(sourceKey, clauseId) {
  return `${sourceKey || ""}||${clauseId || ""}`;
}

function getReaderToolTab(sourceKey, clauseId) {
  const tab = state.readerPaneTabs?.[getReaderToolKey(sourceKey, clauseId)];
  return tab === "analysis" ? "analysis" : "index";
}

function renderInlineClauseCard(contract, material, clause, clauses, active) {
  const actions = getClauseActions(material.sourceKey);
  const action = actions[clause.id] || {};
  const subclauses = splitSubclauses(clause);
  const selectedSubclause = active ? getSelectedSubclause(subclauses) : null;
  const text = getEditedClauseText(material.sourceKey, clause);
  const title = getEditedClauseTitle(material.sourceKey, clause);
  const placementClauses = getAdvicePlacementClauses(clauses);
  const clauseRisk = getClauseRiskSummary(contract, clause, material.sourceKey, clause.id, placementClauses);
  const indexGroups = active ? buildClauseIndexGroups(contract, material, clause, clauses) : { history: [], related: [], playbook: [] };
  const analysis = active ? buildClauseAnalysis(contract, clause, action.analysisRequest || "") : [];
  const activeReaderTab = getReaderToolTab(material.sourceKey, clause.id);
  const redline = active ? buildRedlineDraft(material.sourceKey, clauses) : "";
  const hasNested = subclauses.length >= 2;
  const expanded = !hasNested || isTreeNodeExpanded(clause.id);
  const hasClauseTitle = Boolean(String(title || "").trim());
  const titleFallbackText = hasClauseTitle ? "" : getTitlelessClausePreview(text, subclauses);
  const showTitleFallback = !hasClauseTitle && titleFallbackText && (!expanded || (active && !hasNested));
  return `
    <article class="inline-clause-card ${active ? "active" : ""} ${action.deleted ? "deleted-clause" : ""}" draggable="true" data-clause-card="${escapeHtml(clause.id)}" data-clause-stable-id="${escapeHtml(clause.stableId)}">
      <div class="tree-card-header">
        ${
          hasNested
            ? `<button class="tree-toggle-button" type="button" data-toggle-tree-node="${escapeHtml(clause.id)}" aria-expanded="${expanded}">${expanded ? "收起" : "展开"}</button>`
            : `<span class="tree-toggle-spacer"></span>`
        }
        <div class="tree-card-main">
          <button class="inline-clause-button" type="button" data-workbench-clause="${escapeHtml(clause.id)}">
            <div class="chips">
              <span class="tag">${escapeHtml(clause.type)}</span>
              ${clause.chapterTitle ? `<span class="status-pill">${escapeHtml(clause.chapterTitle)}</span>` : ""}
              <span class="risk ${escapeHtml(clauseRisk.severity)}">风险${riskLabel(clauseRisk.severity)}</span>
              ${hasNested ? `<span class="status-pill">${subclauses.length} 小条款</span>` : ""}
              ${action.editedText ? `<span class="status-pill">已修改</span>` : ""}
              ${action.comment ? `<span class="status-pill">有批注</span>` : ""}
              ${action.deleted ? `<span class="risk high">拟删除</span>` : ""}
            </div>
            ${hasClauseTitle ? "" : ""}
            ${showTitleFallback ? `<div class="clause-head-text">${escapeHtml(titleFallbackText)}</div>` : ""}
            ${shouldShowClauseRiskSummary(clauseRisk) ? `<p class="muted">${escapeHtml(clauseRisk.summary)}</p>` : ""}
          </button>
          ${hasClauseTitle ? renderEditableClauseTitle(material, clause, "h4") : ""}
        </div>
        ${renderCardQuickActions(material, clause, action)}
      </div>
      ${
        expanded
          ? `<div class="inline-clause-body ${active ? "active-with-tools" : ""}">
              ${
                hasNested
                  ? renderSubclauseStack(contract, material, clause, subclauses, selectedSubclause)
                  : wrapClauseBodyAnchor(material.sourceKey, clause.id, renderDirectClauseEditor(material, clause, action, text))
              }
              ${renderInlineClauseEditor(material, clause, action, text)}
            </div>`
          : ""
      }
      ${
        active
          ? `
          <div class="inline-clause-tools" data-reader-scope="${escapeHtml(getReaderToolKey(material.sourceKey, clause.id))}">
            <div class="reader-tabs" role="tablist" aria-label="条款工具">
              <button class="reader-tab ${activeReaderTab === "index" ? "active" : ""}" type="button" data-reader-tab="index">索引</button>
              <button class="reader-tab ${activeReaderTab === "analysis" ? "active" : ""}" type="button" data-reader-tab="analysis">分析</button>
            </div>
            <section class="reader-pane ${activeReaderTab === "index" ? "active" : ""}" data-reader-pane="index">
              ${renderClauseIndexTabs(indexGroups)}
            </section>
            <section class="reader-pane ${activeReaderTab === "analysis" ? "active" : ""}" data-reader-pane="analysis">
              <div class="editor-panel">
                <label>
                  分析要求
                  <textarea data-analysis-request="${material.sourceKey}||${clause.id}" placeholder="例如：从服务提供方视角，给出更保守的数据使用条款。">${escapeHtml(action.analysisRequest || "")}</textarea>
                </label>
                <button class="primary-button" type="button" data-run-clause-analysis="${material.sourceKey}||${clause.id}">生成修改建议</button>
                ${renderClauseAnalysisStatus(action)}
                <div class="reference-list">
                  ${analysis.map(referenceItem).join("")}
                </div>
              </div>
            </section>
          </div>`
          : ""
      }
    </article>
  `;
}

function getTitlelessClausePreview(text, subclauses = []) {
  const candidates = [
    ...(subclauses.parentIntro || []),
    text,
    subclauses[0]?.text,
  ];
  const preview = candidates
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .find(Boolean);
  if (!preview) return "";
  return preview.length > 260 ? `${preview.slice(0, 260)}...` : preview;
}

function renderSubclauseCard(contract, material, parentClause, subclause, subclauses, active, childNodes = []) {
  const actions = getClauseActions(material.sourceKey);
  const action = actions[subclause.id] || {};
  const effectiveSubclause = { ...subclause, text: getEditedClauseText(material.sourceKey, subclause) };
  const effectiveTitle = getEditedClauseTitle(material.sourceKey, subclause);
  const currentContractClauses = splitVersionClauses(material.text, material.sourceKey);
  const placementClauses = getAdvicePlacementClauses(currentContractClauses);
  const clauseRisk = getClauseRiskSummary(contract, effectiveSubclause, material.sourceKey, subclause.id, placementClauses);
  const indexGroups = active ? buildClauseIndexGroups(contract, material, effectiveSubclause, currentContractClauses) : { history: [], related: [], playbook: [] };
  const analysis = active ? buildClauseAnalysis(contract, effectiveSubclause, action.analysisRequest || "") : [];
  const activeReaderTab = getReaderToolTab(material.sourceKey, subclause.id);
  const hasSubclauseTitle = Boolean(effectiveTitle);
  const subclauseBody = wrapClauseBodyAnchor(material.sourceKey, subclause.id, renderDirectClauseEditor(material, subclause, action, effectiveSubclause.text, "小条款正文"));
  const subclauseHeadBody = renderClauseBodyWithTrace(subclause, action, material.mode);
  const hasNested = childNodes.length > 0;
  const expanded = !hasNested || isTreeNodeExpanded(subclause.id);
  return `
    <article class="subclause-card ${active ? "active" : ""} ${action.deleted ? "deleted-clause" : ""}" draggable="true" data-subclause-card="${escapeHtml(subclause.id)}" data-parent-clause="${escapeHtml(parentClause.id)}">
      <div class="tree-card-header">
        ${
          hasNested
            ? `<button class="tree-toggle-button" type="button" data-toggle-tree-node="${escapeHtml(subclause.id)}" aria-expanded="${expanded}">${expanded ? "收起" : "展开"}</button>`
            : `<span class="tree-toggle-spacer"></span>`
        }
        <div class="tree-card-main">
          <button class="subclause-button" type="button" data-workbench-subclause="${escapeHtml(subclause.id)}" data-parent-clause="${escapeHtml(parentClause.id)}">
            <div class="chips">
              <span class="tag">小条款</span>
              <span class="risk ${escapeHtml(clauseRisk.severity)}">风险${riskLabel(clauseRisk.severity)}</span>
              ${hasNested ? `<span class="status-pill">${childNodes.length} 下级</span>` : ""}
              ${action.editedText ? `<span class="status-pill">已修改</span>` : ""}
              ${action.comment ? `<span class="status-pill">有批注</span>` : ""}
              ${action.deleted ? `<span class="risk high">拟删除</span>` : ""}
            </div>
            ${hasSubclauseTitle ? "" : !expanded ? `<div class="subclause-head-text">${subclauseHeadBody}</div>` : ""}
            ${shouldShowClauseRiskSummary(clauseRisk) ? `<p class="muted">${escapeHtml(clauseRisk.summary)}</p>` : ""}
          </button>
          ${hasSubclauseTitle ? renderEditableClauseTitle(material, subclause, "h5") : ""}
        </div>
        ${renderCardQuickActions(material, subclause, action, { allowAdd: false })}
      </div>
      ${
        expanded
          ? `<div class="subclause-body">${subclauseBody}${renderInlineClauseEditor(material, effectiveSubclause, action, effectiveSubclause.text, "小条款文本")}</div>
             ${hasNested ? `<div class="subclause-children">${childNodes.map((child) => renderSubclauseTreeNode(contract, material, parentClause, child, subclauses, { id: state.activeSubclauseId })).join("")}</div>` : ""}`
          : ""
      }
      ${
        active
          ? `<div class="inline-clause-tools subclause-tools" data-reader-scope="${escapeHtml(getReaderToolKey(material.sourceKey, subclause.id))}">
              <div class="reader-tabs" role="tablist" aria-label="小条款工具">
                <button class="reader-tab ${activeReaderTab === "index" ? "active" : ""}" type="button" data-reader-tab="index">索引</button>
                <button class="reader-tab ${activeReaderTab === "analysis" ? "active" : ""}" type="button" data-reader-tab="analysis">分析</button>
              </div>
              <section class="reader-pane ${activeReaderTab === "index" ? "active" : ""}" data-reader-pane="index">${renderClauseIndexTabs(indexGroups)}</section>
              <section class="reader-pane ${activeReaderTab === "analysis" ? "active" : ""}" data-reader-pane="analysis">
                <div class="editor-panel">
                  <label>
                    分析要求
                    <textarea data-analysis-request="${material.sourceKey}||${subclause.id}" placeholder="例如：只分析本款是否应保留、补充例外或调整责任。">${escapeHtml(action.analysisRequest || "")}</textarea>
                  </label>
                  <button class="primary-button" type="button" data-run-clause-analysis="${material.sourceKey}||${subclause.id}">生成修改建议</button>
                  ${renderClauseAnalysisStatus(action)}
                  <div class="reference-list">${analysis.map(referenceItem).join("")}</div>
                </div>
              </section>
            </div>`
          : ""
      }
    </article>
  `;
}

function renderClauseAnalysisStatus(action = {}) {
  if (action.analysisStatus === "running") return `<div class="status-note">正在调用 AI 进行条款级分析...</div>`;
  if (action.analysisStatus === "failed") return `<div class="status-note error">AI 条款级分析暂未完成，请稍后重试。</div>`;
  if (action.analysisStatus === "completed") return `<div class="status-note">AI 条款级分析已完成：${escapeHtml((action.analysisCompletedAt || "").slice(0, 19).replace("T", " "))}</div>`;
  return "";
}

function buildClausePositionInfo(clause, clauses) {
  const index = clauses.findIndex((item) => item.id === clause.id || item.id === clause.parentId);
  const current = index >= 0 ? clauses[index] : clause;
  const previous = index > 0 ? clauses[index - 1] : null;
  const next = index >= 0 && index < clauses.length - 1 ? clauses[index + 1] : null;
  const label = current.chapterTitle
    ? `${current.chapterTitle} | ${current.title || `第 ${current.number || index + 1} 条`}`
    : `${index >= 0 ? `第 ${index + 1} / ${clauses.length} 条 | ` : ""}${current.title || clause.title || "当前条款"}`;
  const neighbors = `上一条：${previous?.title || "无"} | 下一条：${next?.title || "无"}`;
  return { label, neighbors };
}

function countHistoricalClauseMatches(contract, material, clause) {
  return (state.updates || [])
    .filter((item) => item.contractId === contract.id && item.id !== state.activeUpdateId && item.versionText)
    .filter((update) => {
      const text = update.acceptedText || update.versionText || "";
      const historyClauses = splitVersionClauses(text, `${contract.id}:${update.id}`);
      return Boolean(findHistoricalClauseMatch(clause, historyClauses, getEditedClauseText(material.sourceKey, clause)));
    }).length;
}

function isCoreClauseType(contract, type) {
  if (!["服务范围", "付款", "知识产权", "保密", "责任限制", "期限与终止", "争议解决", "数据使用", "个人信息保护"].includes(type)) return false;
  const context = `${contract.type || ""}\n${contract.name || ""}\n${contract.purpose || ""}\n${contract.businessBackground || ""}`;
  if (["数据使用", "个人信息保护"].includes(type)) return /数据|个人信息|隐私|模型|训练|SaaS|API|平台/.test(context);
  if (type === "知识产权") return /SaaS|软件|技术|开发|模型|算法|数据|API|平台|成果/.test(context);
  return true;
}

function renderReviewTimeline(contractId) {
  const updates = getContractUpdates(contractId);
  if (!updates.length) return `<div class="empty">暂无版本记录</div>`;
  return `
    <div class="timeline">
      ${updates
        .map(
          (item) => `
          <div class="timeline-entry">
            <button class="timeline-item ${state.activeUpdateId === item.id ? "active" : ""}" data-open-update="${item.id}" type="button">
              <h4>${escapeHtml(item.type)} <span class="muted">${escapeHtml(item.createdAt)}</span></h4>
              <p>${escapeHtml(item.note || "未填写说明")}</p>
              ${item.feedbackDeadline ? `<p><span class="${isDeadlineUrgent(item.feedbackDeadline) ? "risk high" : "status-pill"}">反馈期限：${escapeHtml(item.feedbackDeadline)}</span></p>` : ""}
            </button>
            <button class="timeline-delete" type="button" data-delete-update="${item.id}" aria-label="删除版本">删除</button>
          </div>`
        )
        .join("")}
    </div>
  `;
}

function isTreeNodeExpanded(nodeId) {
  state.expandedTreeNodes = state.expandedTreeNodes || {};
  return state.expandedTreeNodes[nodeId] === true;
}

function getSelectedSubclause(subclauses) {
  return subclauses.find((subclause) => subclause.id === state.activeSubclauseId) || subclauses[0] || null;
}

function findByDataAttribute(attribute, value) {
  const safeAttribute = String(attribute || "").replace(/["\\[\]{}]/g, "\\$&");
  const safeValue = String(value || "").replace(/["\\]/g, "\\$&");
  const matches = [...document.querySelectorAll(`[${safeAttribute}]`)]
    .filter((node) => node.getAttribute(attribute) === value);
  return matches.find((node) => node.offsetParent !== null) || matches[0] || null;
}

function scrollToWorkbenchClause(clauseId) {
  requestAnimationFrame(() => {
    const target = findByDataAttribute("data-workbench-clause", clauseId);
    target?.closest(".inline-clause-card")?.scrollIntoView({ block: "center" });
  });
}

function scrollToSubclause(subclauseId) {
  requestAnimationFrame(() => {
    const target = findByDataAttribute("data-workbench-subclause", subclauseId);
    const exactCard = target?.closest(".subclause-card");
    if (exactCard) {
      exactCard.scrollIntoView({ block: "center" });
      return;
    }
    const fallbackCard = findNearestRenderedSubclauseCard(subclauseId);
    if (fallbackCard) {
      fallbackCard.scrollIntoView({ block: "center" });
      return;
    }
    const parentId = String(subclauseId || "").split("::sub-")[0];
    scrollToWorkbenchClause(parentId);
  });
}

function findNearestRenderedSubclauseCard(subclauseId) {
  const parentId = String(subclauseId || "").split("::sub-")[0];
  if (!parentId) return null;
  const targetIndex = Number(String(subclauseId || "").match(/::sub-(\d+)$/)?.[1] || 0);
  const cards = [...document.querySelectorAll(`[data-parent-clause="${cssEscapeValue(parentId)}"][data-subclause-card]`)];
  if (!cards.length) return null;
  if (!targetIndex) return cards[0];
  return cards
    .map((card) => ({
      card,
      distance: Math.abs(Number(String(card.getAttribute("data-subclause-card") || "").match(/::sub-(\d+)$/)?.[1] || 0) - targetIndex),
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.card || cards[0];
}

function setupReviewAdviceScrollSync() {
  if (reviewAdviceSyncCleanup) {
    reviewAdviceSyncCleanup();
    reviewAdviceSyncCleanup = null;
  }
  reviewAdviceSyncTimers.forEach((timerId) => clearTimeout(timerId));
  reviewAdviceSyncTimers = [];
  reviewAdviceLastSyncedId = "";
  if (!views.review?.classList.contains("active")) return;
  requestAnimationFrame(() => {
    const sidebar = document.querySelector(".review-advice-sidebar");
    const stack = document.querySelector(".review-workspace-split .clause-stack");
    if (!sidebar || !stack) return;
    const sync = () => {
      if (reviewAdviceSyncFrame) return;
      reviewAdviceSyncFrame = requestAnimationFrame(() => {
        reviewAdviceSyncFrame = null;
        syncAdviceSidebarToVisibleClause(stack, sidebar);
      });
    };
    const handleScroll = (event) => {
      if (event?.target instanceof Node && sidebar.contains(event.target)) return;
      sync();
    };
    const realign = () => {
      alignAdviceSidebarWithClauseStack(stack, sidebar);
      sync();
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    window.addEventListener("resize", realign);
    reviewAdviceSyncTimers = [80, 240, 520].map((delay) => setTimeout(realign, delay));
    reviewAdviceSyncCleanup = () => {
      window.removeEventListener("scroll", handleScroll, { passive: true });
      document.removeEventListener("scroll", handleScroll, { passive: true, capture: true });
      window.removeEventListener("resize", realign);
      reviewAdviceSyncTimers.forEach((timerId) => clearTimeout(timerId));
      reviewAdviceSyncTimers = [];
      if (reviewAdviceSyncFrame) cancelAnimationFrame(reviewAdviceSyncFrame);
      reviewAdviceSyncFrame = null;
    };
    realign();
  });
}

function syncAdviceSidebarToVisibleClause(stack, sidebar) {
  const cards = getVisibleClauseCards(stack);
  const adviceItems = [...sidebar.querySelectorAll("[data-advice-comment-for]")];
  if (!cards.length || !adviceItems.length) return;
  const activeCard = getViewportCenteredCard(cards);
  if (!activeCard) return;
  const targetAdvice = findNearestAdviceItem(activeCard.id, cards, adviceItems);
  if (!targetAdvice) return;
  const targetId = targetAdvice.getAttribute("data-advice-comment-for") || "";
  if (targetId !== reviewAdviceLastSyncedId) {
    reviewAdviceLastSyncedId = targetId;
    adviceItems.forEach((item) => item.classList.toggle("synced", item === targetAdvice));
  }
  scrollAdviceSidebarToItem(sidebar, targetAdvice);
}

function alignAdviceSidebarWithClauseStack(stack, sidebar) {
  const list = sidebar.querySelector(".advice-comment-list");
  if (!list) return;
  const items = [...list.querySelectorAll("[data-advice-comment-for]")];
  if (!items.length) return;
  list.style.position = "";
  list.style.minHeight = "";
  items.forEach((item) => {
    item.style.position = "";
    item.style.insetInline = "";
    item.style.top = "";
    item.style.marginTop = "";
  });
  syncAdviceSidebarToVisibleClause(stack, sidebar);
}

function scrollAdviceSidebarToItem(sidebar, item) {
  const header = sidebar.querySelector(".advice-sidebar-header");
  const headerSpace = header ? header.offsetHeight + 12 : 12;
  const targetTop = item.offsetTop - headerSpace;
  if (Math.abs(sidebar.scrollTop - Math.max(0, targetTop)) < 8) return;
  sidebar.scrollTo({
    top: Math.max(0, targetTop),
    behavior: "auto",
  });
}

function findClauseCardElement(stack, clauseId) {
  return stack.querySelector(`.inline-clause-card[data-clause-card="${cssEscapeValue(clauseId)}"], .subclause-card[data-subclause-card="${cssEscapeValue(clauseId)}"]`);
}

function cssEscapeValue(value) {
  if (window.CSS?.escape) return CSS.escape(String(value || ""));
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function getVisibleClauseCards(stack) {
  return [...stack.querySelectorAll(".inline-clause-card[data-clause-card], .subclause-card[data-subclause-card]")]
    .map((element) => ({
      element,
      id: element.getAttribute("data-clause-card") || element.getAttribute("data-subclause-card") || "",
      parentId: element.getAttribute("data-parent-clause") || "",
    }))
    .filter((item) => item.id);
}

function getViewportCenteredCard(cards) {
  const center = Math.max(120, window.innerHeight * 0.46);
  let best = null;
  let bestDistance = Infinity;
  cards.forEach((card) => {
    const rect = card.element.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    const cardCenter = rect.top + Math.min(rect.height, window.innerHeight) / 2;
    const distance = Math.abs(cardCenter - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = card;
    }
  });
  return best || cards[0];
}

function findNearestAdviceItem(clauseId, cards, adviceItems) {
  const exact = adviceItems.find((item) => item.getAttribute("data-advice-comment-for") === clauseId);
  if (exact) return exact;
  const childAdvice = adviceItems.find((item) => getAdviceParentId(item) === clauseId);
  if (childAdvice) return childAdvice;
  const cardIndex = new Map(cards.map((card, index) => [card.id, index]));
  cards.forEach((card, index) => {
    if (card.parentId && !cardIndex.has(card.parentId)) cardIndex.set(card.parentId, index);
  });
  const currentIndex = cardIndex.get(clauseId);
  const currentOrder = extractClauseDomOrder(clauseId) ?? currentIndex;
  if (currentOrder === undefined) return adviceItems[0] || null;
  return adviceItems
    .map((item) => ({
      item,
      index: getAdviceDomOrder(item, cardIndex),
    }))
    .filter((entry) => entry.index !== undefined)
    .sort((a, b) => Math.abs(a.index - currentOrder) - Math.abs(b.index - currentOrder))[0]?.item || adviceItems[0] || null;
}

function getAdviceParentId(item) {
  const explicit = item.getAttribute("data-advice-parent") || "";
  if (explicit) return explicit;
  return String(item.getAttribute("data-advice-comment-for") || "").split("::sub-")[0] || "";
}

function getAdviceDomOrder(item, cardIndex) {
  const adviceId = item.getAttribute("data-advice-comment-for") || "";
  const parentId = getAdviceParentId(item);
  return extractClauseDomOrder(adviceId) ?? extractClauseDomOrder(parentId) ?? cardIndex.get(adviceId) ?? cardIndex.get(parentId);
}

function extractClauseDomOrder(clauseId) {
  const match = String(clauseId || "").match(/:seg-(\d+)(?:::sub-(\d+))?$/);
  if (!match) return undefined;
  return Number(match[1]) * 1000 + Number(match[2] || 0);
}
