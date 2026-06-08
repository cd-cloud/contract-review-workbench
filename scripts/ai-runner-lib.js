const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");

function readStdinJson() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(input.trim() ? JSON.parse(input) : {});
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.on("error", reject);
  });
}

function getProvider() {
  const configured = process.env.LEGAL_AI_PROVIDER || process.env.AI_PROVIDER;
  if (configured) return configured.toLowerCase();
  if (process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY) return "kimi";
  if (process.env.LEGAL_AI_API_KEY || process.env.OPENAI_COMPATIBLE_API_KEY) return "openai-compatible";
  return "codex-cli";
}

function getPreferredCodexCommand() {
  const configured = process.env.CODEX_CLI_COMMAND || process.env.CODEX_COMMAND;
  if (configured) return configured;
  const localAppData = process.env.LOCALAPPDATA || "";
  const desktopCodex = localAppData ? path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe") : "";
  if (desktopCodex && fs.existsSync(desktopCodex)) return desktopCodex;
  return "codex";
}

function lookupCodexCandidates() {
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const args = process.platform === "win32" ? ["codex"] : ["-a", "codex"];
  const result = spawnSync(lookupCommand, args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return [];
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function inspectCodexCommand(command) {
  if (!command) return { command: "codex", exists: false, runnable: false, detail: "Codex CLI not configured." };
  if (path.isAbsolute(command) && !fs.existsSync(command)) {
    return { command, exists: false, runnable: false, detail: "Configured Codex CLI path does not exist." };
  }
  const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 8000, windowsHide: true });
  if (result.error) {
    const code = String(result.error.code || "");
    return {
      command,
      exists: code !== "ENOENT",
      runnable: false,
      detail: result.error.message || String(result.error),
    };
  }
  if (result.status === 0) {
    const detail = String(result.stdout || result.stderr || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || "codex --version succeeded";
    return { command, exists: true, runnable: true, detail };
  }
  const detail = String(result.stderr || result.stdout || "").trim() || `codex --version exited with code ${result.status}`;
  return { command, exists: true, runnable: false, detail };
}

function resolveCodexCommandStatus() {
  const preferred = getPreferredCodexCommand();
  const localAppData = process.env.LOCALAPPDATA || "";
  const desktopCodex = localAppData ? path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe") : "";
  const candidates = [...new Set([preferred, desktopCodex, ...lookupCodexCandidates()].filter(Boolean))];
  const fallbackCommand = preferred || desktopCodex || "codex";
  let firstExisting = null;
  for (const candidate of candidates.length ? candidates : [fallbackCommand]) {
    const status = inspectCodexCommand(candidate);
    if (status.runnable) return status;
    if (!firstExisting && status.exists) firstExisting = status;
  }
  return firstExisting || { command: fallbackCommand, exists: false, runnable: false, detail: "Codex CLI not found in PATH or configured location." };
}

function getCodexCommand() {
  return resolveCodexCommandStatus().command;
}

function resolveChatCompletionsUrl() {
  const provider = getProvider();
  const raw =
    process.env.LEGAL_AI_BASE_URL ||
    process.env.OPENAI_COMPATIBLE_BASE_URL ||
    process.env.KIMI_BASE_URL ||
    process.env.MOONSHOT_BASE_URL ||
    (provider === "kimi" || provider === "moonshot" ? "https://api.moonshot.cn/v1" : "");
  if (!raw) throw new Error("LEGAL_AI_BASE_URL is required for openai-compatible provider.");
  const base = raw.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function getApiKey() {
  return process.env.LEGAL_AI_API_KEY || process.env.OPENAI_COMPATIBLE_API_KEY || process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || "";
}

function getModelName() {
  return process.env.LEGAL_AI_MODEL || process.env.KIMI_MODEL || process.env.MOONSHOT_MODEL || "moonshot-v1-32k";
}

function getProviderStatus() {
  const provider = getProvider();
  const apiKey = getApiKey();
  const codex = resolveCodexCommandStatus();
  let baseUrl = "";
  try {
    baseUrl = provider === "codex" || provider === "codex-cli" ? "" : resolveChatCompletionsUrl();
  } catch (error) {
    baseUrl = "";
  }
  return {
    provider,
    mode: provider === "codex" || provider === "codex-cli" ? "codex-cli" : "openai-compatible",
    model: provider === "codex" || provider === "codex-cli" ? "" : getModelName(),
    baseUrlConfigured: Boolean(baseUrl),
    apiKeyConfigured: Boolean(apiKey),
    codexCommand: codex.command,
    codexExists: codex.exists,
    codexRunnable: Boolean(codex.runnable),
    codexDetail: codex.detail || "",
  };
}

function compact(value, maxLength = 120000) {
  let text;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch (error) {
    const safe = new WeakSet();
    text = JSON.stringify(value, (k, v) => {
      if (typeof v === "object" && v !== null) {
        if (safe.has(v)) return "[Circular]";
        safe.add(v);
      }
      return v;
    });
  }
  if (text.length <= maxLength) return text;
  const start = 1;
  const end = maxLength;
  return `${text.slice(0, maxLength)}\n\n[TRUNCATED_FOR_AI_RUNNER: 已处理第 ${start}–${end} 字符，共 ${text.length} 字符]`;
}

async function runJsonTask({ prompt, schemaPath, outputPrefix = "legal-ai", systemPrompt = "" }) {
  const provider = getProvider();
  if (provider === "codex" || provider === "codex-cli") {
    return runCodexJsonTask({ prompt, schemaPath, outputPrefix });
  }
  if (["openai", "openai-compatible", "kimi", "moonshot"].includes(provider)) {
    return runOpenAiCompatibleJsonTask({ prompt, schemaPath, systemPrompt });
  }
  throw new Error(`Unsupported LEGAL_AI_PROVIDER: ${provider}`);
}

function runCodexJsonTask({ prompt, schemaPath, outputPrefix, signal }) {
  const outputFile = path.join(os.tmpdir(), `${outputPrefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    process.env.CODEX_RUNNER_SANDBOX || "read-only",
    "--cd",
    appRoot,
    "--output-schema",
    path.resolve(appRoot, schemaPath),
    "--output-last-message",
    outputFile,
    "-",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(getCodexCommand(), args, {
      cwd: appRoot,
      shell: false,
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    let aborted = false;

    function onAbort() {
      aborted = true;
      try { child.kill("SIGTERM"); } catch (e) {}
      setTimeout(() => {
        try { if (!child.killed) child.kill("SIGKILL"); } catch (e) {}
      }, 3000);
      reject(new Error("AI analysis was cancelled"));
    }

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (aborted) return;
      if (code !== 0) {
        reject(new Error(`codex exec failed with code ${code}\n${stderr || stdout}`.trim()));
        return;
      }
      const finalText = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : stdout;
      try {
        resolve(parseJsonOutput(finalText));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function runOpenAiCompatibleJsonTask({ prompt, schemaPath, systemPrompt, signal }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("LEGAL_AI_API_KEY is required for openai-compatible provider.");
  const schema = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, "utf8") : "";
  const body = {
    model: getModelName(),
    temperature: Number(process.env.LEGAL_AI_TEMPERATURE || 0.2),
    messages: [
      {
        role: "system",
        content:
          systemPrompt ||
          "You are a legal contract review backend. Return valid JSON only. Do not include Markdown or code fences.",
      },
      {
        role: "user",
        content: `${prompt}\n\nOutput JSON schema:\n${compact(schema, 60000)}`,
      },
    ],
  };
  if (process.env.LEGAL_AI_RESPONSE_FORMAT !== "none") {
    body.response_format = { type: "json_object" };
  }
  const response = await fetch(resolveChatCompletionsUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: signal || undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AI provider returned ${response.status}: ${text.slice(0, 1000)}`);
  }
  const payload = parseJsonOutput(text);
  const content = payload.choices?.[0]?.message?.content || payload.output_text || payload.content || text;
  return parseJsonOutput(content);
}

function parseJsonOutput(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("AI runner returned empty output");
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

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2));
}

module.exports = {
  compact,
  getProvider,
  getCodexCommand,
  getProviderStatus,
  resolveCodexCommandStatus,
  readStdinJson,
  runJsonTask,
  printJson,
};
