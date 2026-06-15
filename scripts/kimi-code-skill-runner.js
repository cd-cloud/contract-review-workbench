const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { appRoot, buildRunnerEnv } = require("./ai-runner-lib");
const ROOT = appRoot;
const PROMPT_VERSION = "agent-a-review-v1";
const KIMI_RUNNER_TIMEOUT_MS = Number(process.env.KIMI_RUNNER_TIMEOUT_MS || process.env.LEGAL_WORKBENCH_KIMI_RUNNER_TIMEOUT_MS || 0) || 180000;
const KIMI_MAX_CONTRACT_TEXT = Number(process.env.KIMI_RUNNER_MAX_CONTRACT_TEXT || 0) || 30000;
const KIMI_MAX_CLAUSES = Number(process.env.KIMI_RUNNER_MAX_CLAUSES || 0) || 120;
let iconvLite = null;
try {
  iconvLite = require("iconv-lite");
} catch (error) {
  iconvLite = null;
}

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
  const compactText = text.length > KIMI_MAX_CONTRACT_TEXT
    ? `${text.slice(0, Math.floor(KIMI_MAX_CONTRACT_TEXT * 0.7))}\n\n[TRUNCATED_MIDDLE_FOR_KIMI_RUNNER]\n\n${text.slice(-Math.floor(KIMI_MAX_CONTRACT_TEXT * 0.3))}`
    : text;
  return {
    ...request,
    contract_text: compactText,
    clauses: clauses.slice(0, KIMI_MAX_CLAUSES),
  };
}

