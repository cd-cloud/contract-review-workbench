function renderCounterparties() {
  views.counterparties.innerHTML = `
    <div class="filters">
      <input id="counterparty-search" placeholder="搜索相对方、行业、备注、谈判偏好" />
      <select id="counterparty-type-filter">
        <option value="">全部类型</option>
        ${[...new Set(state.counterparties.map((item) => item.type))].map((type) => `<option>${escapeHtml(type)}</option>`).join("")}
      </select>
      <select id="counterparty-risk-filter">
        <option value="">全部风险</option>
        <option value="high">高风险</option>
        <option value="medium">中风险</option>
        <option value="low">低风险</option>
      </select>
    </div>
    <div id="counterparty-list">
      ${renderCounterpartyCards(state.counterparties)}
    </div>
  `;
}

function renderCounterpartyCards(counterparties) {
  if (!counterparties.length) return `<div class="empty">没有匹配的相对方</div>`;
  return `
    <div class="counterparty-grid">
      ${counterparties
        .map((item) => {
          const contracts = state.contracts.filter((contract) => contract.counterpartyId === item.id);
          const negotiations = state.negotiations.filter((record) => record.counterpartyId === item.id);
          const profile = buildCounterpartyProfile(item, contracts, negotiations);
          return `
          <article class="panel">
            <div class="chips">
              <span class="tag">${escapeHtml(item.type)}</span>
              <span class="risk ${escapeHtml(item.riskLevel)}">风险${riskLabel(item.riskLevel)}</span>
            </div>
            <h3>${escapeHtml(item.name)}</h3>
            <p class="muted">${escapeHtml(item.industry)}｜${escapeHtml(item.importance)}</p>
            <p>${escapeHtml(item.notes)}</p>
            <p><strong>历史合同：</strong>${contracts.length} 份</p>
            <p><strong>谈判记录：</strong>${negotiations.length} 条</p>
            <div class="reference-list">
              <div class="reference-item">
                <strong>相对方偏好总结</strong>
                <p>${escapeHtml(profile.preference)}</p>
              </div>
              <div class="reference-item">
                <strong>常争议条款</strong>
                <p>${escapeHtml(profile.disputedClauses)}</p>
              </div>
              <div class="reference-item">
                <strong>可接受口径 / 让步空间</strong>
                <p>${escapeHtml(profile.acceptablePositions)}</p>
              </div>
              <div class="reference-item">
                <strong>历史拒绝口径</strong>
                <p>${escapeHtml(profile.rejectedPositions)}</p>
              </div>
              <div class="reference-item">
                <strong>风险偏好 / 谈判耗时</strong>
                <p>${escapeHtml(profile.riskPreference)}｜${escapeHtml(profile.negotiationDuration)}</p>
              </div>
              <div class="reference-item">
                <strong>AI反馈沉淀</strong>
                <p>${escapeHtml(profile.concessionRecord)}</p>
              </div>
              <div class="reference-item">
                <strong>下次谈判提示</strong>
                <p>${escapeHtml(profile.nextMove)}</p>
              </div>
              <div class="reference-item">
                <strong>相对方维度合同时间线</strong>
                <p>${escapeHtml(profile.contractTimeline)}</p>
              </div>
            </div>
            <div class="reference-list">
              ${negotiations.map((record) => referenceItem({ title: "谈判记忆", body: record.ourResponse, meta: record.finalResult })).join("")}
            </div>
          </article>`;
        })
        .join("")}
    </div>
  `;
}

