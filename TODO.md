# TODO

本清单按当前项目定位维护：本项目是面向法务/合同场景的本地优先 AI 合同审阅工作台。产品层继续复用 `legal-work-orchestrator -> legal-contract-orchestrator` 的法律工作规则；整改重点放在运行稳定性、输出可信度、安全边界、缓存隔离、状态治理和测试闭环。

说明：

- 本轮暂不处理 macOS 兼容性。
- Prompt 管理和合同审阅准确性不按“重写全部 prompt”推进，而是优先补产品层约束、版本追踪、用户确认和风险提示。
- 所有任务默认按本文件的阶段和顺序执行；除非出现阻塞，不跳阶段、不并行大改。

## 当前执行顺序

1. 阶段 1：可信输出优先
2. 阶段 2：稳定性安全加固
3. 阶段 3：结构治理
4. 阶段 4：数据层与闭环测试

## 阶段 1：可信输出优先

目标：先修“会误导用户”的问题，不做大重构。

状态：`进行中`

- [~] 1.1 全仓中文编码治理，优先修用户可见文案、seed 文本、提示文案、导出文本。
  - 涉及：`index.html`、`js/state.js`、`js/api.js`、`js/review-risk.js`、`README.md`、`RUNNING.md`、`PORTABILITY.md`
  - 进展：首页/新建审阅文案、示例合同、关键运行提示、README/RUNNING/PORTABILITY 已清理；fallback 提示、docx 文本归一化规则和若干脏编码标点已继续收口，剩余零散文案继续滚动清理。
  - 验收：主界面、审阅台、导出相关文案无乱码；关键测试不再依赖 mojibake 文本。
- [x] 1.2 去掉 `buildLegalSkillRequest()` 中的 `jurisdiction: "中国大陆"` 硬编码，改为从合同字段读取。
  - 涉及：`js/api.js`、`js/state.js`
  - 验收：审阅请求中不再写死法域；示例合同显式带法域字段。
- [x] 1.3 新建审阅流程增加“合同类型 + 法域确认”的最小用户确认步骤。
  - 涉及：`index.html`、`js/app-events.js`、`js/api.js`、`js/state.js`
  - 验收：新建审阅后，用户可确认或修改合同类型与法域；确认结果进入 state 和 AI request。
- [x] 1.4 Fallback 结果强提示，不允许与真实 AI 结果混淆。
  - 涉及：`js/render-review.js`、`js/api.js`、`server/legal-skill-adapter.js`
  - 验收：fallback 结果顶部有明确提示；来源字段稳定显示 `fallback`。
- [x] 1.5 长文本/条款裁剪提示。
  - 涉及：`js/api.js`、`js/render-review.js`、`scripts/ai-skill-runner.js`
  - 验收：合同或条款被裁剪时，UI 明确提示“非全文分析/截断分析”。
- [x] 1.6 清理已确认的低风险代码问题。
  - 涉及：`js/review-risk.js`
  - 验收：不可达代码移除；相关纯测试保持通过。

## 阶段 2：稳定性安全加固

目标：让系统“出错也可控”，降低真实事故概率。

状态：`进行中`

- [x] 2.1 后端错误脱敏，生产环境不直接透传原始 `error.message`。
  - 涉及：`server/routes/api.js`、`server/server.js`
  - 验收：前端不再直接看到 provider 原始报错、路径或敏感响应体。
- [x] 2.2 前端错误提示分级。
  - 涉及：`js/api.js`、`js/render-review.js`
  - 验收：401/429/500/fallback 场景有不同用户提示。
- [x] 2.3 `analysis-cache` key 增加上下文维度。
  - 涉及：`server/analysis-cache.js`
  - 至少包含：`jurisdiction`、`contractTypeCategory` 或等价字段、`extraRequirements`、`provider/model`、`promptVersion`
  - 验收：不同法域/不同额外要求/不同版本上下文不会复用同一缓存结果。
- [x] 2.4 上传接口增加大小、MIME、扩展名校验。
  - 涉及：`server/routes/api.js`、`server/http-utils.js`、`server/store-sqlite.js`
  - 验收：超限文件被拒绝；非白名单类型被拒绝；错误提示明确。
