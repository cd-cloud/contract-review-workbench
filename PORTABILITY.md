# Portability Guide

本项目可以用两类 AI 后端运行：

- Codex CLI：适合在安装了 Codex Desktop / Codex CLI 的电脑上直接跑，并可使用本机 skills。
- Kimi / Moonshot / OpenAI-compatible API：适合接入兼容 `/v1/chat/completions` 的模型服务。

WebUI 不直接依赖某个模型。后端通过 runner 脚本把合同审阅、建议动作、新建审阅信息填充和 Visual QA 都转成统一 JSON。

## 迁移到另一台 Codex 电脑

```powershell
npm install
npm run portability:check
npm run server:ai
```

如果 Codex CLI 不在默认位置：

```powershell
$env:CODEX_CLI_COMMAND="C:\path\to\codex.exe"
npm run server:ai
```

如果 skill 不在默认位置：

```powershell
$env:LEGAL_WORK_ORCHESTRATOR_SKILL="C:\path\to\legal-work-orchestrator\SKILL.md"
npm run server:ai
```

## 接入 Kimi

最少配置：

```powershell
$env:LEGAL_AI_PROVIDER="kimi"
$env:KIMI_API_KEY="<api key>"
npm run server:kimi
```

默认 base url 为 `https://api.moonshot.cn/v1`，默认 model 为 `moonshot-v1-32k`。

自定义配置：

```powershell
$env:LEGAL_AI_BASE_URL="https://api.moonshot.cn/v1"
$env:LEGAL_AI_API_KEY="<api key>"
$env:LEGAL_AI_MODEL="<model name>"
$env:LEGAL_AI_TEMPERATURE="0.2"
npm run server:kimi
```

如果后端不支持 `response_format`：

```powershell
$env:LEGAL_AI_RESPONSE_FORMAT="none"
```

## 接入其他 OpenAI-compatible 后端

```powershell
$env:LEGAL_AI_PROVIDER="openai-compatible"
$env:LEGAL_AI_BASE_URL="<base url 或完整 /v1/chat/completions 地址>"
$env:LEGAL_AI_API_KEY="<api key>"
$env:LEGAL_AI_MODEL="<model name>"
npm run server:ai
```

`LEGAL_AI_BASE_URL` 可以是 `https://.../v1`，runner 会自动拼接 `/chat/completions`；如果传入完整 `/v1/chat/completions` 地址，也会直接使用。

## Runner 环境变量

通常不需要手动指定。provider 为 Kimi/OpenAI-compatible 时，后端会自动选择：

- `scripts/ai-skill-runner.js`
- `scripts/ai-suggestion-runner.js`
- `scripts/ai-intake-runner.js`
- `scripts/ai-visual-qa-runner.js`

需要覆盖时可设置：

```powershell
$env:LEGAL_SKILL_RUNNER_SCRIPT="scripts/ai-skill-runner.js"
$env:SUGGESTION_ACTION_RUNNER_SCRIPT="scripts/ai-suggestion-runner.js"
$env:CONTRACT_INTAKE_RUNNER_SCRIPT="scripts/ai-intake-runner.js"
$env:VISUAL_QA_RUNNER_SCRIPT="scripts/ai-visual-qa-runner.js"
```

## 自检

```powershell
npm run portability:check
```

它会检查 runner、schema、skill、Codex CLI 以及 OpenAI-compatible API 配置是否可用。
# Portable runtime layer

The repository includes a project-owned portable startup layer for new machines:

- `scripts/start-ai-server.js`: cross-platform server launcher. It sets runner scripts, defaults data to `.local-workbench/`, selects a free port starting from `8787`, then starts the backend.
- `scripts/preflight.js`: checks Node, npm, required dependencies, writable data directory, available port, Codex CLI, and `legal-work-orchestrator`.
- `scripts/health-check.js`: reads `/js/runtime-config.js`, extracts the runtime API token, and checks `/api/health` plus runner status.
- `start-portable.bat`: Windows double-click entry point for portable local testing.

Recommended Windows flow:

```powershell
npm.cmd install
npm.cmd run preflight
npm.cmd run server:ai
```

If PowerShell blocks `npm.ps1`, use `npm.cmd`. If the server chooses a fallback port because `8787` is occupied, use the URL printed by the launcher.
