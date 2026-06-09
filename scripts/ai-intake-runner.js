const { compact, printJson, readStdinJson, runJsonTask } = require("./ai-runner-lib");
const PROMPT_VERSION = "contract-intake-v1";

function buildPrompt(payload) {
  const contractText = compact(payload.contractText || "", 90000);
  return [
    "你是合同审阅工作台的新建审阅信息填充助手。",
    "如果运行环境支持 Codex skills，请优先使用 legal-work-orchestrator；如果是 Kimi 或其他 OpenAI-compatible 模型，请直接完成同等信息抽取任务。",
    "",
    "任务：阅读上传的合同初稿，提取用于创建新审阅事项的结构化字段。",
    "",
    "输出规则：",
    "1. 只输出 JSON，严格匹配 schema。",
    "2. contractName：优先使用文件标题或合同标题；没有明确标题时，用合同类型和相对方生成简洁名称。",
    "3. contractType：给出对法务审阅有帮助的合同类型，例如 AI 产品试用及数据处理协议、SaaS 服务协议、保密协议、股权投资协议等。",
    "4. counterparty：识别相对方名称；无法判断则留空，不要猜。",
    "5. ourRole：识别我方角色；不清楚则填“待确认”，并加入 missingFacts。",
    "6. purpose：一句话说明交易或合同目的。",
    "7. businessBackground：写一段可直接填入工作台的中文背景，包含交易背景、核心义务、谈判重点和需确认事实。",
    "8. confidence：0 到 100 的数字。",
    "9. missingFacts：列出正式审阅前用户应确认的事实。",
    "",
    "合同文本：",
    contractText,
  ].join("\n");
}

async function main() {
  const payload = await readStdinJson();
  const result = await runJsonTask({
    prompt: buildPrompt(payload),
    schemaPath: "schemas/contract-intake-response.schema.json",
    outputPrefix: "legal-ai-intake",
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
