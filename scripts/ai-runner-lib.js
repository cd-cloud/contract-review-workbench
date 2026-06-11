const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Ajv = require("ajv");
const ajv = new Ajv({ strict: false, allErrors: true });

const appRoot = path.resolve(__dirname, "..");
const CODEX_HOME = process.env.CODEX_HOME || path.join(process.env.USERPROFILE || process.env.HOME || "", ".codex");
const KIMI_CODE_HOME = process.env.KIMI_CODE_HOME || path.join(process.env.USERPROFILE || process.env.HOME || "", ".kimi-code");

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

function getConfiguredProvider() {
  return String(process.env.LEGAL_AI_PROVIDER || process.env.AI_PROVIDER || "").trim().toLowerCase();
}

function getExecutionContext() {
  const isCodexShell = process.env.CODEX_SHELL === "1";
  const sandboxNetworkDisabled = process.env.CODEX_SANDBOX_NETWORK_DISABLED === "1";
  const internalOriginator = process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || "";
  return {
    isCodexShell,
    sandboxNetworkDisabled,
    internalOriginator,
    sandboxLikely: isCodexShell || sandboxNetworkDisabled,
  };
}

function readCodexConfig() {
  try {
    const configPath = path.join(CODEX_HOME, "config.toml");
    if (!fs.existsSync(configPath)) return { configPath, provider: "", baseUrl: "", wireApi: "" };
    const source = fs.readFileSync(configPath, "utf8");
    const provider = source.match(/^\s*model_provider\s*=\s*"([^"]+)"/m)?.[1] || "";
    const providerSection = provider ? source.match(new RegExp(`\\[model_providers\\.${provider.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\]([\\s\\S]*?)(?:\\n\\[|$)`))?.[1] || "" : "";
    const baseUrl = providerSection.match(/^\s*base_url\s*=\s*"([^"]+)"/m)?.[1] || "";
    const wireApi = providerSection.match(/^\s*wire_api\s*=\s*"([^"]+)"/m)?.[1] || "";
    return { configPath, provider, baseUrl, wireApi };
  } catch (error) {
    return { configPath: path.join(CODEX_HOME, "config.toml"), provider: "", baseUrl: "", wireApi: "", error: error.message || String(error) };
  }
}

function getPreferredCodexCommand() {
  const configured = process.env.CODEX_CLI_COMMAND || process.env.CODEX_COMMAND;
  if (configured) return configured;
  const localAppData = process.env.LOCALAPPDATA || "";
  const desktopCodex = localAppData ? path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe") : "";
  if (desktopCodex && fs.existsSync(desktopCodex)) return desktopCodex;
  return "codex";
}