- [x] 2.5 文档同步到当前实现。
  - 涉及：`README.md`、`RUNNING.md`、`PORTABILITY.md`
  - 验收：文档不再描述旧 token 提取方式；启动、健康检查、cookie-session 说明准确。
- [x] 2.6 过时辅助脚本标记或隔离。
  - 涉及：`scripts/split-server.py`、`scripts/extract_modules.py` 等
  - 验收：过时脚本有注释/归档说明，不再误导后续维护。
- [x] 2.7 移除前端 API token 残留逻辑。
  - 涉及：`js/api-client.js`、`tests/test-api-client.js`
  - 进展：前端请求已完全改为依赖 `cookie-session`，不再读取 `window.LEGAL_WORKBENCH_API_TOKEN` 或运行时配置中的 token 字段。
  - 验收：浏览器端不再主动写入 `X-Legal-Workbench-Token` 请求头。
- [x] 2.8 路径边界检查加固。
  - 涉及：`server/http-utils.js`、`electron/main.js`、相关测试
  - 进展：静态文件读取与 Electron 打开工作台目录均改为 `path.normalize + path.resolve + path.relative` 校验，不再依赖脆弱的字符串前缀判断。
  - 验收：同前缀兄弟目录或 `..` 绕过路径被拒绝。
- [x] 2.9 上传文件增加内容签名校验。
  - 涉及：`server/routes/api.js`、`tests/test-routes-api.js`
  - 进展：已为 `.docx` / `.pdf` / 文本类上传增加魔数或文本特征校验，并阻止可执行文件伪装上传。
  - 验收：伪装成文档的可执行文件会返回 400。
- [x] 2.10 补充集中配置模板与启动预检。
  - 涉及：`.env.example`、`scripts/preflight.js`、`start.bat`
  - 进展：新增 `.env.example`，`preflight` 增加 AI provider readiness 检查，`start.bat` 改为走 `npm run electron` 的固定本地版本启动方式。
  - 验收：新环境可直接参考 `.env.example` 配置；启动脚本不再依赖 `npx electron .`。

## 阶段 3：结构治理

目标：降低继续开发时的回归率和理解成本。

状态：`进行中`

- [~] 3.1 拆分 `js/app-events.js`
  - 目标文件：`events-nav.js`、`events-review.js`、`events-export.js`、`events-modal.js`
  - 进展：已拆出 `events-nav.js`、`events-modal.js`、`events-draft.js`、`events-review.js`、`events-export.js`、`events-backend.js`、`events-document.js`，并移除 `app-events.js` 中对这些 handler 的重复定义；当前 `app-events.js` 仅保留全局 click 分发和拖拽桥接。
  - 验收：上传/审阅/导出/导航事件分文件；功能不回归。
- [~] 3.2 建立最小 state 写入规范。
  - 涉及：`js/state.js`、`js/store.js`、`js/app-events.js`、`js/review-*.js`
  - 进展：已新增 `Store.mutate()` 并扩展到 `events-nav.js`、`events-draft.js`、`events-modal.js`、`events-review.js`、`events-export.js`、`events-backend.js`、`events-document.js` 等主要链路；后续继续替换剩余旧模块中的散写 `state` 路径。
  - 验收：核心写路径集中；直接散写 `state.xxx = ...` 明显减少。
- [~] 3.3 增加 `promptVersion` / `skillVersion` 追踪。
  - 涉及：`scripts/ai-*.js`、`server/legal-skill-adapter.js`、`server/contract-intake-adapter.js`、`server/visual-qa-adapter.js`
  - 进展：已为当前主要 runner 输出补上 `promptVersion`、`skillPath`、`downstreamSkill` 元数据，并开始在审阅台状态面板和 Visual QA 状态中展示；后续继续扩展到更多业务链路。
  - 验收：结果中能看到版本；缓存可感知版本差异。
- [~] 3.4 统一结果来源元数据。
  - 涉及：`js/api.js`、`server/*-adapter.js`、`js/render-review.js`
  - 进展：Legal Skill / intake / suggestion / visual QA 已逐步补齐 `source`、`fallbackReason`、`promptVersion` 等字段；UI 和运行诊断已开始展示 `source / promptVersion / skillPath / downstreamSkill / fallbackReason` 等关键信息。
  - 验收：UI 能稳定展示 provider、fallback、checkedAt、skill/prompt 版本。
