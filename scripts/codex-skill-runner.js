const fs = require("fs");
const os = require("os");
const path = require("path");
const { appRoot, buildCodexLaunch, buildRunnerEnv, getCodexCommand } = require("./ai-runner-lib");
const ROOT = appRoot;
const PROMPT_VERSION = "agent-a-review-v1";

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);
  });
}

function compactRequest(request) {
  const text = String(request.contract_text || "");
  const clauses = Array.isArray(request.clauses) ? request.clauses : [];
  return {
    ...request,
    contract_text: text.length > 90000 ? `${text.slice(0, 90000)}\n\n[TRUNCATED_FOR_CODEX_RUNNER]` : text,
    clauses: clauses.slice(0, 220),
  };
}

function buildPrompt(payload) {
  const request = compactRequest(payload.request || payload);
  return [
    "你是 Codex CLI 中的法律工作执行器。必须使用 legal-work-orchestrator skill 作为入口；对于合同审阅任务，按其规则路由到 legal-contract-orchestrator。",
    "",
    "工作方式分两层执行：",
    "第一层，先像在 Codex 对话中直接审阅合同一样完整执行法律工作。不要一开始就被 JSON schema 限制。你应先在内部完成律师式审阅：理解交易目的、我方角色、相对方诉求、合同类型、条款体系、历史版本和条款库口径；识别重大法律风险、商业风险、缺失机制、条款联动和谈判空间；为每一个关键问题拟定可以直接放进合同的改写文本、替代条款、删除理由、批注意见和谈判底线。",
    "第二层，再把第一层的完整审阅成果压缩和规范化为下方 JSON schema。最终只输出 JSON，不输出 Markdown，不输出代码块，不输出你的中间推理。",
    "",
    "第一层审阅质量要求：",
    "1. 像法务独立审阅合同一样工作，不要只做关键词扫描。",
    "2. 每个问题都必须有具体处理动作：新增条款、替换整条、局部修改、删除、仅批注、业务确认。",
    "3. proposedRevision / replacementText / proposedClauseText 必须是可直接粘贴进合同的完整中文条款或具体改写文本，不要写成“建议明确……”这种摘要。",
    "4. 必须从 represented_party 的立场调整条款。若用户要求“更有利于甲方”，先判断我方是否甲方；如不确定，说明工作假设并给出甲方友好文本。",
    "5. 必须进行联动检查：修改责任限制时检查赔偿、保密、知识产权、数据安全；修改终止时检查付款、数据返还、保密存续、知识产权许可；修改数据条款时检查个人信息、模型训练、保密、审计权。",
    "6. 如果合同是股东协议、投资协议或公司治理文件，重点审查出资与股权、公司治理、保护性权利、股权转让、创始人锁定/回购、知识产权、竞业、退出、清算/解散、争议解决。",
    "",
    "第二层结构化规则：",
    "1. 顶层必须包含 response，且必须严格符合输出 schema。",
    "1A. 严格输出 schema 中每一个 properties 字段；不要省略可选含义的字段。不适用的字符串填空字符串，数组填空数组，数字填 0。",
    "1B. response.clauseSegmentation 用于给审阅台提供 Codex 条款切分。请基于完整合同语义切分顶层条款/章节，不要机械依赖正则；如果本地 request.clauses 切分明显错误，应以你的切分为准。stableId 使用稳定短 ID，text 必须来自合同原文，不要改写。",
    "1C. 如果 request.clauses 为空，说明这是打开审阅台后的自动语义切分任务：请优先阅读 contract_text 并输出 clauseSegmentation；不要为了凑数输出合同级风险或条款风险，contractLevelRisks 和 clauseAnalyses 可以为空数组。",
    "1D. 如果某个章节标题与其唯一子条款标题或正文首行完全相同，不要同时输出父章节和子条款两个节点；只保留一个条款节点，避免审阅台出现重复卡片。",
    "1E. Segmentation UI rule: never output a standalone heading-only segment when the same heading is also used by the next substantive clause. Put section/chapter names in chapterTitle metadata; put actual clause text in text. If a parent section has only one child with the same title or first line, output only the child clause node.",
    "1F. Do not duplicate the same words in both title and text unless those words are actually the first line of a longer original clause. A title-only line such as Confidentiality or Contract extra task compensation should not become its own card when it only labels the following clause.",
    "2. 每一个风险必须给出 actionType。合同级风险只能是 add_clause 或 comment_only；条款级风险只能是 replace_clause、revise_clause、delete_clause 或 comment_only。",
    "3. 不要输出泛泛建议。不要把“未识别显著风险、建议结合交易背景复核、建议进一步确认”等作为风险项。",
    "4. 合同级风险只放缺少结构性条款或需要新增合同机制；已有条款需要修改、删除或替换的，必须放入 clauseAnalyses 并尽量匹配 request.clauses 中的 clauseId。",
    "4C. Clause placement is critical. If a recommendation concerns clause 1.3, 1.3.2, or any other numbered subclause, clauseId must be the exact matching request.clauses id for that numbered clause/subclause. Do not attach it to parent clause 1, neighboring clause 1.2, or clause 2 merely because the topic is similar.",
    "4D. Before outputting each clauseAnalyses item, compare the issue/proposedRevision against the target clause text. If the clause text does not contain the relevant obligation, number, title, or concept, search request.clauses again and move the recommendation to the closest exact clause. Prefer exact number match over title/type similarity.",
    "4E. If a recommendation is about a new clause that should sit after an existing clause, use contractLevelRisks only when no existing clause card is a natural anchor. Otherwise include linkedClauseIds and targetInsertPosition so the UI can show it on the most related card.",
    "4A. 对新增条款建议，如果能判断应放在某个章节、某条现有条款之前/之后或与某条现有条款联动，必须填写 targetInsertPosition 和 linkedClauseIds；只有完全没有合理落点的新增机制，才作为纯合同级风险保留。",
    "4B. 同一个新增条款建议只能输出一次。若已作为某个 clauseId 附近的建议或带有明确 targetInsertPosition 的 contractLevelRisk 输出，不要再用不同标题重复输出。",
    "5. 每条重要建议都应填写 negotiationBottomLine、acceptableFallback、linkedClauseIds、qualityScore。qualityScore 为 0-100，评估建议是否具体、匹配我方角色、匹配合同类型、参考历史口径且可直接采纳。",
    "6. response.contractSummary.riskLevel 和每个 severity 只能使用 high / medium / low。",
    "7. 如果 drafting_requirements 或用户要求中出现“目标 clauseId 必须原样返回”，这是条款级聚焦分析：response.clauseAnalyses 只返回该目标条款的建议，clauseId 必须完全等于目标 ID；除非目标条款缺少必要配套机制，否则不要输出 contractLevelRisks。",
    "",
    "合同审阅请求 JSON：",
    JSON.stringify(request, null, 2),
  ].join("\n");
}

function runCodexExec(prompt, outputFile) {
  const schemaPath = path.resolve(ROOT, "schemas", "legal-skill-response.schema.json");
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
      "--cd",
    ROOT,
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputFile,
    "-",
  ];
  const launch = buildCodexLaunch(getCodexCommand(), args);
  return new Promise((resolve, reject) => {
    const child = require("child_process").spawn(launch.command, launch.args, {
      cwd: ROOT,
      shell: false,
      env: buildRunnerEnv({ NO_COLOR: "1" }),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`codex exec failed with code ${code}\n${stderr || stdout}`.trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function parseJsonOutput(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Codex returned empty output");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(raw.slice(first, last + 1));
    throw error;
  }
}

async function main() {
  const payload = JSON.parse((await readStdin()) || "{}");
  const outputFile = path.join(os.tmpdir(), `codex-legal-skill-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await runCodexExec(buildPrompt(payload), outputFile);
  const finalText = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "";
  const parsed = parseJsonOutput(finalText);
  parsed.promptVersion = PROMPT_VERSION;
  parsed.skillPath = "legal-work-orchestrator";
  parsed.downstreamSkill = "legal-contract-orchestrator";
  process.stdout.write(JSON.stringify(parsed, null, 2));
}

main().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
