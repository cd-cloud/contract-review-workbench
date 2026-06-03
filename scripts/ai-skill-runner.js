const { compact, getProviderStatus, printJson, readStdinJson, runJsonTask } = require("./ai-runner-lib");

function buildPrompt(payload) {
  const request = payload.request || payload;
  const provider = getProviderStatus();
  const compactRequest = {
    ...request,
    contract_text: compact(request.contract_text || "", 90000),
    clauses: Array.isArray(request.clauses) ? request.clauses.slice(0, 220) : [],
  };
  return [
    "你是合同审阅工作台的 Agent A：法律审阅与建议生成代理。",
    `当前模型接入方式：${provider.provider}${provider.model ? ` / ${provider.model}` : ""}。`,
    "如果运行环境支持 Codex skills，请优先使用 legal-work-orchestrator，并按合同审阅任务路由；如果当前是 Kimi、Moonshot 或其他 OpenAI-compatible 模型，请直接完成同等法律审阅任务，并严格按 schema 输出。",
    "",
    "核心分工：",
    "1. Agent A 对合同理解、条款切分、风险识别、修改建议、建议归属负主责。",
    "2. Agent B 只负责 UI、结构、编号、建议归属和导出一致性的复核与纠偏，不重新生成实质法律建议。",
    "3. 因此每一条建议都必须尽可能绑定到最精确的 request.clauses clauseId。",
    "",
    "审阅方式：",
    "1. 先完整理解交易目的、我方角色、相对方诉求、合同类型、条款体系、历史版本和条款库口径。",
    "2. 识别重大法律风险、商业风险、缺失机制、条款联动和谈判空间。",
    "3. 每个重要问题都要给出可以直接放进合同的中文改写文本、替代条款、删除理由、批注意见、谈判底线和可让步方案。",
    "4. 最终只输出 JSON，不输出 Markdown、代码块或中间推理。",
    "",
    "条款切分规则：",
    "1. response.clauseSegmentation 必须基于合同语义和章节结构，不要机械依赖正则。",
    "2. text 必须来自合同原文，不得改写原文。",
    "3. 有明确编号时必须遵照原合同编号，不得自行新增父条款、合并多个正式条款或改变原有编号层级。",
    "4. 不要输出孤立标题卡片；章节名尽量放入 chapterTitle，实际合同内容放入 text。",
    "5. 如果标题已经完整出现在 title 或 chapterTitle 中，text 不要再重复放同一标题行。",
    "6. 如果父章节标题与唯一子条款标题或正文首行完全相同，只保留一个条款节点，避免 UI 中父子卡片展示同一内容。",
    "7. 正文和附件可能出现相同编号；必须结合 chapterTitle、上下文和原文片段区分，不得把附件 2.2 的建议挂到正文 2.2。",
    "",
    "建议归属强规则：",
    "1. 已有条款需要修改、删除、替换或批注的，必须放入 clauseAnalyses。",
    "2. 如果建议针对 1.3、2.3.2 或任何编号子条款，clauseId 必须是 request.clauses 中该编号子条款的精确 ID；不得挂到父条款、相邻条款或同主题但不同编号的条款。",
    "3. 输出每条 clauseAnalyses 前，必须核对 targetText / issue / proposedRevision 是否确实对应目标 clauseId 的正文；若不对应，重新搜索 request.clauses 并移动到最精确条款。",
    "4. 显式编号优先级最高：编号匹配 > 原文 targetText 片段匹配 > 标题/章节匹配 > 语义相似。",
    "5. 新增条款建议如有自然锚点，应使用 linkedClauseIds 和 targetInsertPosition，让 UI 放到最相关卡片；只有完全无法定位时才放入 contractLevelRisks。",
    "6. 同一个新增条款建议只能输出一次，不得既出现在合同级风险又出现在多个条款卡片。",
    "7. 如果无法可靠定位，宁可放入 contractLevelRisks 或写明需要人工确认，不要随意挂到相邻条款。",
    "",
    "质量要求：",
    "1. 不要输出泛泛建议，不要把“建议进一步确认”单独作为风险。",
    "2. proposedRevision / replacementText / proposedClauseText 必须是可直接粘贴进合同的完整中文文本。",
    "3. 每条重要建议都要填写 negotiationBottomLine、acceptableFallback、linkedClauseIds、qualityScore。",
    "4. riskLevel 和 severity 只能使用 high / medium / low。",
    "",
    "合同审阅请求 JSON：",
    JSON.stringify(compactRequest, null, 2),
  ].join("\n");
}

async function main() {
  const payload = await readStdinJson();
  const result = await runJsonTask({
    prompt: buildPrompt(payload),
    schemaPath: "schemas/legal-skill-response.schema.json",
    outputPrefix: "legal-ai-skill",
    systemPrompt: "You are Agent A for a contract review workbench. Return valid JSON only. All user-facing legal content should be in Chinese.",
  });
  printJson(result);
}

main().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
