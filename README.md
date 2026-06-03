# AI 合同审阅工作台 MVP

这是一个面向 AI 创业公司法务的本地合同审阅 WebUI。当前定位不是“本地规则审阅器”，而是 AI 法律审阅 agent/skill 的可视化工作台：WebUI 负责上传、结构展示、条款定位、建议采纳、红线批注和导出；Agent A 负责实质审阅、条款切分和修改建议；Agent B 负责界面一致性、建议归属、编号和交付前校验。

后端支持两类 provider：

- Codex CLI：可使用本机 `legal-work-orchestrator` skill。
- Kimi / Moonshot / OpenAI-compatible：通过 `/v1/chat/completions` 完成同等结构化任务。

## 核心流程

1. 新建审阅：上传 `.docx` 或粘贴合同文本。
2. 信息填充：可选择本地快速填充，或使用 AI 一键信息填充。
3. 自动审阅：创建审阅或上传新版本后，自动调用 Agent A，返回条款切分和审阅建议。
4. 审阅台处理：在最相关的条款卡片和右侧建议栏中查看、采纳、调整、批注、业务确认或拒绝 AI 建议。
5. 生成拟发送版本：基于已采纳的新增、删除、修改和批注生成版本，并由 AI 做发送前复核。
6. 导出 Word 红线/批注稿：形成可发送给相对方或内部复核的交付件。

## 启动方式

```powershell
npm install
npm run server:ai
```

打开：

```text
http://127.0.0.1:8787/
```

Kimi 模式：

```powershell
$env:LEGAL_AI_PROVIDER="kimi"
$env:KIMI_API_KEY="<api-key>"
npm run server:kimi
```

### npm install 常见问题

首次安装依赖时可能遇到以下问题，请按对应方式处理：

| 问题 | 原因 | 解决方式 |
|------|------|---------|
| `better-sqlite3` 安装失败 / node-gyp 报错 | 该包包含 C++ 原生扩展，需要 Python 和 Visual Studio Build Tools 编译 | Windows 下先执行 `npm install --global windows-build-tools`（管理员 PowerShell），或安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/?q=build+tools) 并勾选"使用 C++ 的桌面开发" |
| Electron 下载极慢或超时 | Electron 预编译二进制文件托管在 GitHub，国内访问受限 | 设置镜像源：`npm config set electron_mirror https://npmmirror.com/mirrors/electron/` 后重新 `npm install` |
| 整体安装速度慢 | npm 默认 registry 在国外 | 使用国内镜像：`npm config set registry https://registry.npmmirror.com` |
| 安装后 `better-sqlite3` 运行时报错 `The specified module could not be found` | Node 版本与预编译二进制不匹配，或缺少 VC++ 运行时 | 确保 Node.js 版本为 **v18.x LTS** 或 **v20.x LTS**；如仍报错，删除 `node_modules/better-sqlite3` 后执行 `npm rebuild better-sqlite3` |
| Playwright 浏览器下载失败 | Playwright 需要下载 Chromium 浏览器，网络问题导致 | 设置环境变量后安装：`set PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright`（CMD）或 `$env:PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright"`（PowerShell），然后 `npx playwright install chromium` |

> **推荐安装顺序**（若整体 `npm install` 失败）：
> ```powershell
> npm config set registry https://registry.npmmirror.com
> npm config set electron_mirror https://npmmirror.com/mirrors/electron/
> npm install better-sqlite3
> npm install
> npx playwright install chromium
> ```

更多迁移和配置见 [RUNNING.md](./RUNNING.md) 与 [PORTABILITY.md](./PORTABILITY.md)。

## 后端接口

- `POST /api/contract-intake`：AI 读取合同并返回新建审阅表单字段。
- `POST /api/legal-review/jobs`：创建 Agent A 审阅任务。
- `GET /api/legal-review/jobs/:id`：查询审阅任务状态和结果。
- `POST /api/ai-suggestion/action`：让 AI 将“采纳/调整/拒绝”等用户动作转成可执行条款修改。
- `POST /api/visual-qa`：调用 Agent B 做 UI、结构、编号、建议归属和导出一致性校验。
- `POST /api/docx/parse`：解析 `.docx` 正文、修订和批注。

## 主要代码

- `scripts/ai-runner-lib.js`：统一 provider 选择，支持 Codex CLI 与 OpenAI-compatible API。
- `scripts/ai-skill-runner.js`：Agent A 通用 runner。
- `scripts/ai-visual-qa-runner.js`：Agent B 通用 runner。
- `server/*-adapter.js`：后端 adapter，按 provider 选择 runner。
- `js/api.js`：请求构造、结果归一化、条款匹配和状态同步。
- `js/render-review.js`：审阅台、条款卡片、结构概览和主流程卡片。
- `js/review-actions.js`：建议采纳、调整、拒绝和后端动作支持。

## 验证

```powershell
npm run check
```
