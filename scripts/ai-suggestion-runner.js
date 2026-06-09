const { printJson, readStdinJson, runJsonTask } = require("./ai-runner-lib");
const PROMPT_VERSION = "suggestion-action-v1";

function buildPrompt(payload) {
  return [
    "你是合同审阅工作台的 AI 建议动作后端。",
    "任务：根据用户在审阅台对某条 AI 建议的操作，返回一个可由前端直接执行的结构化动作。",
    "",
    "规则：",
    "1. 先理解合同、目标条款、父条款、AI 建议、我方角色、用户动作和用户补充要求。",
    "2. userAction=adopt 时，判断是新增、替换、局部修改、删除还是仅批注，并返回 editedText 或 insertedClause。",
    "3. userAction=adjust 时，根据 userInstruction 改写建议后再返回动作。",
    "4. userAction=reject 时，返回 rejectionReason 和 knowledgeNote，供后续条款库或相对方画像沉淀。",
    "5. actionType=add_clause 时 insertedClause 必须完整；不是新增时 insertedClause 使用空字段且 position 为 none。",
    "6. editedText 必须是完整可执行的中文条款文本；不适用时填空字符串。",
    "7. comment 应说明采纳、调整、业务确认或拒绝的法律/谈判理由，供 Word 批注使用。",
    "8. 只输出 JSON，不输出 Markdown。",
    "",
    "请求 JSON：",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

async function main() {
  const payload = await readStdinJson();
  const result = await runJsonTask({
    prompt: buildPrompt(payload),
    schemaPath: "schemas/suggestion-action-response.schema.json",
    outputPrefix: "legal-ai-suggestion",
  });
  result.promptVersion = PROMPT_VERSION;
  result.skillPath = "legal-work-orchestrator";
  result.downstreamSkill = "legal-contract-orchestrator";
  printJson(result);
}

main().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