function buildPromptLegacy(payload) {
  const request = compactRequest(payload.request || payload);
  const schemaText = buildCompactSchemaGuide();
  return [
    "你是 Kimi Code CLI 中的法律工作执行器。必须使用 legal-work-orchestrator skill 作为入口；对于合同审阅任务，按其规则路由到 legal-contract-orchestrator。",
    "",
    "工作方式分两层执行：",
    "第一层，先像在 Kimi 对话中直接审阅合同一样完整执行法律工作。不要一开始就被 JSON schema 限制。你应先在内部完成律师式审阅：理解交易目的、我方角色、相对方诉求、合同类型、条款体系、历史版本和条款库口径；识别重大法律风险、商业风险、缺失机制、条款联动和谈判空间；为每一个关键问题拟定可以直接放进合同的改写文本、替代条款、删除理由、批注意见和谈判底线。",
    "第二层，再把第一层的完整审阅成果压缩和规范化为下方 JSON schema。最终只输出 JSON，不输出 Markdown，不输出代码块，不输出你的中间推理。",
    "",
    "第一层审阅质量要求：",
    "1. 像法务独立审阅合同一样工作，不要只做关键词扫描。",
    "2. 每个问题都必须有具体处理动作：新增条款、替换整条、局部修改、删除、仅批注、业务确认。",
    "3. proposedRevision / replacementText / proposedClauseText 必须是可直接粘贴进合同的完整中文条款或具体改写文本，不要写成\"建议明确……\"这种摘要。",
    "4. 必须从 represented_party 的立场调整条款。若用户要求\"更有利于甲方\"，先判断我方是否甲方；如不确定，说明工作假设并给出甲方友好文本。",
    "5. 必须进行联动检查：修改责任限制时检查赔偿、保密、知识产权、数据安全；修改终止时检查付款、数据返还、保密存续、知识产权许可；修改数据条款时检查个人信息、模型训练、保密、审计权。",
    "6. 如果合同是股东协议、投资协议或公司治理文件，重点审查出资与股权、公司治理、保护性权利、股权转让、创始人锁定/回购、知识产权、竞业、退出、清算/解散、争议解决。",
    "",
    "第二层结构化规则：",
    "1. 顶层必须包含 response，且必须严格符合输出 schema。",
    "1A. 严格输出 schema 中每一个 properties 字段；不要省略可选含义的字段。不适用的字符串填空字符串，数组填空数组，数字填 0。",
    "1B. response.clauseSegmentation 用于给审阅台提供条款切分。请基于完整合同语义切分顶层条款/章节，不要机械依赖正则；如果本地 request.clauses 切分明显错误，应以你的切分为准。stableId 使用稳定短 ID，text 必须来自合同原文，不要改写。",
    "1C. 如果 request.clauses 为空，说明这是打开审阅台后的自动语义切分任务：请优先阅读 contract_text 并输出 clauseSegmentation；不要为了凑数输出合同级风险或条款风险，contractLevelRisks 和 clauseAnalyses 可以为空数组。",
    "1D. 如果某个章节标题与其唯一子条款标题或正文首行完全相同，不要同时输出父章节和子条款两个节点；只保留一个条款节点，避免审阅台出现重复卡片。",
    "1E. Segmentation UI rule: never output a standalone heading-only segment when the same heading is also used by the next substantive clause. Put section/chapter names in chapterTitle metadata; put actual clause text in text. If a parent section has only one child with the same title or first line, output only the child clause node.",
    "1F. Do not duplicate the same words in both title and text unless those words are actually the first line of a longer original clause. A title-only line such as Confidentiality or Contract extra task compensation should not become its own card when it only labels the following clause.",
    "2. 每一个风险必须给出 actionType。合同级风险只能是 add_clause 或 comment_only；条款级风险只能是 replace_clause、revise_clause、delete_clause 或 comment_only。",
    "3. 不要输出泛泛建议。不要把\"未识别显著风险、建议结合交易背景复核、建议进一步确认\"等作为风险项。",
    "4. 合同级风险只放缺少结构性条款或需要新增合同机制；已有条款需要修改、删除或替换的，必须放入 clauseAnalyses 并尽量匹配 request.clauses 中的 clauseId。",
    "4C. Clause placement is critical. If a recommendation concerns clause 1.3, 1.3.2, or any other numbered subclause, clauseId must be the exact matching request.clauses id for that numbered clause/subclause. Do not attach it to parent clause 1, neighboring clause 1.2, or clause 2 merely because the topic is similar.",
    "4D. Before outputting each clauseAnalyses item, compare the issue/proposedRevision against the target clause text. If the clause text does not contain the relevant obligation, number, title, or concept, search request.clauses again and move the recommendation to the closest exact clause. Prefer exact number match over title/type similarity.",
    "4E. If a recommendation is about a new clause that should sit after an existing clause, use contractLevelRisks only when no existing clause card is a natural anchor. Otherwise include linkedClauseIds and targetInsertPosition so the UI can show it on the most related card.",
    "4A. 对新增条款建议，如果能判断应放在某个章节、某条现有条款之前/之后或与某条现有条款联动，必须填写 targetInsertPosition 和 linkedClauseIds；只有完全没有合理落点的新增机制，才作为纯合同级风险保留。",
    "4B. 同一个新增条款建议只能输出一次。若已作为某个 clauseId 附近的建议或带有明确 targetInsertPosition 的 contractLevelRisk 输出，不要再用不同标题重复输出。",
    "5. 每条重要建议都应填写 negotiationBottomLine、acceptableFallback、linkedClauseIds、qualityScore。qualityScore 为 0-100，评估建议是否具体、匹配我方角色、匹配合同类型、参考历史口径且可直接采纳。",
    "6. response.contractSummary.riskLevel 和每个 severity 只能使用 high / medium / low。",
    "7. 如果 drafting_requirements 或用户要求中出现\"目标 clauseId 必须原样返回\"，这是条款级聚焦分析：response.clauseAnalyses 只返回该目标条款的建议，clauseId 必须完全等于目标 ID；除非目标条款缺少必要配套机制，否则不要输出 contractLevelRisks。",
    "",
    "合同审阅请求 JSON：",
    "Output JSON schema (must be followed exactly):",
    schemaText,
    "",
    "Return exactly one JSON object matching the schema. The top-level object must include ok and response. Do not repeat or echo the request JSON.",
    "",
    "Contract review request JSON:",
    JSON.stringify(request, null, 2),
  ].join("\n");
}

