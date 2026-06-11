# 全面审查报告 (f3bed86) — 开发者本地使用稳定性与用户体验

> 审计日期：2026-06-11  
> 审计范围：最新 commit `f3bed86` (fix: add backend error logging for legal-review/jobs 500; fix start.bat encoding)  
> 审计方式：人工深度走读 + 并行子代理探索（前端架构、后端稳定性、Electron/脚本层）+ 历史审计对比  
> 视角：开发者个人本地使用，重点关注**日常崩溃、卡顿、数据丢失、进程泄漏、开发效率**等影响实际使用体验的问题

---

## 一、与历史审计的对比说明

本项目在 2026-06-09 至 2026-06-11 期间经历了两轮密集修复（`d4646aa` → `d353bbc` → `f3bed86`），大量 Critical/High 问题已闭环。本报告**不再重复列举已确认修复的问题**，只聚焦于当前代码中**仍然残留或新发现**的影响开发者日常使用的痛点。

已确认修复的关键问题包括：
- 分块分析串行执行 → **已改为并发 worker pool**
- `withTimeout` 不杀子进程 → **已加 `abort()` + `terminateJobChild()`**
- `runWithRetry` 重试所有错误 → **已加 `isRetryableError` 白名单**
- `backendRestartCount` 永不重置 → **已加 "listening" 检测重置**
- `renderReview` 完全无保护 → **已加 `isRenderStateUnchanged` dedup + focus/scroll 保留**
- `saveState` localStorage 静默失败 → **已加 toast 提示**
- 主线程 DOCX 解析阻塞 UI → **已移入 Web Worker**
- `restoreBackupToDirectory` 覆盖打开的数据库 → **已加 `closeDb()` + reopen**
- `autoBackupOnQuit` 无超时 → **已加 5s `AbortController`**
- `/api/db/sync` 无并发保护 → **已加 `isSyncing` 标志**
- `child.stdin` 未处理错误 → **已加 `stdin.on('error', () => {})`**
- `busy_timeout` 缺失 → **已设置 `{ timeout: 5000 }`**
- 优雅关闭缺失 → **已加 `SIGINT`/`SIGTERM` handler**

---

## 二、核心问题汇总（当前残留）

### 🔴 Critical — 会导致崩溃、数据丢失或每日使用受阻

#### C1. `pruneOrphanedFiles` 引用未定义的 `logger` → 进程硬崩溃
- **文件：** `server/store-sqlite.js:692`
- **现象：** 该文件顶部没有 `const logger = require("../scripts/logger");`，但 `pruneOrphanedFiles` 函数中直接调用 `logger.error(...)`。
- **触发条件：** 当数据库中存在 `file_path` 指向 `WORKBENCH_ROOT` 外部的记录时（例如手动迁移过数据、备份恢复后路径不一致），`isPathInsideRoot` 返回 false，进入 `logger.error` 分支。
- **开发者体验：** 后端进程直接抛出 `ReferenceError: logger is not defined`，成为未捕获异常，触发 `uncaughtException` → `gracefulShutdown` → `process.exit(1)`。Electron 检测到后端退出会尝试重启，若该条件持续存在，后端陷入**无限崩溃重启循环**（5 次后永久停止）。
- **修复：** `const logger = require("../scripts/logger");` 加到 `server/store-sqlite.js` 顶部。

#### C2. `child.stdin.write()` 同步抛错未被捕获 → 后端进程可能崩溃
- **文件：** `server/base-adapter.js:88`
- **现象：** `child.stdin.write(JSON.stringify(request, null, 2))` 在 Promise constructor 中同步执行。虽然加了 `child.stdin.on("error", () => {})`，但 `writable.write()` 在底层流已 destroyed 时可能**同步抛出** `ERR_STREAM_DESTROYED` 或 `EPIPE`，这个同步异常不在 Promise 的 reject 路径上。
- **触发条件：** AI runner 脚本配置错误、二进制缺失、或子进程在 `execFile` 后极短时间内崩溃（Windows 上常见）。
- **开发者体验：** 配置了一个不存在的 skill runner，点击"开始审阅"后后端直接崩溃，Electron 窗口白屏或显示"后端服务异常"。
- **修复：** 将 `write()` 和 `end()` 包裹在 `try/catch` 中，同步异常转为 `reject`。