function getPreferredKimiCommand() {
  const configured = process.env.KIMI_CLI_COMMAND || process.env.KIMI_CODE_COMMAND;
  if (configured) return configured;
  const appData = process.env.APPDATA || process.env.USERPROFILE || "";
  const vsCodeKimi = appData
    ? path.join(appData, "Code", "User", "globalStorage", "moonshot-ai.kimi-code", "bin", "kimi", "kimi.exe")
    : "";
  if (vsCodeKimi && fs.existsSync(vsCodeKimi)) return vsCodeKimi;
  return "kimi";
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

function lookupKimiCandidates() {
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const args = process.platform === "win32" ? ["kimi"] : ["-a", "kimi"];
  const result = spawnSync(lookupCommand, args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return [];
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function rankCodexCandidate(command) {
  const normalized = String(command || "").toLowerCase().replace(/\\/g, "/");
  let score = 0;
  if (/\/openai\/codex\/bin\/codex\.exe$/.test(normalized)) score += 50;
  if (/\.cmd$/.test(normalized)) score += 35;
  if (/\.bat$/.test(normalized)) score += 30;
  if (/\.exe$/.test(normalized)) score += 20;
  if (/windowsapps/.test(normalized)) score -= 20;
  if (/\/codex$/.test(normalized) && !/\.(cmd|bat|exe)$/.test(normalized)) score -= 10;
  return score;
}

function rankKimiCandidate(command) {
  const normalized = String(command || "").toLowerCase().replace(/\\/g, "/");
  let score = 0;
  if (/\/moonshot-ai\.kimi-code\/bin\/kimi\/kimi$/.test(normalized)) score += 50;
  if (/\.cmd$/.test(normalized)) score += 35;
  if (/\.bat$/.test(normalized)) score += 30;
  if (/\.exe$/.test(normalized)) score += 20;
  if (/windowsapps/.test(normalized)) score -= 20;
  if (/\/kimi$/.test(normalized) && !/\.(cmd|bat|exe)$/.test(normalized)) score -= 10;
  return score;
}

function quoteForCmd(value) {
  const text = String(value || "");
  if (!text) return '""';
  if (!/[\s"&()^%!]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCodexLaunch(command, args = []) {
  const normalized = String(command || "");
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(normalized)) {
    const comspec = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
    const commandLine = [quoteForCmd(normalized), ...args.map(quoteForCmd)].join(" ");
    return {
      command: comspec,
      args: ["/d", "/s", "/c", commandLine],
    };
  }
  return { command: normalized, args };
}

function inspectCodexCommand(command) {
  if (!command) return { command: "codex", exists: false, runnable: false, detail: "Codex CLI not configured." };
  if (path.isAbsolute(command) && !fs.existsSync(command)) {
    return { command, exists: false, runnable: false, detail: "Configured Codex CLI path does not exist.", diagnosis: "machine" };
  }
  const execution = getExecutionContext();
  const launch = buildCodexLaunch(command, ["--version"]);
  const result = spawnSync(launch.command, launch.args, { encoding: "utf8", timeout: 8000, windowsHide: true });
  if (result.error) {
    const code = String(result.error.code || "");
    const sandboxLimited = execution.sandboxLikely && ["EPERM", "EACCES"].includes(code);
    return {
      command,
      exists: code !== "ENOENT",
      runnable: false,
      detail: result.error.message || String(result.error),
      diagnosis: sandboxLimited ? "sandbox-limited" : "machine",
      confidence: sandboxLimited ? "low" : "high",
    };
  }
  if (result.status === 0) {
    const detail = String(result.stdout || result.stderr || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || "codex --version succeeded";
    return { command, exists: true, runnable: true, detail, diagnosis: "ok", confidence: "high" };
  }
  const detail = String(result.stderr || result.stdout || "").trim() || `codex --version exited with code ${result.status}`;
  return { command, exists: true, runnable: false, detail, diagnosis: "machine", confidence: "high" };
}

function inspectKimiCommand(command) {
  if (!command) return { command: "kimi", exists: false, runnable: false, detail: "Kimi Code CLI not configured." };
  if (path.isAbsolute(command) && !fs.existsSync(command)) {
    return { command, exists: false, runnable: false, detail: "Configured Kimi Code CLI path does not exist.", diagnosis: "machine" };
  }
  const execution = getExecutionContext();
  const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 8000, windowsHide: true });
  if (result.error) {
    const code = String(result.error.code || "");
    const sandboxLimited = execution.sandboxLikely && ["EPERM", "EACCES"].includes(code);
    return {
      command,
      exists: code !== "ENOENT",
      runnable: false,
      detail: result.error.message || String(result.error),
      diagnosis: sandboxLimited ? "sandbox-limited" : "machine",
      confidence: sandboxLimited ? "low" : "high",
    };
  }
  if (result.status === 0) {
    const detail = String(result.stdout || result.stderr || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || "kimi --version succeeded";
    return { command, exists: true, runnable: true, detail, diagnosis: "ok", confidence: "high" };
  }
  const detail = String(result.stderr || result.stdout || "").trim() || `kimi --version exited with code ${result.status}`;
  return { command, exists: true, runnable: false, detail, diagnosis: "machine", confidence: "high" };
}

let _codexCommandStatusCache = null;
let _codexCommandStatusCacheAt = 0;

function resolveCodexCommandStatus() {
  if (process.env.LEGAL_WORKBENCH_DISABLE_CODEX_CLI === "1") {
    return { command: "codex", exists: false, runnable: false, detail: "Disabled by LEGAL_WORKBENCH_DISABLE_CODEX_CLI." };
  }
  if (_codexCommandStatusCache && Date.now() - _codexCommandStatusCacheAt < 30000) {
    return _codexCommandStatusCache;
  }
  const preferred = getPreferredCodexCommand();
  const localAppData = process.env.LOCALAPPDATA || "";
  const desktopCodex = localAppData ? path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe") : "";
  const candidates = [...new Set([preferred, desktopCodex, ...lookupCodexCandidates()].filter(Boolean))]
    .sort((a, b) => rankCodexCandidate(b) - rankCodexCandidate(a));
  const fallbackCommand = preferred || desktopCodex || "codex";
  let firstExisting = null;
  for (const candidate of candidates.length ? candidates : [fallbackCommand]) {
    const status = inspectCodexCommand(candidate);
    if (status.runnable) return status;
    if (!firstExisting && status.exists) firstExisting = status;
  }
  const result = firstExisting || { command: fallbackCommand, exists: false, runnable: false, detail: "Codex CLI not found in PATH or configured location.", diagnosis: "machine", confidence: "high" };
  _codexCommandStatusCache = result;
  _codexCommandStatusCacheAt = Date.now();
  return result;
}

let _kimiCommandStatusCache = null;
let _kimiCommandStatusCacheAt = 0;

function resolveKimiCommandStatus() {
  if (process.env.LEGAL_WORKBENCH_DISABLE_KIMI_CLI === "1") {
    return { command: "kimi", exists: false, runnable: false, detail: "Disabled by LEGAL_WORKBENCH_DISABLE_KIMI_CLI." };
  }
  if (_kimiCommandStatusCache && Date.now() - _kimiCommandStatusCacheAt < 30000) {
    return _kimiCommandStatusCache;
  }
  const preferred = getPreferredKimiCommand();
  const appData = process.env.APPDATA || process.env.USERPROFILE || "";
  const vsCodeKimi = appData
    ? path.join(appData, "Code", "User", "globalStorage", "moonshot-ai.kimi-code", "bin", "kimi", "kimi")
    : "";
  const candidates = [...new Set([preferred, vsCodeKimi, ...lookupKimiCandidates()].filter(Boolean))]
    .sort((a, b) => rankKimiCandidate(b) - rankKimiCandidate(a));
  const fallbackCommand = preferred || vsCodeKimi || "kimi";
  let firstExisting = null;
  for (const candidate of candidates.length ? candidates : [fallbackCommand]) {
    const status = inspectKimiCommand(candidate);
    if (status.runnable) return status;
    if (!firstExisting && status.exists) firstExisting = status;
  }
  const result = firstExisting || { command: fallbackCommand, exists: false, runnable: false, detail: "Kimi Code CLI not found in PATH or configured location.", diagnosis: "machine", confidence: "high" };
  _kimiCommandStatusCache = result;
  _kimiCommandStatusCacheAt = Date.now();
  return result;
}

function getCodexCommand() {
  return resolveCodexCommandStatus().command;
}

function getKimiCommand() {
  return resolveKimiCommandStatus().command;
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

function getApiProviderStatus() {
  const configuredProvider = getConfiguredProvider();
  const implicitProvider = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY ? "kimi" : "openai-compatible";
  const provider =
    ["openai", "openai-compatible", "kimi", "moonshot"].includes(configuredProvider)
      ? configuredProvider
      : implicitProvider;
  const baseUrlConfigured = Boolean(
    process.env.LEGAL_AI_BASE_URL ||
    process.env.OPENAI_COMPATIBLE_BASE_URL ||
    process.env.KIMI_BASE_URL ||
    process.env.MOONSHOT_BASE_URL ||
    provider === "kimi" ||
    provider === "moonshot"
  );
  const apiKeyConfigured = Boolean(getApiKey());
  const modelConfigured = Boolean(
    process.env.LEGAL_AI_MODEL ||
    process.env.KIMI_MODEL ||
    process.env.MOONSHOT_MODEL ||
    provider === "kimi" ||
    provider === "moonshot"
  );
  const ready =
    provider === "kimi" || provider === "moonshot"
      ? apiKeyConfigured
      : baseUrlConfigured && apiKeyConfigured && modelConfigured;
  let baseUrl = "";
  try {
    if (ready || baseUrlConfigured) baseUrl = resolveChatCompletionsUrl();
  } catch (error) {
    baseUrl = "";
  }
  return {
    provider,
    mode: "openai-compatible",
    baseUrlConfigured,
    apiKeyConfigured,
    modelConfigured,
    ready,
    baseUrl,
    model: modelConfigured ? getModelName() : "",
  };
}

function getProviderStatus() {
  const provider = getProvider();
  const apiKey = getApiKey();
  const codex = resolveCodexCommandStatus();
  const kimi = resolveKimiCommandStatus();
  const codexConfig = readCodexConfig();
  const codexConfiguredProvider = String(process.env.CODEX_CONFIG_MODEL_PROVIDER || process.env.CODEX_MODEL_PROVIDER || "").trim();
  const effectiveCodexProvider = codexConfiguredProvider || codexConfig.provider || "";
  let baseUrl = "";
  try {
    baseUrl = provider === "codex" || provider === "codex-cli" || provider === "kimi-cli" ? "" : resolveChatCompletionsUrl();
  } catch (error) {
    baseUrl = "";
  }
  return {
    provider,
    mode: provider === "codex" || provider === "codex-cli" ? "codex-cli" : provider === "kimi-cli" ? "kimi-cli" : "openai-compatible",
    model: provider === "codex" || provider === "codex-cli" || provider === "kimi-cli" ? "" : getModelName(),
    baseUrlConfigured: Boolean(baseUrl),
    apiKeyConfigured: Boolean(apiKey),
    codexCommand: codex.command,
    codexExists: codex.exists,
    codexRunnable: Boolean(codex.runnable),
    codexDetail: codex.detail || "",
    codexDiagnosis: codex.diagnosis || "",
    codexConfidence: codex.confidence || "high",
    codexConfiguredProvider: effectiveCodexProvider,
    codexUsesCustomProvider: /^custom$/i.test(effectiveCodexProvider),
    codexProviderBaseUrl: codexConfig.baseUrl || "",
    codexProviderWireApi: codexConfig.wireApi || "",
    codexConfigPath: codexConfig.configPath || "",
    kimiCommand: kimi.command,
    kimiExists: kimi.exists,
    kimiRunnable: Boolean(kimi.runnable),
    kimiDetail: kimi.detail || "",
    kimiDiagnosis: kimi.diagnosis || "",
    kimiConfidence: kimi.confidence || "high",
    executionContext: getExecutionContext(),
  };
}

function resolveAutomaticProviderSelection() {
  const current = getProviderStatus();
  const api = getApiProviderStatus();

  // Priority 1: Kimi Code CLI (true skill execution for Kimi users)
  if (current.kimiRunnable) {
    return {
      profile: "kimi",
      provider: "kimi-cli",
      mode: "kimi-cli",
      reason: "Kimi Code CLI is runnable.",
      providerStatus: current,
      apiStatus: api,
    };
  }

  // Priority 2: Codex CLI
  if (current.codexRunnable) {
    return {
      profile: "codex",
      provider: "codex-cli",
      mode: "codex-cli",
      reason: "Codex CLI is runnable.",
      providerStatus: current,
      apiStatus: api,
    };
  }

  // Priority 3: Configured API provider
  if (api.ready) {
    return {
      profile: api.provider === "kimi" || api.provider === "moonshot" ? "kimi" : "ai",
      provider: api.provider,
      mode: "openai-compatible",
      reason: "Using configured API provider because no local CLI is available.",
      providerStatus: current,
      apiStatus: api,
    };
  }

  // Fallback
  return {
    profile: "fallback",
    provider: current.provider,
    mode: "fallback",
    reason: current.kimiExists
      ? `Kimi Code CLI exists but is not runnable: ${current.kimiDetail || "unknown error"}.`
      : current.codexExists
        ? `Codex CLI exists but is not runnable: ${current.codexDetail || "unknown error"}.`
        : "No healthy AI provider detected. Configure Kimi Code CLI, Codex CLI, or an OpenAI-compatible API provider.",
    providerStatus: current,
    apiStatus: api,
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
  const headLen = Math.floor(maxLength * 0.6);
  const tailLen = maxLength - headLen;
  let safeSlice = text.slice(0, headLen) + text.slice(-tailLen);
  // Avoid cutting in the middle of a Unicode escape sequence
  safeSlice = safeSlice.replace(/\\u[0-9a-fA-F]{0,3}$/, "");
  if (safeSlice.endsWith("\\")) safeSlice = safeSlice.slice(0, -1);
  // Try to close any open string
  let quoteParity = 0;
  for (let i = 0; i < safeSlice.length; i++) {
    if (safeSlice[i] === '"' && (i === 0 || safeSlice[i - 1] !== "\\")) quoteParity ^= 1;
  }
  if (quoteParity) safeSlice += '"';
  // Balance braces/brackets to produce valid-ish JSON
  const openBraces = (safeSlice.match(/{/g) || []).length - (safeSlice.match(/}/g) || []).length;
  const openBrackets = (safeSlice.match(/\[/g) || []).length - (safeSlice.match(/\]/g) || []).length;
  for (let i = 0; i < openBraces; i++) safeSlice += "}";
  for (let i = 0; i < openBrackets; i++) safeSlice += "]";
  safeSlice = safeSlice.replace(/,\s*([\}\]])/g, "$1");
  return `${safeSlice}

[TRUNCATED_FOR_AI_RUNNER: 已处理第 1–${end} 字符，共 ${text.length} 字符]`;
}

async function runJsonTask({ prompt, schemaPath, outputPrefix = "legal-ai", systemPrompt = "" }) {
  const provider = getProvider();
  let result;
  if (provider === "codex" || provider === "codex-cli") {
    result = await runCodexJsonTask({ prompt, schemaPath, outputPrefix });
  } else if (provider === "kimi-cli") {
    result = await runKimiCliJsonTask({ prompt, schemaPath, outputPrefix });
  } else if (["openai", "openai-compatible", "kimi", "moonshot"].includes(provider)) {
    result = await runOpenAiCompatibleJsonTask({ prompt, schemaPath, systemPrompt });
  } else {
    throw new Error(`Unsupported LEGAL_AI_PROVIDER: ${provider}`);
  }
  validateAgainstSchema(result, schemaPath);
  return result;
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
  const launch = buildCodexLaunch(getCodexCommand(), args);
  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd: appRoot,
      shell: false,
      env: { ...process.env, NO_COLOR: "1" },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let aborted = false;
    let settled = false;

    function cleanupOutputFile() {
      try {
        if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
      } catch (error) {}
    }

    function settleReject(error) {
      if (settled) return;
      settled = true;
      cleanupOutputFile();
      reject(error);
    }

    function settleResolve(value) {
      if (settled) return;
      settled = true;
      cleanupOutputFile();
      resolve(value);
    }

    function onAbort() {
      aborted = true;
      try { child.kill("SIGTERM"); } catch (e) {}
      setTimeout(() => {
        try { if (!child.killed) child.kill("SIGKILL"); } catch (e) {}
      }, 3000);
      settleReject(new Error("AI analysis was cancelled"));
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
      settleReject(err);
    });
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (aborted) {
        cleanupOutputFile();
        return;
      }
      if (code !== 0) {
        settleReject(new Error(`codex exec failed with code ${code}\n${stderr || stdout}`.trim()));
        return;
      }
      const finalText = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : stdout;
      try {
        settleResolve(parseJsonOutput(finalText));
      } catch (error) {
        settleReject(error);
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function runKimiCliJsonTask({ prompt, schemaPath, outputPrefix, signal }) {
  const kimiCommand = getKimiCommand();
  const args = [
    "--print",
    "-p", prompt,
    "--yolo",
    "--output-format", "stream-json",
    "--final-message-only",
    "--work-dir", appRoot,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(kimiCommand, args, {
      cwd: appRoot,
      shell: false,
      env: { ...process.env, NO_COLOR: "1" },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let aborted = false;
    let settled = false;

    function settleReject(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    function settleResolve(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    }

    function onAbort() {
      aborted = true;
      try { child.kill("SIGTERM"); } catch (e) {}
      setTimeout(() => {
        try { if (!child.killed) child.kill("SIGKILL"); } catch (e) {}
      }, 3000);
      settleReject(new Error("AI analysis was cancelled"));
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
      settleReject(err);
    });
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (aborted) return;
      if (code !== 0) {
        settleReject(new Error(`kimi exec failed with code ${code}\n${stderr || stdout}`.trim()));
        return;
      }
      // Parse Kimi Code CLI stream-json output: {"role":"assistant","content":"..."}
      const lines = stdout.split(/\r?\n/).filter(Boolean);
      let finalText = "";
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith("{")) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.role === "assistant" && typeof parsed.content === "string") {
              finalText = parsed.content;
              break;
            }
          } catch (e) {
            // not valid JSON, continue
          }
        }
      }
      if (!finalText) finalText = stdout;
      try {
        settleResolve(parseJsonOutput(finalText));
      } catch (error) {
        settleReject(error);
      }
    });
  });
}

