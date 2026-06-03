function renderDrafting() {
  const contractTypes = [...new Set(["SaaS 服务合同", "数据采购合同", "商业服务合同", ...state.contracts.map((item) => item.type).filter(Boolean)])];
  const roles = [...new Set(["服务提供方", "采购方", "数据接收方", "数据提供方", ...state.contracts.map((item) => item.ourRole).filter(Boolean)])];
  views.drafting.innerHTML = `
    <div class="two-col">
      <section class="panel">
        <p class="eyebrow">Drafting</p>
        <h3 class="section-title">合同起草输入</h3>
        <form class="inline-form" id="draft-form">
          <label>
            合同类型
            <input id="draft-contract-type" list="draft-contract-types" placeholder="例如：SaaS 服务合同" />
            <datalist id="draft-contract-types">${contractTypes.map((item) => `<option value="${escapeHtml(item)}"></option>`).join("")}</datalist>
          </label>
          <label>
            交易背景
            <textarea id="draft-background" rows="4" placeholder="说明交易目的、服务/数据/产品内容、关键商业安排。"></textarea>
          </label>
          <label>
            我方角色
            <input id="draft-role" list="draft-role-list" placeholder="例如：服务提供方 / 采购方" />
            <datalist id="draft-role-list">${roles.map((item) => `<option value="${escapeHtml(item)}"></option>`).join("")}</datalist>
          </label>
          <label>
            相对方
            <input id="draft-counterparty" list="draft-counterparty-list" placeholder="选择或输入相对方" />
            <datalist id="draft-counterparty-list">${state.counterparties.map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join("")}</datalist>
          </label>
          <button class="primary-button" type="submit">生成合同初稿</button>
        </form>
      </section>
      <section class="panel">
        <p class="eyebrow">Draft Output</p>
        <h3 class="section-title">起草结果</h3>
        <div id="draft-output">${renderDraftOutput()}</div>
      </section>
    </div>
  `;
}

function renderDraftOutput() {
  const draft = state.currentDraft;
  if (!draft) return `<div class="empty">填写左侧信息后生成初稿。系统会优先调用同类合同、同一相对方历史做法和条款库口径。</div>`;
  return `
    <div class="reference-list">
      <div class="reference-item">
        <strong>${escapeHtml(draft.title)}</strong>
        <p class="muted">${escapeHtml(draft.summary)}</p>
        <button class="ghost-button" type="button" data-create-review-from-draft>转为新建审阅</button>
      </div>
      <div class="contract-text-view">${escapeHtml(draft.text)}</div>
      <div class="reference-item">
        <strong>条款来源</strong>
        ${(draft.sources || []).map((source) => `<p>${escapeHtml(source)}</p>`).join("")}
      </div>
      <div class="reference-item">
        <strong>待确认事项</strong>
        ${(draft.openItems || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
      </div>
    </div>
  `;
}

function generateDraftContract({ type, background, role, counterparty }) {
  const matchingContracts = state.contracts.filter((contract) => contract.type === type || contract.counterpartyName === counterparty);
  const selectedPlaybooks = state.playbooks
    .filter((item) => item.reviewStatus !== "disabled")
    .filter((item) => !type || item.contractTypes.includes(type) || item.ourRole === role)
    .slice(0, 8);
  const sources = [
    ...matchingContracts.slice(0, 3).map((contract) => `历史合同：${contract.name}｜${contract.counterpartyName}`),
    ...selectedPlaybooks.map((item) => `条款库：${item.type}｜${item.ourRole}`),
  ];
  const openItems = [
    "确认交易金额、付款节点、发票要求和预算归属。",
    "确认数据、模型训练、个人信息处理和安全附件是否适用。",
    "确认责任上限、例外事项、签署主体和授权链条。",
  ];
  const clauses = selectedPlaybooks.length
    ? selectedPlaybooks.map((item, index) => `第${numberToChinese(index + 1)}条 ${item.type}\n${item.standard}`)
    : [
        "第一条 服务内容\n双方应根据订单、附件或工作说明书确认服务范围、交付标准和验收流程。",
        "第二条 费用与付款\n甲方应按照订单约定支付费用；逾期付款的，应承担违约责任。",
        "第三条 保密\n双方应对合作过程中获悉的非公开信息承担保密义务。",
        "第四条 知识产权\n双方应明确既有知识产权、交付成果和业务数据的权属。",
        "第五条 争议解决\n因本合同产生的争议，双方应友好协商；协商不成的，提交有管辖权法院解决。",
      ];
  return {
    title: `${type || "合同"}初稿`,
    summary: `${role || "我方"}与${counterparty || "相对方"}之间的合同初稿；已结合 ${sources.length} 条历史或条款库来源。`,
    text: `${type || "合同"}\n\n交易背景：${background || "待补充"}\n我方角色：${role || "待确认"}\n相对方：${counterparty || "待确认"}\n\n${clauses.join("\n\n")}`,
    sources,
    openItems,
    type,
    background,
    role,
    counterparty,
  };
}