#### C3. `safeJson` 对循环引用返回 `"null"` → 缓存/数据库污染
- **文件：** `server/store-sqlite.js:352`
- **现象：** `safeJson` 只是 `try { JSON.stringify(value) } catch { return "null" }`。与 `http-utils.js` 中的 `safeJsonStringify`（带 `WeakSet` 循环引用处理）不一致。AI runner 输出偶尔包含循环引用（例如某些框架的响应对象）时，`safeJson` 返回字符串 `"null"`，被存入 SQLite 缓存表或 job 表。
- **触发条件：** AI provider 返回异常结构、或 runner 内部对象被意外序列化。
- **开发者体验：** 下次启动时缓存加载 `"null"`，`parseJson` 返回 `null`，系统将其当作**有效缓存命中**，UI 显示"分析完成"但结果为空。开发者可能花费大量时间排查 AI 模型问题，而实际上是缓存污染。
- **修复：** 统一使用 `http-utils.js` 的 `safeJsonStringify`（可处理循环引用，输出 `"[Circular]"` 而非 `"null"`），或在解析时拒绝 `"null"` 字符串。

#### C4. `app-contract-actions-overrides.js` 含乱码 + 重复定义 → 维护陷阱
- **文件：** `js/app-contract-actions-overrides.js`、`index.html:283`
- **现象：** 该文件被 `index.html` 显式加载，其中包含大量 mojibake 乱码（如 `AI 宸茶嚜鍔ㄥ紑濮嬪悎鍚屽闃呭垎鏋愶紝骞朵細鍚屾椂杩斿洖鏉℃鍒囧垎...`）。同时它与 `js/app-contract-actions.js` 定义了同名函数 `scheduleAutomaticCodexReview` / `runAutomaticCodexReview`。
- **开发者体验：** 浏览器加载顺序决定哪个版本生效（后加载的覆盖先加载的）。`index.html` 中 `app-contract-actions-overrides.js` 在 `app-contract-actions.js` 之后加载，因此**覆盖生效**。任何对 `app-contract-actions.js` 的修改都可能被 overrides 文件抵消，且乱码字符串在运行时可能以不可预期的方式影响 UI 文案。这是典型的"改动不生效"调试地狱。
- **修复：** 删除 `js/app-contract-actions-overrides.js`，将其中的守卫逻辑（如 `state.activeContractId !== contract.id` 检查）合并回 `app-contract-actions.js`；从 `index.html` 移除引用。

---

### 🟠 High — 频繁导致不稳定或明显卡顿

#### H1. `replaceDb` 同步全量替换 → 后端事件循环阻塞数秒
- **文件：** `server/store-sqlite.js:721-943`
- **现象：** `replaceDb` 执行 `BEGIN IMMEDIATE` → `DELETE FROM` 所有结构化表 → 逐行 `INSERT` 整个前端 state。`better-sqlite3` 是同步 API，大合同时（50+ 条款、数百条 findings）整个操作在事件循环主线程上运行。
- **开发者体验：** 前端快速编辑时，每 2.5s 触发一次后端同步。同步期间后端完全不响应任何 HTTP 请求，UI 出现"转圈"、点击无反应、健康检查超时。如果同步期间点击"导出"或"备份"，请求排队或失败。
- **修复方向：**
  - 短期：`replaceDb` 拆分为小批次，每批次后 `setImmediate` 让出事件循环；或优先推广 `incrementalSync`（`aux-patch` / `incremental` 模式）。
  - 长期：前端默认走 `incrementalSync`，只有首次加载/强制刷新才走 `replaceDb`。