- [~] 3.5 `runner-status` 页面化/诊断化。
  - 涉及：`server/routes/api.js`、诊断视图或 `js/render-review.js`
  - 进展：已在总览页增加“本地运行诊断”面板和手动刷新入口；后续继续完善更细粒度诊断展示。
  - 验收：用户能看懂“已配置/健康/降级/fallback”状态，而不是原始字段堆砌。

## 阶段 4：数据层与闭环测试

目标：处理深层技术债，但单独控风险。

状态：`进行中`

- [~] 4.1 设计 SQLite 增量持久化方案。
  - 涉及：`server/store-sqlite.js`、`server/store.js`
  - 进展：已补设计稿 `docs/sqlite-incremental-persistence-plan.md`，并新增第一批实际接口：`upsertContract`、`upsertContractVersion`、`replaceContractClauses`、`replaceContractFindings`、`replaceClauseActions`、`patchAuxState`、`appendAuditLog`；合同/条款建议采纳、重排、Visual QA 运行态和多类 UI 辅助状态已开始双写后端增量存储。
  - 验收：先有设计稿，明确哪些实体增量写、哪些仍保留 aux state。
- [~] 4.2 实现 mock runner 的端到端 smoke。
  - 涉及：`tests/`，新增 `tests/e2e-smoke.js`
  - 进展：已新增 mock E2E，覆盖 `intake -> legal-review job -> 结果完成 -> suggestion -> visual QA` 主链路；导出由 `tests/test-export-smoke.js` 单独补足。
  - 验收：上传 → intake → legal-review job → 采纳 → 导出 可稳定跑通。
- [~] 4.3 重新梳理 docx 双实现策略。
  - 涉及：`js/word-docx.js`、`scripts/docx-extract.js`、`server/routes/api.js`
  - 进展：`js/word-docx.js` 已明确“后端优先、浏览器保底 fallback”的策略注释，`tests/test-docx-pure.js` 已覆盖后端成功与回退到浏览器解析两条路径；后续再继续梳理服务端/脚本职责边界。
  - 验收：明确“后端优先、前端保底”边界；两边职责不再混乱。
- [~] 4.4 清理旧数据资产和明显误导性遗留物。
  - 涉及：`data/workbench-db.json`、过时脚本/旧说明
  - 进展：`data/workbench-db.json` 已移除，过时辅助脚本已加标记；后续继续清理剩余遗留说明。
  - 验收：仓库中不再保留误导性旧数据库文件。
- [x] 4.5 备份/恢复闭环验证。
  - 涉及：`server/store-sqlite.js`、相关测试
  - 进展：已把测试从“目录存在”增强到“备份 sqlite 可查询、合同归档文件已写入备份目录、恢复到新目录后可重新打开 sqlite 和归档文件”。
  - 验收：备份可恢复 SQLite + 合同归档文件，不只是“目录存在”。
- [x] 4.6 分析任务队列替代硬性 429。
  - 涉及：`server/jobs.js`、`tests/test-jobs.js`
  - 进展：`MAX_ANALYSIS_JOBS` 已从“超过即拒绝”调整为“并发上限 + FIFO 队列”，job summary 会返回 `positionInQueue`。
  - 验收：超出并发时新任务进入排队，不再直接返回 429。
- [x] 4.7 长文档条款分块分析。
  - 涉及：`server/legal-skill-adapter.js`、`scripts/ai-skill-runner.js`、`tests/test-legal-skill-pure.js`
  - 进展：当合同文本或条款数量超过阈值时，后端会按条款块拆分请求、分块调用 Agent A，再合并 `clauseAnalyses` / `contractLevelRisks` / `missingFacts`。
  - 验收：长合同不会只分析前半部分；分块结果能合并回统一输出结构。

## 每阶段都要回归的核心链路

（详见 `docs/END_TO_END_TEST_PLAN.md` — TC-MAIN-01 完整审阅闭环）

