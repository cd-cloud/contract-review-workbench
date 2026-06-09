# RUNNING

## 本地启动

安装依赖：

```powershell
npm install
```

自动选择本机可用 AI provider：

```powershell
npm run server:ai
```

常见显式模式：

```powershell
npm run server:codex
```

```powershell
$env:LEGAL_AI_PROVIDER="kimi"
$env:KIMI_API_KEY="<api-key>"
npm run server:kimi
```

启动器会打印：

- `profile`
- `runtime_mode`
- `provider`
- `reason`
- `url`

使用打印出来的 URL 打开工作台，例如：

```text
http://127.0.0.1:8787/
http://127.0.0.1:8788/
```

## 运行时鉴权

- 浏览器和 Electron renderer 使用 cookie-session 访问本地 API
- `runtime-config.js` 只暴露 `backendOrigin` 和 `authMode`
- 不再从 `runtime-config.js` 提取 API token

## 运行状态检查

检查 provider 和运行时状态：

```powershell
npm run health
```

手动查看：

```text
http://127.0.0.1:8787/api/legal-review/runner-status
```

重点字段：

- `runner.ready`
- `runner.launcherProfile`
- `runner.launcherMode`
- `runners.intake.lastRunState`
- `runners.suggestion.lastRunState`
- `runners.visualQa.lastRunState`

## 便携启动与预检

依赖预检：

```powershell
npm run portability:check
```

便携 smoke：

```powershell
npm run portable:smoke
```

## 常见问题

### 1. PowerShell 提示脚本执行受限

优先使用：

```powershell
npm.cmd run server:ai
```

### 2. 启动后是 fallback 模式

说明当前没有检测到健康的 AI provider。此时：

- 工作台仍可打开
- 本地 fallback 仍可工作
- AI 审阅质量应视为降级

需要检查：

- Codex CLI 是否可运行
- `legal-work-orchestrator` skill 是否存在
- Kimi / OpenAI-compatible 的 API key、base URL、model 是否完整

### 3. Agent A / Agent B 看起来“已配置”但调用失败

查看：

- `/api/legal-review/runner-status`
- `lastRunState`
- `lastFallbackReason`
- `lastError`

当前状态接口不只反映静态配置，也会反映最近一次真实调用结果。

### 4. 长合同分析时间较长

- Agent A 可能需要数分钟
- 条款切分和 Visual QA 可能是独立阶段
- 超长合同可能触发裁剪，UI 应提示“非全文分析”

### 5. 备份后如何理解结果

`/api/backup` 返回的是一个备份目录，而不是单一 sqlite 文件。目录中通常包含：

- `workbench.sqlite`
- `contracts/`
- `files/`
- `manifest.json`