#### H2. `saveAnalysisJob` 每次状态更新都序列化完整合同文本 → WAL 膨胀 + I/O 放大
- **文件：** `server/store-sqlite.js:1296`
- **现象：** `saveAnalysisJob` 执行 `request_json: safeJson(job.request || {})`。`job.request` 包含完整的 `contract_text`（可能是数万字的合同全文）。一个 job 的生命周期包含：queued → running → completed/failed，至少 3 次 `saveAnalysisJob` 调用。
- **开发者体验：** 分析大合同时，`request_json` 列被反复写入 3 次 × 10MB = 30MB 的重复数据。SQLite WAL 文件迅速膨胀到数百 MB，`better-sqlite3` 的 WAL checkpoint 触发频繁磁盘刷写。在机械硬盘或繁忙的系统上，这会导致后端卡顿、前端 polling 超时、甚至 `SQLITE_BUSY`。
- **修复：** job 持久化时从 `request` 中剔除 `contract_text` / `previous_text` / `clauses` 等大字段，只保留元数据（合同 ID、类型、法域等）。需要文本时可从 contracts 表重新查询。

#### H3. `captureRenderState()` 每次状态变化都 `JSON.stringify` 大数组 → 前端主线程卡顿
- **文件：** `js/render-review.js:20-34`
- **现象：** `captureRenderState()` 对 `state.clauses`、`state.findings`、`state.clauseActions` 执行 `JSON.stringify` 以生成 dedup hash。虽然 `isRenderStateUnchanged` 能跳过不必要的重渲染，但**每次状态变化（包括按键触发的 autosave）仍然要先执行 stringify**。
- **开发者体验：** 在 500+ 条款的合同中，每次按键后 `JSON.stringify(state.clauses)` 耗时 30-100ms。虽然比全量 innerHTML 重建轻，但叠加 800ms autosave debounce、2.5s backend sync、和可能的 `renderReview` dedup 命中，打字手感仍然有"粘滞"感。
- **修复方向：**
  - 短期：用 `version` 计数器或 `lastModifiedAt` 时间戳替代 `JSON.stringify` hash。
  - 长期：将 clauses / findings 改为不可变结构，比较引用即可。

#### H4. `electron-bridge.js` 永久 `MutationObserver` → CPU 泄漏 + 加剧渲染卡顿
- **文件：** `js/electron-bridge.js:86-96`
- **现象：** `MutationObserver` 在 `document.body` 上以 `{ childList: true, subtree: true }` 模式永久运行，永不 `disconnect()`。每次 `renderReview()` 执行 `innerHTML = ...` 都会触发大量 DOM mutation 事件，observer 回调执行 `enhanceTopbar()` 和 `enhanceContractCards()`，后者调用 `document.querySelectorAll(".contract-card, .review-contract-identity")` 扫描整个 DOM。
- **开发者体验：** 大合同的 `renderReview` 重建本身就慢（数百毫秒），加上 observer 回调在重建后立刻全量扫描 DOM，又增加 20-50ms。连续操作时 CPU 使用率持续居高不下。长期运行后，observer 持有对已销毁 DOM 子树的引用，增加 GC 压力。
- **修复：**
  - 在 observer 回调中先检查 `document.body` 是否存在；
  - 使用 `requestIdleCallback` 或 debounce 延迟增强逻辑；
  - 更彻底：在 `setView()` 切换视图时 `disconnect()` observer，进入 review 视图后再重新 `observe()`。

