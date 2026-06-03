# 运行说明

## 前置条件

- Node.js 18+
- Codex CLI 模式：需要已安装并登录 Codex，且本机有 `legal-work-orchestrator` skill。
- Kimi / Moonshot / OpenAI-compatible 模式：需要 API key；Kimi 默认使用 `https://api.moonshot.cn/v1`，可按需覆盖 base url 和 model。

## 推荐启动

默认使用统一 AI runner。未配置 API key 时走 Codex CLI；配置 Kimi/Moonshot API key 后会自动切到 OpenAI-compatible runner。

```powershell
npm install
npm run portability:check
npm run server:ai
```

然后打开 `http://127.0.0.1:8787/`。

## 接入 Kimi

最少配置：

```powershell
$env:LEGAL_AI_PROVIDER="kimi"
$env:KIMI_API_KEY="<api-key>"
npm run server:kimi
```

可选配置：

```powershell
$env:LEGAL_AI_BASE_URL="https://api.moonshot.cn/v1"
$env:LEGAL_AI_MODEL="moonshot-v1-32k"
```

如果后端不支持 `response_format`：

```powershell
$env:LEGAL_AI_RESPONSE_FORMAT="none"
```

## 其他脚本

```powershell
npm run server:codex
```

使用旧 Codex 专用 runner，仅适合已经确认 Codex CLI 环境可用的机器。

```powershell
npm run server:skill
```

使用本项目自带规则型 runner，适合调试接口形状，不代表真实 AI 审阅质量。

```powershell
npm run check
```

执行语法检查和回归 smoke。

## 常见问题

如果 Web UI 显示后端不可用：

1. 确认后端命令正在运行。
2. 打开 `http://127.0.0.1:8787/api/health`。
3. 打开 `http://127.0.0.1:8787/api/legal-review/runner-status`，确认 provider、model 和 runner 已配置。
4. 运行 `npm run portability:check`，查看缺少 Codex、skill、schema 还是 API 配置。

如果 AI 审阅失败：

1. Codex 模式下确认 Codex CLI 已登录。
2. Kimi/OpenAI-compatible 模式下确认 base url、api key、model 正确。
3. 长合同可能需要数分钟，先等待任务完成。
4. 如仍失败，运行 `npm run check` 排除本地代码问题。
