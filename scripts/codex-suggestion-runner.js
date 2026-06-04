const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");

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

function buildPrompt(payload) {
  return [
    "你是合同审阅工作台的后端 Codex 建议动作裁判。必须使用 legal-work-orchestrator 作为法律工作入口，并按合同审阅任务路由到 legal-contract-orchestrator。",
    "",
    "任务：根据用户在审阅台上对某条 AI 建议的动作，返回结构化结果。adopt 才代表正式写入合同；adjust 只代表改写建议草稿，不代表已经采纳或写入正式条款。",
    "",
    "工作规则：",
    "1. 先理解合同、目标条款、AI建议、我方角色、用户动作和用户补充要求。",
    "2. 如果动作是 adopt，请判断是新增、替换、局部修改、删除还是仅批注，并给出可直接写入合同的 editedText 或 insertedClause。",
    "3. 如果动作是 adjust，请根据 userInstruction 对建议文本进行进一步调整，输出调整后的 editedText 或 insertedClause；这些内容仅用于刷新建议卡片，不能视为正式修改合同。",
    "4. 如果动作是 reject，请输出 rejectionReason 和 knowledgeNote，用于后续条款库/相对方偏好沉淀。",
    "5. 如果 actionType 是 add_clause，insertedClause 必须完整；如果不是新增，insertedClause 字符串字段填空字符串，position 填 none。",
    "6. editedText 必须是完整可执行的中文条款文本；不适用时填空字符串。",
    "7. comment 要说明采纳、调整、业务确认或拒绝的法律/谈判理由，供 Word 批注使用。",
    "8. 不要输出 Markdown，不要输出解释，只输出 JSON。",
    "",
    "请求 JSON：",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

function runCodexExec(prompt, outputFile) {
  const defaultCodexExe = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "codex.exe")
    : "";
  const codexCommand = process.env.CODEX_CLI_COMMAND || (defaultCodexExe && fs.existsSync(defaultCodexExe) ? defaultCodexExe : "codex");
  const schemaPath = path.resolve(appRoot, "schemas", "suggestion-action-response.schema.json");
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--cd",
    appRoot,
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputFile,
    "-",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(codexCommand, args, {
      cwd: appRoot,
      shell: false,
      env: { ...process.env, NO_COLOR: "1" },
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
  const outputFile = path.join(os.tmpdir(), `codex-suggestion-action-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await runCodexExec(buildPrompt(payload), outputFile);
  const finalText = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "";
  process.stdout.write(JSON.stringify(parseJsonOutput(finalText), null, 2));
}

main().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exit(1);
});