#### H5. `unhandledRejection` 只记录不退出 → 静默数据损坏风险
- **文件：** `server/server.js:85-87`
- **现象：** `process.on("unhandledRejection", (reason, promise) => { logger.error(...); console.error(...); })`。只记录，不调用 `process.exit()`。
- **开发者体验：** Node.js 官方明确指出：未处理的 Promise 拒绝意味着应用处于未定义状态。一个后台的数据库写入或文件流操作失败被拒绝后，开发者从 UI 上看不到任何异常，但后续操作可能基于"已成功"的假设继续执行，导致数据不一致。调试时表现为"为什么重启后数据少了"或"为什么搜索结果不对"。
- **修复：** 添加 `process.exit(1)`，或至少设置一个 `process.exitCode = 1` 让进程在当前任务结束后退出。对于开发者自用的桌面应用，崩溃重启（Electron 会重启后端）比静默数据损坏更可接受。

#### H6. `readJson` 150MB 上限 + `replaceDb` 同步处理 → OOM / 事件循环阻塞
- **文件：** `server/http-utils.js:186`、`server/routes/handlers/system.js:61`
- **现象：** `readJson` 在 body 达到 150MB 时销毁请求，但 149MB 的合法 JSON 仍然会被完整读入内存并 `JSON.parse`。如果这是 `/api/db/sync` 的调用，解析后的对象会被直接传入 `replaceDb` 同步处理。
- **开发者体验：** 极端情况下（如 contracts 数组中包含大量 base64 编码的附件），前端同步 payload 可能达到数十 MB。后端 `JSON.parse` 阻塞数秒，随后 `replaceDb` 又阻塞数秒，期间所有 API 无响应。
- **修复：** `/api/db/sync` 增加 payload 大小上限（如 10MB），超限返回 413；或要求前端对大 state 进行分块同步。

#### H7. `stopBackend()` 仍可能移除关键的 close 监听器 → 引用泄漏或状态不一致
- **文件：** `electron/main.js:248`
- **现象：** `stopBackend()` 调用 `backendProcess.removeAllListeners("close")`。虽然后续有 PID 轮询和 8s 硬超时，但如果 `close` 事件恰好在 `removeAllListeners` 之后、PID 轮询确认之前触发，原始 close handler（负责设置 `backendProcess = null`）已被移除，导致 `backendProcess` 引用残留。
- **开发者体验：** 快速重启开发时（Ctrl+R 或代码热重载），`startBackend()` 因 `backendProcess` 仍为 truthy 而提前返回，实际后端进程可能已死，前端连接到不存在的端口，显示白屏或"连接失败"。
- **修复：** 用 `isStopping` 标志替代 `removeAllListeners`，保留原始的 `close` handler 让它自然地清理引用。

---

### 🟡 Medium — 累积性问题或特定场景下的痛点

#### M1. Kimi provider 分块并发强制为 1 → 大合同分析仍然很慢
- **文件：** `server/legal-skill-adapter.js:344`
- **现象：** `const isKimi = provider === "kimi" || provider === "moonshot"; const chunkConcurrency = isKimi ? 1 : MAX_CHUNK_CONCURRENCY;`。即使 `MAX_CHUNK_CONCURRENCY` 设为 3，Kimi 也被强制串行。
- **开发者体验：** 使用 Kimi 分析 400 条款的大合同时，需要 5-8 个 chunk，每个 30-60 秒，总耗时 3-8 分钟。期间 UI 持续 polling，开发者只能干等。
- **修复：** 将 `chunkConcurrency` 改为可配置（环境变量或 `config.js`），默认 2 而非 1；或实现基于 429 响应的自适应退避，先尝试并发，遇到 rate limit 再降级。

#### M2. `uploadedFileCache` 仍无界 → 浏览器内存缓慢泄漏
- **文件：** `js/state.js:6`
- **现象：** `const uploadedFileCache = new Map();` 没有大小限制或 TTL。每次上传 DOCX/PDF 后，ArrayBuffer 被缓存。连续上传 10-20 份大合同（每份 5-10MB）后，缓存累积到 100MB+。
- **开发者体验：** 长时间不刷新页面时，Electron renderer 进程内存持续增长。虽然不如之前严重（已修复其他泄漏），但仍是长期使用的隐患。
- **修复：** 改为 LRU Map，限制最多保留 5-10 个最近上传的文件，或在上传成功解析后主动 `delete` 缓存条目。