async function runOpenAiCompatibleJsonTask({ prompt, schemaPath, systemPrompt, signal }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("LEGAL_AI_API_KEY is required for openai-compatible provider.");
  const schema = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, "utf8") : "";
  const provider = getProvider();
  const isKimi = provider === "kimi" || provider === "moonshot";

  // Kimi/Moonshot benefit from stronger JSON guardrails in the system prompt
  // because some OpenAI-compatible providers do not fully support response_format.
  const effectiveSystemPrompt = isKimi
    ? `${systemPrompt || "You are a legal contract review backend."}\n\nCRITICAL: Return ONLY a single valid JSON object. Do not wrap it in Markdown code fences (\\x60\\x60\\x60), do not add explanations, and do not output any text outside the JSON.`
    : (systemPrompt || "You are a legal contract review backend. Return valid JSON only. Do not include Markdown or code fences.");

  const body = {
    model: getModelName(),
    temperature: Number(process.env.LEGAL_AI_TEMPERATURE || 0.2),
    messages: [
      {
        role: "system",
        content: effectiveSystemPrompt,
      },
      {
        role: "user",
        content: `${prompt}\n\nOutput JSON schema:\n${compact(schema, 60000)}`,
      },
    ],
  };

  // Kimi/Moonshot may not support response_format or may ignore it.
  // Rely on the explicit system-prompt guardrails instead.
  if (!isKimi && process.env.LEGAL_AI_RESPONSE_FORMAT !== "none") {
    body.response_format = { type: "json_object" };
  }

  // Use a longer timeout for Kimi because TTFT can be high on large legal prompts.
  const controller = new AbortController();
  const timeoutMs = isKimi ? 300000 : 180000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(resolveChatCompletionsUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`AI provider returned ${response.status}: ${text.slice(0, 1000)}`);
    }
    const payload = parseJsonOutput(text);
    const content = payload.choices?.[0]?.message?.content || payload.output_text || payload.content || text;
    return parseJsonOutput(content);
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseJsonOutput(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("AI runner returned empty output");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch (inner) {
        throw new Error(`AI runner returned fenced block that is not valid JSON: ${inner.message}`);
      }
    }
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(raw.slice(first, last + 1));
      } catch (inner) {
        throw new Error(`AI runner returned output with braces that is not valid JSON: ${inner.message}`);
      }
    }
    throw error;
  }
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2));
}

function validateAgainstSchema(value, schemaPath) {
  if (!schemaPath || !fs.existsSync(schemaPath)) return;
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  } catch (error) {
    console.error(`[ai-runner-lib] Failed to load schema ${schemaPath}:`, error.message);
    return;
  }
  const validate = ajv.compile(schema);
  const valid = validate(value);
  if (!valid) {
    const errors = validate.errors || [];
    const summary = errors.slice(0, 5).map((e) => `${e.instancePath || "root"}: ${e.message}`).join("; ");
    throw new Error(`AI output schema validation failed: ${summary}`);
  }
}

module.exports = {
  appRoot,
  buildCodexLaunch,
  compact,
  getExecutionContext,
  getApiProviderStatus,
  getProvider,
  getCodexCommand,
  getKimiCommand,
  getProviderStatus,
  getConfiguredProvider,
  resolveAutomaticProviderSelection,
  resolveCodexCommandStatus,
  resolveKimiCommandStatus,
  readStdinJson,
  runJsonTask,
  printJson,
  validateAgainstSchema,
};