function buildCounterpartyProfile(counterparty, contracts, negotiations) {
  const contractIds = new Set(contracts.map((contract) => contract.id));
  const aiFeedback = (state.aiSuggestionFeedback || []).filter(
    (item) => item.counterpartyId === counterparty.id || contractIds.has(item.contractId)
  );
  const allText = `${counterparty.notes || ""}\n${negotiations.map((item) => `${item.counterpartyPosition}\n${item.ourResponse}\n${item.reason}`).join("\n")}`;
  const feedbackText = aiFeedback.map((item) => `${item.status}\n${item.title}\n${item.note}\n${item.clauseType}\n${item.actionType}`).join("\n");
  const disputed = [];
  const combinedText = `${allText}\n${feedbackText}`;
  if (/责任|赔偿|上限/.test(combinedText)) disputed.push("责任限制/赔偿");
  if (/数据|训练|模型|个人信息/.test(combinedText)) disputed.push("数据使用/模型训练/个人信息");
  if (/付款|账期|发票/.test(combinedText)) disputed.push("付款账期");
  if (/知识产权|侵权|软件|算法/.test(combinedText)) disputed.push("知识产权");
  if (/管辖|仲裁|争议/.test(combinedText)) disputed.push("争议解决");

  const accepted = negotiations
    .filter((item) => /接受|同意|可接受|部分让步|折中/.test(`${item.finalResult}${item.concession}${item.ourResponse}`))
    .map((item) => item.ourResponse)
    .slice(0, 2);
  const rejected = negotiations
    .filter((item) => /拒绝|不同意|未接受|坚持|删除/.test(`${item.finalResult}${item.counterpartyPosition}${item.ourResponse}`))
    .map((item) => item.counterpartyPosition || item.ourResponse)
    .slice(0, 2);
  const concessionCount = negotiations.filter((item) => /让步|折中|接受|同意/.test(`${item.finalResult}${item.concession}${item.ourResponse}`)).length;
  const adoptedAi = aiFeedback.filter((item) => item.status === "adopted").slice(0, 3);
  const rejectedAi = aiFeedback.filter((item) => item.status === "rejected").slice(0, 3);
  const feedbackClauseTypes = [...new Set(aiFeedback.map((item) => item.clauseType).filter(Boolean))].slice(0, 5);
  const timeline = contracts
    .slice()
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
    .map((contract) => `${contract.createdAt || "未记录"} ${contract.name}（${contract.status || "未记录"}）`)
    .join("；");

  return {
    preference:
      disputed.length > 0
        ? `历史上更关注${disputed.join("、")}，谈判中建议先准备这些条款的强保护版和平衡版。`
        : "历史偏好数据仍较少，建议在后续谈判中补充记录对方关注点和接受口径。",
    disputedClauses: disputed.join("、") || "暂无稳定记录",
    acceptablePositions: accepted.join("；") || "暂无明确可接受口径，可从公司平衡版条款开始。",
    rejectedPositions: [
      rejected.join("；"),
      rejectedAi.length ? `AI建议被拒绝：${rejectedAi.map((item) => item.title || item.note).join("；")}` : "",
    ].filter(Boolean).join("；") || "暂无明确拒绝口径。",
    riskPreference:
      contracts.some((contract) => contract.riskLevel === "high") || disputed.length >= 3
        ? "偏审慎：建议提前准备强保护版本和管理层可让步边界"
        : "偏中性：可按标准口径推进，并记录新增偏离",
    negotiationDuration:
      negotiations.length >= 4
        ? `谈判轮次偏长：累计 ${negotiations.length} 条记录，建议先锁定争议清单`
        : `谈判轮次正常：累计 ${negotiations.length} 条记录`,
    concessionRecord: [
      concessionCount ? `历史让步 ${concessionCount} 次` : "暂无明确让步记录",
      adoptedAi.length ? `已采纳AI建议 ${adoptedAi.length} 条：${adoptedAi.map((item) => item.title || item.clauseType || item.actionType).join("；")}` : "",
    ].filter(Boolean).join("；"),
    contractTimeline: timeline || "暂无历史合同时间线",
    nextMove:
      adoptedAi.length || rejectedAi.length
        ? `优先复用本相对方历史 AI 反馈：${feedbackClauseTypes.length ? `重点关注${feedbackClauseTypes.join("、")}。` : "先查看已采纳/拒绝建议。"}`
        : contracts.some((contract) => contract.riskLevel === "high")
        ? "该相对方存在高风险合同记录，建议优先复核数据、责任限制、知识产权和终止条款。"
        : "可先对比同类合同历史口径，确认是否存在需要业务让步的商业条件。",
  };
}

let filterCounterpartiesTimer = null;
const counterpartyProfileCache = new WeakMap();

function filterCounterparties() {
  clearTimeout(filterCounterpartiesTimer);
  filterCounterpartiesTimer = setTimeout(() => {
    const keyword = document.querySelector("#counterparty-search")?.value.trim() || "";
    const type = document.querySelector("#counterparty-type-filter")?.value || "";
    const risk = document.querySelector("#counterparty-risk-filter")?.value || "";
    const items = state.counterparties.filter((item) => {
      const contracts = state.contracts.filter((contract) => contract.counterpartyId === item.id);
      const negotiations = state.negotiations.filter((record) => record.counterpartyId === item.id);
      let profile = counterpartyProfileCache.get(item);
      if (!profile || profile._contractsLen !== contracts.length || profile._negotiationsLen !== negotiations.length) {
        profile = buildCounterpartyProfile(item, contracts, negotiations);
        profile._contractsLen = contracts.length;
        profile._negotiationsLen = negotiations.length;
        counterpartyProfileCache.set(item, profile);
      }
      const haystack = `${item.name}${item.type}${item.industry}${item.importance}${item.notes}${profile.preference}${profile.disputedClauses}${profile.acceptablePositions}${profile.rejectedPositions}${profile.riskPreference}${profile.negotiationDuration}${profile.contractTimeline}${profile.nextMove}${negotiations
        .map((record) => `${record.counterpartyPosition}${record.ourResponse}${record.finalResult}`)
        .join("")}`;
      const matchesKeyword = !keyword || haystack.includes(keyword);
      const matchesType = !type || item.type === type;
      const matchesRisk = !risk || item.riskLevel === risk;
      return matchesKeyword && matchesType && matchesRisk;
    });
    const listNode = document.querySelector("#counterparty-list");
    if (listNode) listNode.innerHTML = renderCounterpartyCards(items);
  }, 150);
}