#### M3. `rebuildSearchIndex` 失败无状态标记 → 搜索永久失效直到重启
- **文件：** `server/store-sqlite.js:1660-1662`
- **现象：** `rebuildSearchIndex` 失败时只 `console.error`，不写入任何状态标记，也不在下次启动时自动重试。
- **开发者体验：** 如果某次同步导致 FTS5 虚拟表损坏（罕见但可能发生），搜索功能突然返回空结果。开发者不知道原因，重启后可能恢复（因为重启会再次调用 `rebuildSearchIndex`），但如果不重启，搜索一直坏着。
- **修复：** 在 `app_state` 表中写入 `searchIndexStatus`，失败时标记为 `dirty`，下次 `/api/health` 或同步时检查并自动重试。

#### M4. `incrementalSync` 无事务保护 → 部分写入导致数据不一致
- **文件：** `server/routes/handlers/system.js:114-152`
- **现象：** `incrementalSync` 对 contracts、versions、clauses、findings、actions 分别循环写入，但没有包裹在一个数据库事务中。如果某一步失败（如 clauses 写入成功但 findings 写入失败），数据库处于半完成状态。
- **开发者体验：** 极端情况下（磁盘满、WAL 损坏），重启后发现合同存在但条款缺失，或条款存在但建议缺失。
- **修复：** 将 `incrementalSync` 的所有写入操作包裹在 `db.transaction()` 中。

#### M5. `buildCostMetadata` 硬编码汇率 → 成本估算不可信
- **文件：** `server/jobs.js:136-138`
- **现象：** 硬编码 `ratePer1k = meta.model.includes("moonshot") ? 0.024 : 0.03`，没有任何注释说明汇率来源和更新时间。
- **开发者体验：** 成本估算功能存在但数值不可信。开发者可能基于错误估算做出"这个模型太贵了"的错误决策。
- **修复：** 添加注释说明这是示例估算；或从环境变量读取实际费率。

#### M6. 全局事件监听器永不移除 → 长期运行 handler 链延迟增加
- **文件：** `js/app-events.js`、`js/events-document.js`、`js/search.js`
- **现象：** 这些模块在加载时通过 `document.addEventListener` 注册全局监听器（click、input、dblclick、drag 等），从未移除。在 Electron 长期运行场景下，这些监听器会处理每一次用户交互。
- **开发者体验：** 虽然单次影响极小，但随着功能增加，handler 链越来越长。`app-events.js` 的长 `if/else` 分支在每次点击时遍历大量条件判断，累积延迟。
- **修复：** 对视图级事件（如 review 模式的 click）在 `setView()` 切换时移除；全局事件使用事件委托优化。

#### M7. 测试硬编码 Windows Chrome 路径 → 跨平台/CI 不可用
- **文件：** `scripts/manual-flow-check.js`、`scripts/test-layer3-frontend-e2e.js`
- **现象：** E2E 测试只查找 `C:\Program Files\Google\Chrome\Application\chrome.exe` 等 Windows 路径，没有 fallback 到 Playwright 自带的 Chromium，也没有 macOS/Linux 路径。
- **开发者体验：** 在 macOS 或 Linux CI 上无法运行完整 E2E 测试；Windows 上如果 Chrome 安装在其他位置也找不到。
- **修复：** 优先使用 Playwright 的 `chromium.launch()`（自动管理浏览器），允许通过环境变量覆盖可执行文件路径。

---

### 🟢 Low — 边缘情况或轻微不便

