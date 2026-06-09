# PORTABILITY

本项目内置了一套面向 Windows 新机器迁移的便携运行层，核心目标是：

- 自动选择可用的 AI provider
- 自动选择可写数据目录
- 自动选择可用本地端口
- 在缺少健康 provider 时仍允许 fallback 打开工作台

## 关键脚本

- `scripts/start-ai-server.js`：启动入口
- `scripts/portable-runtime.js`：运行时 profile 与端口/目录选择
- `scripts/portability-check.js`：环境检查
- `scripts/portable-smoke.js`：本地 server 便携 smoke
- `scripts/health-check.js`：读取 `runtime-config.js`，带 cookie-session 检查 `/api/health` 和 runner 状态

## 默认行为

默认数据目录：

```text
.local-workbench/
```

默认端口：

```text
8787
```

若端口被占用，会自动向上寻找可用端口。

## 运行模式

启动器会在控制台打印：

```text
[portable] profile=...
[portable] runtime_mode=...
[portable] provider=...
[portable] reason=...
[portable] url=http://127.0.0.1:8787/
```

常见模式：

- `codex-cli`
- `openai-compatible`
- `fallback`

## fallback 模式说明

在 fallback 模式下：

- 工作台仍然可以启动
- 本地归档、导出、结构浏览仍可使用
- AI 审阅应视为降级

这时需要补齐 Codex CLI 或 OpenAI-compatible provider 配置。

## 本地健康检查

```powershell
npm run health
```

它会：

1. 读取 `/js/runtime-config.js`
2. 获取本地 cookie-session
3. 调用 `/api/health`
4. 调用 `/api/legal-review/runner-status`

## 当前迁移注意事项

1. 不要再依赖 `runtime-config.js` 中的 token 提取逻辑；当前实现已切换为 cookie-session。
2. 如果工作台端口自动切换，不要手输 `8787`，要使用启动器打印出来的实际 URL。
3. 如果 provider 被判定为 `fallback`，先检查：
   - Codex CLI 是否可运行
   - `legal-work-orchestrator` skill 是否存在
   - Kimi / OpenAI-compatible 的 API key、base URL、model 是否完整

## 推荐验证命令

```powershell
npm run portability:check
```

```powershell
npm run portable:smoke
```

```powershell
npm run health
```