function buildCompactSchemaGuide() {
  return JSON.stringify({
    ok: true,
    response: {
      contractSummary: {
        contractName: "",
        contractType: "",
        purpose: "",
        ourRole: "",
        counterparty: "",
        riskLevel: "high|medium|low",
        completionScore: 0,
        positionDeviationLevel: "",
      },
      clauseSegmentation: [
        {
          stableId: "stable short id",
          order: 1,
          title: "",
          text: "original clause text",
          type: "",
          chapterTitle: "",
          hierarchyLevel: "preface|chapter|article",
        },
      ],
      contractLevelRisks: [
        {
          severity: "high|medium|low",
          actionType: "add_clause|comment_only",
          title: "",
          issue: "",
          consequence: "",
          suggestion: "",
          proposedClauseText: "",
          targetInsertPosition: "",
          businessRationale: "",
          adoptionNote: "",
          negotiationBottomLine: "",
          acceptableFallback: "",
          linkedClauseIds: [],
          qualityScore: 0,
        },
      ],
      clauseAnalyses: [
        {
          clauseId: "",
          title: "",
          clauseType: "",
          severity: "high|medium|low",
          actionType: "replace_clause|revise_clause|delete_clause|comment_only",
          issue: "",
          consequence: "",
          proposedRevision: "",
          targetText: "",
          replacementText: "",
          commentText: "",
          negotiationPosition: "",
          fallbackText: "",
          businessDecision: "",
          adoptionNote: "",
          negotiationBottomLine: "",
          acceptableFallback: "",
          linkedClauseIds: [],
          qualityScore: 0,
        },
      ],
      missingFacts: [],
      businessSummary: "",
    },
  }, null, 2);
}

function buildPrompt(payload) {
  const request = compactRequest(payload.request || payload);
  return [
    "You are a Chinese legal contract review agent for a local contract-review workbench.",
    "Review the contract from represented_party's position. Identify material legal/commercial risks, missing core clauses, clause-level revisions, and negotiation fallback positions.",
    "Return only one JSON object. Do not use Markdown or code fences. Do not echo the request.",
    "All user-facing text inside the JSON should be Chinese. Use high, medium, or low for risk levels.",
    "",
    "Required output shape:",
    buildCompactSchemaGuide(),
    "",
    "Rules:",
    "- response is required.",
    "- clauseSegmentation should split contract_text into meaningful original clauses. text must come from the original contract.",
    "- contractLevelRisks is for missing mechanisms or add-clause recommendations.",
    "- clauseAnalyses is for existing clauses that should be replaced, revised, deleted, or commented on.",
    "- proposedClauseText, proposedRevision, replacementText, and commentText should be concrete text that a lawyer can directly use.",
    "- If request.clauses is empty, prioritize clauseSegmentation and still provide important risks when visible from contract_text.",
    "",
    "Contract review request JSON:",
    JSON.stringify(request, null, 2),
  ].join("\n");
}

function getKimiCommand() {
  const configured = process.env.KIMI_CLI_COMMAND || process.env.KIMI_CODE_COMMAND;
  if (configured) return configured;
  // Kimi Code CLI is bundled with VS Code extension on Windows
  const appData = process.env.APPDATA || process.env.USERPROFILE || "";
  const globalStorage = appData
    ? path.join(appData, "Code", "User", "globalStorage", "moonshot-ai.kimi-code", "bin", "kimi", "kimi.exe")
    : "";
  if (globalStorage && fs.existsSync(globalStorage)) return globalStorage;
  return "kimi";
}