#### L1. `renderReview` 的 focus/scroll 保留是补丁而非根治
- **现象：** 当前通过快照 `document.activeElement` 和 `scrollTop` 后恢复来缓解全量 innerHTML 重建的副作用。但这无法处理 IME 合成状态、iframe 焦点、shadow DOM 内的焦点、以及滚动容器嵌套场景。
- **修复方向：** 长期应迁移到增量更新（`DocumentFragment` diff 或虚拟 DOM）。

#### L2. `diffResult` 闭包引用原始大数组 → 临时内存膨胀
- **文件：** `server/jobs.js:195-201`
- **现象：** `diffResult = buildInlineDiffParts(...)` 可能返回一个非常大的数组。虽然后面 `diffResult = diffResult.slice(0, 200)` 创建了小数组，但闭包中的原始 `diffResult` 变量仍引用原始大数组，直到 `executeAnalysisJob` 结束。
- **影响：** 较小，因为函数很快就会结束。但如果这里被重构为异步多步骤，原始引用可能长时间存活。
- **修复：** `let diffResult = ...` 后立即在成功路径上 `diffResult = diffResult.slice(0, 200)`，不要先赋值给大变量再 slice。

#### L3. `start.bat` 编码问题虽已修复，但 PowerShell 脚本仍依赖 `-ExecutionPolicy Bypass`
- **现象：** `setup-windows.ps1` 在多数企业 Windows 机器上会被 Group Policy 阻止。虽然 `README` 提到用 `npm.cmd run server:ai` 绕过，但桌面启动路径（`desktop:launch`）仍然依赖 PowerShell。
- **修复：** 提供一个纯 `.bat` 或 `.cmd` 的备用启动路径，不依赖 PowerShell。

#### L4. 全局命名空间污染仍然严重
- **现象：** `state`、`seedData`、`Store`、`TimerRegistry`、`window.isElectronApp`、`window.currentReviewPlacementContext` 等全局变量/属性散布在 40+ 个文件中。新增功能时容易命名冲突，单元测试难以隔离。
- **修复方向：** 引入 ES modules（`type: "module"`）或至少 IIFE 封装，但改动面极大，可长期规划。

---

## 三、问题分类统计

| 级别 | 数量 | 主要影响 |
|------|------|---------|
| 🔴 Critical | 4 | 进程崩溃、缓存污染、维护陷阱 |
| 🟠 High | 7 | 同步阻塞、I/O 放大、静默损坏、内存泄漏 |
| 🟡 Medium | 7 | 大合同性能、数据一致性、跨平台测试 |
| 🟢 Low | 4 | 架构债务、边缘内存、启动依赖 |
| **总计** | **22** | |

---

## 四、开发者日常体验影响映射

| 日常操作 | 仍遇到的问题 | 严重程度 |
|---------|-----------|---------|
| **打开应用** | `unhandledRejection` 不退出 → 静默损坏可能 | High |
| **上传 Word 合同** | `MutationObserver` 加剧大文件渲染卡顿 | High |
| **编辑条款文本** | `captureRenderState` stringify 卡顿；`replaceDb` 同步阻塞后端 | High / Critical |
| **滚动/浏览长合同** | `MutationObserver` 全量扫描 DOM；`renderReview` 仍是全量重建 | High |
| **运行 AI 分析** | `saveAnalysisJob` 反复序列化大合同 → WAL 膨胀；Kimi 强制串行 → 等待时间长 | High / Medium |
| **切换合同** | `app-contract-actions-overrides` 乱码/重复 → 行为不一致风险 | Critical |
| **导出 Word** | `replaceDb` 阻塞期间导出请求排队/超时 | High |
| **退出应用** | `stopBackend` 仍可能泄漏引用；整体已大幅改善 | Medium |
| **用外部工具查看数据库** | `busy_timeout` 已修复；`pruneOrphanedFiles` 的 `logger` 崩溃是新的风险 | Critical |
| **频繁重启后端开发** | `stopBackend` 引用清理不彻底 → 偶发端口冲突 | High |

---

## 五、修复优先级建议（开发者自用视角）