- [x] 新建审阅
- [x] 上传 `.docx`
- [x] intake 自动填充
- [x] Agent A 审阅
- [x] fallback 提示
- [x] Agent B 检查
- [x] 采纳/拒绝建议
- [x] 导出 Word
- [x] 备份
- [x] 重启后再次打开合同

## 当前下一步

当前默认下一步：

1. 继续清理 `1.1` 剩余用户可见乱码/旧文案。
2. 继续补 `3.3 -> 3.4` 的版本与来源元数据统一。
3. 继续把高频前端写路径切到 `4.1` 的局部持久化接口。

## 本次审计修复（2026-06-11）

基于对当前远端最新代码（commit `f3bed86`）的全面审查，以下问题已修复或已安排修复方案。

### 已修复 — Critical

- [x] **C1: 禁止直接 `localStorage.setItem`，全部路由到 `saveState()`**
  - 涉及：`js/api/core.js` 4 处直接写入
  - 修复：全部改为 `saveState()`，避免大合同触发 `QuotaExceededError` 后数据被清空
- [x] **C2: `Store.mutate()` 嵌套副作用破坏不可变性**
  - 涉及：`js/store.js`
  - 修复：`mutate()` 内部增加深克隆快照 + try/catch 回滚机制，updater throw 时自动恢复状态
- [x] **C3: 长耗时 async 后结果可能渲染到错误合同**
  - 涉及：`js/app-contract-actions-overrides.js`
  - 修复：`await runLegalSkillAnalysis` 之后增加 `state.activeContractId !== contract.id` 守卫
- [x] **C4: `splitVersionClauses()` 缓存键冲突 + 无界增长**
  - 涉及：`js/review-material.js`
  - 修复：缓存键改为 `${sourceKey}||${text.length}||${djb2Hash(text)}`；增加 LRU 淘汰
- [x] **C6: 构建脚本缺少 `electron-rebuild`**
  - 涉及：`package.json`
  - 修复：加入 `devDependencies`
- [x] **C7: CSRF 漏洞（same-site localhost 攻击）**
  - 涉及：`server/http-utils.js`、`js/api-client.js`
  - 修复：mutating 请求要求 `X-Requested-With: LegalWorkbench` header；`legalWorkbenchFetch` 自动携带

### 已修复 — High

- [x] **H1: 定时器泄漏（最小修复）**
  - 涉及：`js/store.js`
  - 修复：`setActiveContract()` 中清理 `clauseEditAutosaveTimer`
- [x] **H2: `pollLegalSkillJob()` AbortController 泄漏**
  - 涉及：`js/api/core.js`
  - 修复：新 poll 开始前 abort 旧 controller
- [x] **H3: `applyVisualQaAutoFixes()` 直接修改 state，绕过 `Store.mutate()`**
  - 涉及：`js/api/visualqa.js`
  - 修复：两条路径（applied / !applied）均包裹进 `Store.mutate()`，并带 audit
- [x] **H4: `renderPlaybookCards()` 渲染时变异状态**
  - 涉及：`js/playbook.js`
  - 修复：`knowledgeSignals` / `confidenceScore` 改为局部变量，不再写回 `item`
- [x] **H5: `buildClauseLevelComparisonHtml()` 给 `splitClauses()` 传了对象**
  - 涉及：`js/review-redline.js`
  - 修复：改为传字符串 `"comparison-prev"` / `"comparison-curr"`
- [x] **H6: `filterCounterparties()` 每击键全量重建、无防抖**
  - 涉及：`js/counterparties.js`
  - 修复：增加 150ms debounce + `WeakMap` 缓存 `buildCounterpartyProfile`
- [x] **H7: `getDeadlineDeltaDays()` 对非法日期返回 `NaN`**
  - 涉及：`js/review-material.js`
  - 修复：增加 `YYYY-MM-DD` 正则校验 + `Invalid Date` 兜底返回 `Infinity`
- [x] **H8: 打包模式下后端脚本路径未验证**
  - 涉及：`electron/main.js`
  - 修复：`spawn` 前检查 `fs.existsSync(serverScript)`，缺失时直接报错退出