function runKimiExec(prompt) {
  const kimiCommand = getKimiCommand();
  const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), "legal-workbench-kimi-"));
  const promptFile = path.join(promptDir, "prompt.md");
  fs.writeFileSync(promptFile, prompt, "utf8");
  const promptFileForKimi = promptFile.replace(/\\/g, "/");
  const args = [
    "--print",
    "-p", [
      "Read the UTF-8 prompt file below and follow it exactly.",
      "Return only the final JSON object requested by that file.",
      `Prompt file: ${promptFileForKimi}`,
    ].join("\n"),
    "--yolo",
    "--output-format", "stream-json",
    "--final-message-only",
    "--work-dir", ROOT,
    "--add-dir", promptDir,
  ];
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      child = spawn(kimiCommand, args, {
        cwd: ROOT,
        shell: false,
        env: buildRunnerEnv({ NO_COLOR: "1" }),
        windowsHide: true,
      });
    } catch (error) {
      cleanupPromptFile();
      reject(error);
      return;
    }
    const stdoutChunks = [];
    const stderrChunks = [];
    const timeout = setTimeout(() => {
      settleReject(new Error(`Kimi CLI timed out after ${KIMI_RUNNER_TIMEOUT_MS}ms`));
    }, KIMI_RUNNER_TIMEOUT_MS);

    function killChild() {
      try { child.kill("SIGTERM"); } catch (e) {}
      setTimeout(() => {
        try { if (!child.killed) child.kill("SIGKILL"); } catch (e) {}
      }, 3000);
    }

    function settleReject(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanupSignals();
      cleanupPromptFile();
      killChild();
      reject(error);
    }

    function settleResolve(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanupSignals();
      cleanupPromptFile();
      resolve(value);
    }

    function onParentExit() {
      killChild();
    }

    function cleanupSignals() {
      process.removeListener("SIGTERM", onParentExit);
      process.removeListener("SIGINT", onParentExit);
      process.removeListener("exit", onParentExit);
    }

    function cleanupPromptFile() {
      try { fs.rmSync(promptDir, { recursive: true, force: true }); } catch (error) {}
    }

    process.once("SIGTERM", onParentExit);
    process.once("SIGINT", onParentExit);
    process.once("exit", onParentExit);

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });
    child.on("error", settleReject);
    child.on("close", (code) => {
      cleanupSignals();
      if (settled) return;
      if (code !== 0) {
        const stdout = decodeKimiBuffer(Buffer.concat(stdoutChunks));
        const stderr = decodeKimiBuffer(Buffer.concat(stderrChunks));
        settleReject(new Error(`kimi exec failed with code ${code}\n${stderr || stdout}`.trim()));
        return;
      }
      const stdout = decodeKimiBuffer(Buffer.concat(stdoutChunks));
      const stderr = decodeKimiBuffer(Buffer.concat(stderrChunks));
      settleResolve({ stdout, stderr });
    });
  });
}

function decodeKimiBuffer(buffer) {
  const utf8 = buffer.toString("utf8");
  if (!iconvLite) return utf8;
  const gbk = iconvLite.decode(buffer, "gbk");
  return mojibakeScore(gbk) < mojibakeScore(utf8) ? gbk : utf8;
}

function mojibakeScore(text) {
  const source = String(text || "");
  const replacement = (source.match(/\uFFFD/g) || []).length;
  const common = (source.match(/[ÃÂâ�]/g) || []).length;
  return replacement * 4 + common;
}

function parseKimiOutput(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).filter(Boolean);
  // Kimi outputs JSON lines; the assistant message is {"role":"assistant","content":"..."}
  // There may also be a "To resume this session" line at the end.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{")) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.role === "assistant" && typeof parsed.content === "string") {
          return parsed.content;
        }
      } catch (e) {
        // not valid JSON, continue
      }
    }
  }
  // Fallback: try to parse the whole stdout as JSON
  try {
    const parsed = JSON.parse(String(stdout || "").trim());
    if (parsed.role === "assistant" && typeof parsed.content === "string") {
      return parsed.content;
    }
  } catch (e) {
    // not valid JSON
  }
  return stdout;
}

function parseJsonOutput(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Kimi returned empty output");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const fences = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
    for (let i = fences.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(fences[i][1].trim());
      } catch (fenceError) {}
    }
    const candidates = extractJsonObjectCandidates(raw);
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (candidateError) {}
    }
    throw error;
  }
}

function extractJsonObjectCandidates(text) {
  const candidates = [];
  const source = String(text || "");
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(source.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates.sort((a, b) => b.length - a.length);
}

async function main() {
  const payload = JSON.parse((await readStdin()) || "{}");
  const { stdout } = await runKimiExec(buildPrompt(payload));
  const finalText = parseKimiOutput(stdout);
  const parsed = parseJsonOutput(finalText);
  if (!parsed || typeof parsed !== "object" || !parsed.response) {
    throw new Error("Kimi did not return legal-skill JSON with a response object.");
  }
  parsed.promptVersion = PROMPT_VERSION;
  parsed.skillPath = "legal-work-orchestrator";
  parsed.downstreamSkill = "legal-contract-orchestrator";
  process.stdout.write(JSON.stringify(parsed, null, 2));
}

main().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