### P0 — 立即修复（影响每日使用，工作量极小）

| # | 问题 | 工作量 | 收益 |
|---|------|--------|------|
| 1 | `server/store-sqlite.js` 导入 `logger` (C1) | 1 行 | **消除可复现的进程崩溃** |
| 2 | `base-adapter.js` `write()` 同步 `try/catch` (C2) | 3 行 | **防止配置错误导致后端崩溃** |
| 3 | 统一 `safeJson` 使用 `safeJsonStringify` (C3) | 替换引用 | **消除缓存污染导致的空结果** |
| 4 | 删除 `app-contract-actions-overrides.js` 并合并逻辑 (C4) | 5 分钟 | **消除维护陷阱和乱码** |

### P1 — 短期修复（显著改善体验，工作量中等）

| # | 问题 | 工作量 | 收益 |
|---|------|--------|------|
| 5 | `saveAnalysisJob` 剔除大文本字段 (H2) | ~10 行 | **减少 WAL 膨胀和 I/O** |
| 6 | `captureRenderState` 用版本号替代 `JSON.stringify` (H3) | ~10 行 | **减少打字粘滞感** |
| 7 | `electron-bridge.js` observer debounce + disconnect (H4) | ~15 行 | **降低渲染后 CPU 峰值** |
| 8 | `unhandledRejection` 退出进程 (H5) | 1 行 | **fail-fast，避免静默损坏** |
| 9 | `stopBackend` 用标志替代 `removeAllListeners` (H7) | ~5 行 | **消除快速重启时的引用泄漏** |
| 10 | `/api/db/sync` payload 上限 (H6) | ~5 行 | **防止极端 OOM** |

### P2 — 中期修复（架构改进，工作量中等）

| # | 问题 | 工作量 | 收益 |
|---|------|--------|------|
| 11 | `replaceDb` 批次化或全面推广 `incrementalSync` (H1) | 中 | **消除后端冻结** |
| 12 | `incrementalSync` 包裹数据库事务 (M4) | ~5 行 | **保证数据一致性** |
| 13 | Kimi 分块并发可配置 (M1) | ~5 行 | **大合同分析提速 2-3x** |
| 14 | `uploadedFileCache` 改为 LRU (M2) | ~15 行 | **减少长期内存泄漏** |
| 15 | E2E 测试使用 Playwright 自带 Chromium (M7) | ~10 行 | **跨平台测试可用** |

### P3 — 可搁置（开发者自用影响小）

- `renderReview` 增量更新架构（L1）
- 全局命名空间模块化（L4）
- `diffResult` 闭包引用（L2）
- `buildCostMetadata` 硬编码汇率（M5）

---

## 六、总体评估

**当前代码状态：** 相比 `d353bbc`，系统核心稳定性已有质的飞跃。进程管理、错误重试、焦点保留、备份超时、优雅关闭等关键痛点均已闭环。**但仍有 4 个 Critical 问题（其中 3 个是 1-3 行即可修复的明显疏漏）和 7 个 High 问题阻碍开发者日常流畅使用。**

**最严重的三个残留问题：**
1. **`pruneOrphanedFiles` 的 `logger` 未定义** — 这是当前唯一一个"确定会炸"的代码路径，且修复只需加一行 import。
2. **`replaceDb` / `saveAnalysisJob` 的同步大 I/O** — 大合同时后端冻结和 WAL 膨胀是日常最频繁的卡顿来源。
3. **`renderReview` 的 `JSON.stringify` dedup + `MutationObserver` 扫描** — 两者叠加，使大合同的前端交互仍不够流畅。

**建议：** 先集中 30 分钟完成 P0 的 4 个极小修复（总计不到 20 行代码），立即消除崩溃和缓存污染风险；然后投入 2-4 小时完成 P1 的 6 个修复，显著改善日常交互流畅度和开发可靠性。P2 的架构改进可在后续迭代中分批实施。
