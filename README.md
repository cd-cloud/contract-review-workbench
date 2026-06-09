# AI 合同审阅工作台 MVP

本项目是一个面向法务/合同场景的本地优先合同审阅工作台：

- Agent A：负责合同理解、条款切分、风险识别与修改建议生成
- Agent B：负责审阅台结构、编号、建议归属与导出一致性检查
- 前端：负责上传、展示、采纳/调整/拒绝建议、导出与归档
- 后端：负责本地存储、任务调度、文件归档、AI runner 桥接

当前支持两类 AI provider：

- Codex CLI，本地 skill 入口为 `legal-work-orchestrator`
- OpenAI-compatible API，例如 Kimi / Moonshot

## 核心流程

1. 新建审阅：上传 `.docx` 或粘贴合同文本
2. 信息填充：本地快速填充或 AI 一键信息填充
3. 确认合同类型与法域
4. 运行 Agent A 审阅
5. 在审阅台采纳、调整、拒绝或批注建议
6. 运行 Agent B 复核结构与导出一致性
7. 导出 Word 红线/批注稿或拟发送版本

## 启动方式

安装依赖：

```powershell
npm install
```

自动选择运行配置：

```powershell
npm run server:ai
```

显式使用 Codex：

```powershell
npm run server:codex
```

显式使用 Kimi：

```powershell
$env:LEGAL_AI_PROVIDER="kimi"
$env:KIMI_API_KEY="<api-key>"
npm run server:kimi
```

启动后打开：

```text
http://127.0.0.1:8787/
```

如果 `8787` 被占用，启动器会自动选择新的本地端口，并在控制台打印实际地址。

## 运行与鉴权说明

- 本地服务默认只监听 `127.0.0.1`
- 浏览器 / Electron renderer 通过本地 cookie-session 访问 API
- Electron 主进程与后端之间仍会使用私有 token 通信
- `runtime-config.js` 不再暴露管理 token

## 主要脚本

- `npm run server:ai`：自动选择可用 AI provider
- `npm run server:codex`：显式走 Codex CLI
- `npm run server:kimi`：显式走 Kimi / OpenAI-compatible
- `npm run portability:check`：检查本机依赖和 provider 配置
- `npm run health`：读取运行时配置并检查后端健康状态
- `npm run check`：静态检查 + 轻量回归检查
- `npm test`：项目测试集
- `npm run electron:smoke`：桌面启动链路 smoke

## 后端接口

- `POST /api/contract-intake`：AI 读取合同并返回新建审阅字段
- `POST /api/legal-review/jobs`：创建 Agent A 审阅任务
- `GET /api/legal-review/jobs/:id`：查询审阅任务状态和结果
- `POST /api/ai-suggestion/action`：把用户动作转成结构化修改动作
- `POST /api/visual-qa`：运行 Agent B 复核
- `POST /api/docx/parse`：解析 `.docx` 正文、修订和批注
- `POST /api/contracts/:id/files`：归档上传文件
- `POST /api/contracts/:id/exports`：归档导出文件
- `POST /api/backup`：执行本地备份

## 存储位置

默认数据目录：

```text
%USERPROFILE%\\LegalWorkbench
```

主要内容：

- `data/workbench.sqlite`：SQLite 主数据库
- `contracts/`：合同归档、版本、导出、附件
- `backups/`：备份目录

也可以通过环境变量 `LEGAL_WORKBENCH_DATA_DIR` 指定自定义数据目录。

## 注意事项

- 未接入可用 AI provider 时，系统会退回本地 fallback；UI 应将其视为“仅供参考”
- 长合同或条款过多时，模型请求可能发生裁剪；UI 会提示“非全文分析”
- 正式对外发送前，应由人工复核 AI 结果

## 常见安装问题

| 问题 | 原因 | 解决方式 |
|---|---|---|
| `better-sqlite3` 安装失败 | 缺少原生编译环境 | 安装 Python 和 Visual Studio Build Tools，或按项目现有 Windows 指南执行 |
| Electron 下载慢 | 网络或镜像问题 | 配置 `electron_mirror` 镜像后重新安装 |
| Playwright 浏览器下载失败 | 网络问题 | 配置 `PLAYWRIGHT_DOWNLOAD_HOST` 后重新安装 |

## 验证

```powershell
npm run check
```

必要时补充：

```powershell
npm test
```