- [x] **H9: `ELECTRON_RUN_AS_NODE=1` ABI 不匹配风险**
  - 涉及：`electron/main.js`
  - 修复：打包模式下优先使用系统 `node`（`LEGAL_WORKBENCH_NODE_COMMAND`），回退到 `process.execPath`
- [x] **H10: `portable-smoke.js` 竞态条件**
  - 涉及：`scripts/portable-smoke.js`
  - 修复：`healthCheckPromise` 共享，exit handler 等待其 settle
- [x] **H11: `asar: false` 暴露源码、拖慢 I/O**
  - 涉及：`package.json`
  - 修复：`asar: true` + `asarUnpack` 原生模块
- [x] **H12: `compact()` 截断合同尾部（责任限制/争议解决等常在末尾）**
  - 涉及：`scripts/ai-runner-lib.js`
  - 修复：改为保留前 60% + 后 40%，避免尾部关键条款被静默丢弃
- [x] **H14: `clauseEditAutosaveTimer` 仅 180ms，过于激进**
  - 涉及：`js/events-document.js`
  - 修复：改为 800ms
- [x] **BACKEND_SYNC_DELAY_MS 过短（800ms → 2500ms）**
  - 涉及：`js/api/core.js`
  - 修复：改为 2500ms，减少全量同步频率

### 已修复 — Medium

- [x] **M3: `reviewAdviceSyncCleanup` / `reviewAdviceSyncFrame` 永不重置**
  - 涉及：`js/render-review.js`
  - 修复：`renderReview()` 入口统一清理旧 sync cleanup 和 rAF
- [x] **M5: `word-docx.js` 同步 `DOMParser` 无错误处理**
  - 涉及：`js/word-docx.js`
  - 修复：`wordDocumentXmlToBlocks` / `wordCommentsXmlToText` 检查 `parsererror`
- [x] **M10: `showToast()` DOM 节点只增不减**
  - 涉及：`js/ui-shell.js`
  - 修复：toast 隐藏后从 DOM 移除

### 已修复 — 架构级改动

- [x] **C5: 运行时 JSON Schema 验证（ajv）**
  - 涉及：`scripts/ai-runner-lib.js`、`schemas/*.json`
  - 修复：安装 `ajv`，在 `runJsonTask` 返回路径上增加 `validateAgainstSchema()`；验证失败抛出结构化错误
- [x] **H13: 主线程同步 DOCX 解析阻塞 UI**
  - 涉及：`js/word-docx.js`、`js/workers/docx-parser.worker.js`（新增）
  - 修复：将 `parseDocxBuffer` 及其 ZIP/XML 解析依赖移入 Web Worker；主线程通过 `runDocxParserWorker()` 调用
- [x] **H1-完整版: 集中定时器注册表（TimerRegistry）**
  - 涉及：`js/timer-registry.js`（新增）、`js/api/core.js`、`js/api/visualqa.js`、`js/events-document.js`、`js/events-review.js`、`js/search.js`、`js/ui-shell.js`、`js/app.js`、`js/store.js`、`js/app-router.js`
  - 修复：新增 `TimerRegistry` 模块；核心 timer（backend-health、backend-sync、clause-click、search、toast、visual-qa、clause-edit-autosave）已替换；`setView()` 和 `setActiveContract()` 调用 `TimerRegistry.clearAll()`

### 待后续推进

- [x] **端到端主链路回归验证**
  - 涉及：`TODO.md` 底部 10 项核心链路
  - 方案：已编写 `docs/END_TO_END_TEST_PLAN.md`，覆盖 7 大功能域 40+ 子功能，含 P0 核心主链路（新建 → 上传 → intake → Agent A → fallback → Agent B → 采纳 → 导出 → 备份 → 重启后打开）的详细手动测试步骤
  - 执行：已运行全量自动化测试（553 unit tests + 16 Playwright E2E + mock E2E smoke），生成 `docs/E2E_TEST_EXECUTION_REPORT_2026-06-11.md`
  - 结果：567/571 通过（99.3%），4 个失败均为测试用例/环境问题，非产品 bug
  - 验收：测试方案可执行，覆盖所有本次修复的关键点

---
