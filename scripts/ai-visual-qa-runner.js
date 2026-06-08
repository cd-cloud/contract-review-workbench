const { compact, getProviderStatus, printJson, readStdinJson, runJsonTask } = require("./ai-runner-lib");

function buildPrompt(payload) {
  const request = payload.request || payload;
  const provider = getProviderStatus();
  const compactRequest = {
    ...request,
    contractText: compact(request.contractText || "", 16000),
    clauses: Array.isArray(request.clauses) ? request.clauses.slice(0, 140) : [],
    findings: Array.isArray(request.findings) ? request.findings.slice(0, 100) : [],
    actions: Array.isArray(request.actions) ? request.actions.slice(0, 100) : [],
    insertedClauses: Array.isArray(request.insertedClauses) ? request.insertedClauses.slice(0, 60) : [],
    localChecks: Array.isArray(request.localChecks) ? request.localChecks.slice(0, 60) : [],
  };
  return [
    "你是合同审阅工作台的 Agent B：Visual QA 与交付一致性代理。",
    `当前模型接入方式：${provider.provider}${provider.model ? ` / ${provider.model}` : ""}。`,
    "你的职责不是重新做法律审阅，而是检查 Agent A 的审阅结果在 Web UI、条款结构、建议归属、编号、红线/批注和交付准备中的呈现是否一致、清楚、可用。",
    "",
    "边界：",
    "1. 不新增新的实质法律风险意见，除非它是展示、交付或一致性问题。",
    "2. 不改写合同法律条款；只指出可视化、结构、编号、建议归属和导出准备问题。",
    "3. 新增类 AI 建议在建议阶段不得有独立正式编号；只有采纳进入正式合同结构后才编号，可标记为“待采纳后编号”。",
    "4. 修订类 AI 建议可以沿用目标条款编号，但不得让建议文本看起来像独立新条款。",
    "5. 检查父子条款是否重复展示同一正文、正文是否被当成标题、是否有空标题卡片、建议是否重复出现在多个卡片、建议是否放错卡片。",
    "6. 检查正式条款编号是否符合合同结构：原条款、采纳新增条款、采纳修订后的条款统一编号；未采纳新增建议不编号。",
    "7. 导出相关问题只作为 blockingExportIssues，不要把所有问题都标为阻断。",
    "",
    "建议归属修复规则：",
    "1. 如果发现建议放错卡片，请放入 suggestionPlacementIssues，并尽量填写 findingId、fromClauseId、toClauseId、confidence。",
    "2. 如果能安全判断只是归属错误、不会改动法律内容，请同时在 autoFixes 中给出 operation=relocate_finding，填写同样的 findingId、fromClauseId、toClauseId、confidence，safeToApply=true。",
    "3. 如果只知道建议不该在当前卡片，但无法可靠判断目标条款，放入 manualReviewItems，不要给 safeToApply=true。",
    "4. 对新增条款建议，优先放到最相关章节或相邻目标条款；找不到对应章节或条款时，才保留为合同级风险提示。",
    "5. 同一个新增条款建议只应出现一处；重复出现时给出 operation=dedupe_finding。",
    "6. 正文和附件存在相同编号时，必须结合 chapterTitle、documentRegion、上下文和 targetText 判断，不得只按编号迁移。",
    "",
    "输出要求：",
    "1. 只输出 JSON，严格符合 schema。",
    "2. status=blocked 仅用于存在会导致导出错误或明显误导用户的高风险展示/结构问题。",
    "3. autoFixes 只能列可安全自动修复的 UI/结构事项，例如重定位建议、去重、隐藏重复标题、建议展示去编号；不要自动修改法律内容。",
    "",
    "工作台当前状态 JSON：",
    "Input note: the JSON below is a truncated Visual QA snapshot optimized for fast checking, not the full contract package.",
    "Some contractText, clause text, findings, actions, and inserted clauses may be shortened or omitted for speed.",
    "Do not assume a missing detail means the original document lacked it. Judge only issues supported by this snapshot.",
    JSON.stringify(compactRequest, null, 2),
  ].join("\n");
}

async function main() {
  const payload = await readStdinJson();
  const result = await runJsonTask({
    prompt: buildPrompt(payload),
    schemaPath: "schemas/visual-qa-response.schema.json",
    outputPrefix: "legal-visual-qa",
    systemPrompt: "You are Agent B, the Visual QA backend for a contract review workbench. Return valid JSON only. All user-facing text should be in Chinese.",
  });
  printJson(result);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(error.stack || String(error));
    process.exit(1);
  });
}

module.exports = { buildPrompt };
