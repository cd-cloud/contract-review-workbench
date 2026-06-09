const fs = require("fs");
const os = require("os");
const path = require("path");
const { appRoot, buildCodexLaunch, getCodexCommand } = require("./ai-runner-lib");
const ROOT = appRoot;
const PROMPT_VERSION = "contract-intake-v1";

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
  const contractText = String(payload.contractText || "").slice(0, 90000);
  return [
    "You are the Codex intake assistant for a legal contract review workbench.",
    "You must use legal-work-orchestrator as the legal front door and route contract matters to legal-contract-orchestrator.",
    "",
    "Task: read the uploaded contract draft and extract structured fields for creating a new review matter. User-facing field values should be written in Chinese unless the source name is in another language.",
    "",
    "Output rules:",
    "1. Return JSON only, strictly matching the provided schema.",
    "2. contractName: use the document title when available. If no clear title exists, create a concise name from contract type and counterparty.",
    "3. contractType: provide a legally and commercially useful type, such as temporary security service agreement, SaaS services agreement, NDA, equity investment agreement, data processing agreement, or similar.",
    "4. counterparty: identify the counterparty name. Leave an empty string if it cannot be determined; do not guess.",
    "5. ourRole: identify our role in the contract. If unclear, use 'to be confirmed' and add the missing fact to missingFacts.",
    "6. purpose: one sentence explaining the deal or contract purpose.",
    "7. businessBackground: write a concise Chinese paragraph suitable for direct insertion into the workbench form. Include transaction background, core obligations, negotiation focus, and missing information the legal reviewer should confirm.",
    "8. confidence: an integer-like number from 0 to 100 for extraction confidence.",
    "9. missingFacts: list facts the user should confirm before full legal review.",
    "",
    "Contract text:",
    contractText,
  ].join("\n");
}
function runCodexExec(prompt, outputFile) {
  const schemaPath = path.resolve(ROOT, "schemas", "contract-intake-response.schema.json");
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
      env: { ...process.env, NO_COLOR: "1" },
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
      resolve();
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
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(raw.slice(first, last + 1));
    throw error;
  }
}

async function main() {
  const payload = JSON.parse((await readStdin()) || "{}");
  const outputFile = path.join(os.tmpdir(), `codex-contract-intake-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
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
