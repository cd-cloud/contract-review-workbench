# 全面审查报告 (d353bbc) — 开发者本地使用稳定性与用户体验

> 审计日期：2026-06-10  
> 审计范围：最新 commit `d353bbc` (Harden backup restore and codex runner temp cleanup)  
> 审计方式：4 个并行子代理深度审查（Electron 主进程、前端 UX、AI 运行器、后端稳定性）+ 人工复核  
> 视角：开发者个人本地使用，重点关注**日常崩溃、卡顿、数据丢失、进程泄漏**等影响实际使用体验的问题

---

## 一、已确认修复的问题（本轮提交 d353bbc）

| 问题 | 修复状态 | 说明 |
|------|---------|------|
| `runCodexJsonTask` 临时文件泄漏 | ✅ 已修复 | `cleanupOutputFile()` + `settleResolve/settleReject` 确保临时 JSON 被删除 |
| 分块分析串行执行 | ✅ 已修复 | 引入 `MAX_CHUNK_CONCURRENCY=3` + worker 池模式，`Promise.all` 并行执行 |
| `restoreBackupToDirectory` 覆盖打开的数据库 | ✅ 已修复 | 增加 `resolvedTarget === WORKBENCH_ROOT` 和 `targetDbPath === DB_PATH` 检查，拒绝覆盖当前数据库 |
| `rebuildSearchIndex` 事务外运行 | ✅ 已修复 | 纳入 `db.transaction()` 中；`search()` 自动检测空索引并重建 |

---

## 二、核心问题汇总（去重后）

### 🔴 Critical — 会导致崩溃、数据丢失或每日使用受阻

#### C1. `withTimeout` 拒绝但不杀死子进程 → 僵尸进程 + 队列阻塞
- **文件：** `server/jobs.js:39-48`, `server/jobs.js:158-198`
- **现象：** 10 分钟超时后 Promise 拒绝，但 `AbortController` 未中止，`runWithRetry` 继续后台重试，可能产生更多子进程。
- **开发者体验：** 每天分析几份合同后，后台积累多个僵尸 Node 进程，CPU/内存飙升，队列永久阻塞，必须重启应用。
- **修复：** 在 `withTimeout` 的 timer 分支调用 `controller.abort()`；在 `runWithRetry` 的 retry delay 前检查 `signal.aborted`。

#### C2. `child.stdin.write` 未处理 EPIPE → 后端进程崩溃
- **文件：** `server/legal-skill-adapter.js:149-150`, `server/suggestion-action-adapter.js:97-98`, `server/contract-intake-adapter.js:96-97`, `server/visual-qa-adapter.js:103-104`
- **现象：** 子进程提前退出（脚本缺失、崩溃）时，`child.stdin.write()` 向已关闭的管道写入，抛出未处理的 `'error'` 事件。
- **开发者体验：** 配置错误的 AI runner 或缺失的 skill 文件会直接**导致后端进程崩溃**，Electron 窗口显示空白，需重新启动。
- **修复：** 写入前添加 `child.stdin.on('error', () => {});`。

#### C3. `autoBackupOnQuit` 无超时 → 应用退出卡住
- **文件：** `electron/main.js:465-481`
- **现象：** `fetch()` 到后端备份端点没有超时。后端崩溃或不响应时，`fetch` 挂起直到 OS TCP 超时（Windows 上约 2 分钟）。
- **开发者体验：** **每次退出应用时可能冻结**，需 Task Manager 强制结束。
- **修复：** `AbortController` + 8 秒超时，忽略超时错误。

#### C4. `stopBackend()` 7 秒后无条件清空引用 → 端口冲突
- **文件：** `electron/main.js:264-268`
- **现象：** 7 秒定时器无条件设置 `backendProcess = null`，即使进程仍在运行（`taskkill` 失败或 SIGKILL 被忽略）。
- **开发者体验：** 下次启动时 `startBackend()` 在已被占用的端口上 spawn 新进程，导致 `EADDRINUSE`，应用无法使用。
- **修复：** 清空引用前验证 `backendProcess.killed` 或轮询 `process.kill(pid, 0)`。

#### C5. `renderReview` 全量 innerHTML 重建 → 焦点/滚动丢失
- **文件：** `js/render-review.js:34`
- **现象：** 每次状态变更（AI 进度更新、自动保存、筛选器变化）都销毁并重建整个 DOM。
- **开发者体验：** **最核心的用户体验痛点**。在条款编辑器中打字时，AI 进度轮询每 2.5 秒返回一次，触发 `renderReview()`，**输入框失去焦点，打字中断**。长合同滚动后也会重置到顶部。
- **修复：** 捕获 `document.activeElement` 和 `scrollTop` 后恢复；长期应改为增量更新或虚拟 DOM。

#### C6. `saveState` 同步深克隆整个 state → 每次按键卡顿
- **文件：** `js/state.js:266`
- **现象：** `scheduleBackendSync(clone(nextState))` 使用 `JSON.parse(JSON.stringify(...))`。大合同时每次状态变更（包括按键）都克隆整个对象树。
- **开发者体验：** 在 50 页以上的合同中编辑条款，**每按一个键 UI 冻结 100-500ms**。
- **修复：** 移除 `saveState` 中的克隆；让 `scheduleBackendSync` 异步克隆或使用 `structuredClone` 离屏。

#### C7. localStorage 写入失败静默 swallow → 数据丢失
- **文件：** `js/state.js:250-256`
- **现象：** `writeLocalState` 用 `try/catch` 吞下所有错误。localStorage 配额（通常 5-10MB）超限后，写入静默失败。
- **开发者体验：** 所有编辑看起来都保存了，但**刷新页面后全部丢失**。
- **修复：** 表面化错误（toast + `console.error`）；大 payload 回退到 IndexedDB。

#### C8. 主线程阻塞的 DOCX 解析 → 上传大文件时 UI 冻结
- **文件：** `js/word-docx.js:120-149`, `js/word-docx.js:223-231`
- **现象：** `parseDocxBuffer` 同步解析 ZIP + 运行 `DOMParser` 处理大型 XML。
- **开发者体验：** 上传 100 页以上的 Word 文档时，**整个 UI 冻结数秒，无加载提示**。
- **修复：** 添加加载状态；长期应移至 Web Worker。

---

### 🟠 High — 频繁导致不稳定或明显卡顿

#### H1. `backendRestartCount` 永不重置 → 后端永久死亡
- **文件：** `electron/main.js:101, 219`
- **现象：** 后端崩溃 5 次后，`backendRestartCount > MAX_BACKEND_RESTARTS` 永久阻止所有重启尝试。即使后来资源恢复，也不再重启。
- **开发者体验：** 一次早期的临时资源问题（如端口被占）导致**应用永久无法连接后端**，必须重启。
- **修复：** 在 stdout 检测到 "listening" 时重置 `backendRestartCount = 0`。

#### H2. `cleanupAnalysisJobs` 标记超时但不杀进程
- **文件：** `server/jobs.js:84-105`
- **现象：** 60 秒清理间隔将超时的运行中作业标记为 `failed`，但不中止 `AbortController` 或调用 `terminateJobChild`。
- **开发者体验：** 与 C1 相同的僵尸进程问题，但由后台自动触发。
- **修复：** 标记超时前调用 `job.__controller.abort()` + `terminateJobChild(job)`。

#### H3. `runWithRetry` 重试所有错误 → 浪费配额和时间
- **文件：** `server/jobs.js:78-96`
- **现象：** API 密钥错误、401/403、ENOENT（缺失文件）、JSON 解析错误都被重试 2 次，延迟最高 14 秒。
- **开发者体验：** 配置错误的 API 密钥导致**每次分析多等 14 秒才报错**。
- **修复：** 白名单可重试错误（网络超时、5xx、ECONNRESET）；对认证错误和文件缺失立即失败。

#### H4. `readJson` 客户端断开时 Promise 永不解决 → 内存泄漏
- **文件：** `server/http-utils.js:109-128`
- **现象：** 只监听 `data`/`end`/`error`，未监听 `close`。客户端中断请求时，Promise 永远挂起。
- **开发者体验：** 长时间开发后，大量泄漏的 Promise 和请求上下文累积，后端内存缓慢增长。
- **修复：** 添加 `req.on('close', () => reject(...))`。

#### H5. `sendJson`/`sendStaticFile` 在关闭的 socket 上抛出未处理拒绝
- **文件：** `server/http-utils.js:80-87`, `server/http-utils.js:100-125`
- **现象：** 如果 socket 已关闭， catch 块再次调用 `sendJson`，`res.writeHead` 抛出 `ERR_HTTP_HEADERS_SENT`。
- **开发者体验：** 用户刷新或关闭浏览器时，后端可能产生**未处理的 Promise 拒绝**，极端情况下进程崩溃。
- **修复：** `sendJson`/`sendStaticFile` 顶部检查 `if (res.headersSent || res.writableEnded) return;`。

#### H6. 没有 `busy_timeout` → 外部工具访问数据库时后端崩溃
- **文件：** `server/store-sqlite.js:21`
- **现象：** `better-sqlite3` 默认 5000ms busy timeout，但代码未显式设置。开发者用 DB Browser 或 VS Code 扩展打开 `workbench.sqlite` 时，后端立即抛出 `SQLITE_BUSY`。
- **开发者体验：** **正常开发工作流（用外部工具查看数据库）导致后端崩溃**。
- **修复：** `new Database(DB_PATH, { timeout: 5000 })`。

#### H7. 没有优雅关闭 → Ctrl+C 孤儿进程 + WAL 膨胀
- **文件：** `server/server.js:32-34`, `server/store-sqlite.js:24`
- **现象：** 没有 `SIGINT`/`SIGTERM` 处理器。Ctrl+C 时，HTTP 服务器不等待请求完成，SQLite 连接不关闭，WAL 不检查点。
- **开发者体验：** 频繁的 Ctrl+C 导致 WAL 文件膨胀，读写性能逐渐下降；AI 子进程成为孤儿进程。
- **修复：** `process.on('SIGINT', () => { server.close(); cancelAllJobs(); db.close(); process.exit(0); })`。

#### H8. `/api/db/sync` 无并发保护 → 双重同步冻结 UI
- **文件：** `server/routes/api.js:310-318`
- **现象：** `replaceDb` 是同步的、破坏性的（DELETE all → re-INSERT）。前端快速编辑触发多次同步时，请求会堆积。
- **开发者体验：** 快速编辑合同时，UI **冻结数秒**。
- **修复：** 添加 `isSyncing` 标志或队列化同步请求。

#### H9. AI 审核完成后合同切换的竞态条件
- **文件：** `js/app-contract-actions.js:80`, `js/app-contract-actions.js:107`
- **现象：** `runLegalSkillAnalysis()` 的 `await` 前后调用 `renderReview()`，不检查用户是否已切换合同。
- **开发者体验：** 合同 A 的分析完成后，如果用户已切换到合同 B，UI **突然跳回合同 A 的结果**。
- **修复：** 每个 `await` 后检查 `if (state.activeContractId !== contract.id) return;`。

#### H10. `uploadedFileCache` 无界 → 内存泄漏直到标签页崩溃
- **文件：** `js/state.js:3`, `js/word-docx.js:484-495`
- **现象：** 模块级 `Map` 没有驱逐策略。上传多个/大 DOCX 文件后，内存持续增长。
- **开发者体验：** 连续上传多份大合同后，**浏览器标签页因 OOM 崩溃**。
- **修复：** LRU 驱逐（最多 20 个条目）或上传处理后清除缓存。

#### H11. 生产环境没有渲染器崩溃恢复
- **文件：** `electron/main.js:297-308`
- **现象：** `render-process-gone` 和 `crashed` 处理器只在 `isTest` 为 true 时注册。
- **开发者体验：** 渲染器 OOM 或 V8 致命错误时，**窗口保持可见但空白/无响应**，必须 Task Manager 强制结束。
- **修复：** 始终注册崩溃处理器；崩溃时显示对话框并重新加载/重建窗口。

#### H12. `stopBackend()` 移除 close 监听器 → 引用永不清空
- **文件：** `electron/main.js:235`
- **现象：** `stopBackend()` 调用 `backendProcess.removeAllListeners("close")`，导致原始 close 处理器（负责设置 `backendProcess = null`）被移除。
- **开发者体验：** `startBackend()` 在 `backendProcess` 仍为真时提前返回，**后端永不重启**。
- **修复：** 用 `isStopping` 标志替代 `removeAllListeners`。

#### H13. `applySelectedRuntimeProfile` 全局修改 `process.env`
- **文件：** `electron/main.js:106-148`, `scripts/portable-runtime.js:73-104`
- **现象：** `Object.assign(process.env, env)` 直接修改全局环境变量。如果 `configureRunnerProfile()` 抛出异常，恢复代码永不执行。
- **开发者体验：** 一次运行时配置错误导致**全局环境永久污染**，可能影响文件对话框、网络请求或其他子进程。
- **修复：** 不修改 `process.env`，只修改传递给子进程的 `env` 对象。

#### H14. 每次调用同步重新读取 `config.toml`/`SKILL.md`
- **文件：** `scripts/ai-runner-lib.js:51-64`, `server/legal-skill-adapter.js:155-156`
- **现象：** `readCodexConfig` 每次 `getProviderStatus()` 都解析 `~/.codex/config.toml`；`buildRunnerPayload` 每次分析都读取 `SKILL.md`。
- **开发者体验：** 状态端点频繁调用时，不必要的同步 I/O 阻塞事件循环，响应延迟。
- **修复：** 缓存解析后的配置和 skill 内容；按 `mtime` 或 60 秒间隔失效。

---

### 🟡 Medium — 累积性问题或特定场景下的痛点

#### M1. `sendStaticFile` 加载整个文件到内存
- **文件：** `server/http-utils.js:100-125`
- **现象：** `fs.readFile(resolved, (error, content) => { res.end(content); })` 缓冲整个文件。
- **影响：** 下载大附件（DOCX/PDF）时内存飙升。
- **修复：** 使用 `fs.createReadStream(file.path).pipe(res)`。

#### M2. `replaceDb` 中重复的文件清理函数
- **文件：** `server/store-sqlite.js:634-651`, `server/store-sqlite.js:795`
- **现象：** `pruneOrphanedFiles` 和 `removeArchivedFilesForSnapshot` 函数体完全相同，`replaceDb` 中先后调用两者。
- **影响：** 同步 I/O 双倍执行，同步期间阻塞事件循环。
- **修复：** 移除 `replaceDb` 中的 `removeArchivedFilesForSnapshot` 调用，只保留 `pruneOrphanedFiles`。

#### M3. 启动时双重渲染
- **文件：** `js/app.js:22-25`
- **现象：** `render()` 立即运行一次，后端 hydration 后再运行一次。
- **影响：** 启动时短暂布局闪烁/冗余工作。
- **修复：** 首次渲染延迟到 hydration 完成后，或添加脏检查。

#### M4. `createWindow()` 允许重复主窗口
- **文件：** `electron/main.js:272-326`
- **现象：** 不检查 `mainWindow` 是否已存在。快速托盘点击或 activate 事件可创建多个 `BrowserWindow`。
- **影响：** 之前的窗口在内存中孤立，只有最后一个引用被保存。
- **修复：** `if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); return; }`

#### M5. `buildRedlineDraft` 每次激活卡片都计算整个合同
- **文件：** `js/render-review.js:840`
- **现象：** 单一条款卡片激活时，为所有条款运行 `buildRedlineDraft(...)`。
- **影响：** 大合同中每次点击条款都有明显延迟。
- **修复：** 按 `sourceKey` 缓存，只在条款动作变化时失效。

#### M6. 滚动 handler 中昂贵的 DOM 查询
- **文件：** `js/render-review.js:1216`, `js/render-review.js:1165`
- **现象：** `querySelectorAll` 在 rAF 节流的滚动 handler 中运行。
- **影响：** 大合同滚动卡顿。
- **修复：** 渲染间缓存节点列表，或使用 `IntersectionObserver`。

#### M7. `compact` 截断合同末尾
- **文件：** `scripts/ai-runner-lib.js:346-364`
- **现象：** `compact` 保留文本开头，截断尾部。合同的关键条款（责任上限、管辖权、终止）通常在末尾。
- **影响：** AI 分析前 silently 丢失关键条款。
- **修复：** 从中间截断，保留头+尾；或使用语义分块。

#### M8. 分析缓存和作业存储没有内存上限
- **文件：** `server/analysis-cache.js:70-88`, `server/jobs.js:19`, `server/jobs.js:48-52`
- **现象：** `AnalysisCache` 限制条目数（100）但不限制大小。单个大合同结果可达 10MB+。
- **影响：**  heavy session 期间内存增长到数百 MB。
- **修复：** 添加估计内存上限（如 100MB），按大小驱逐。

#### M9. `runAutoBackup` 无并发保护
- **文件：** `server/routes/api.js:131-138`
- **现象：** 时间戳精度为 1 秒，快速点击可并发执行。
- **影响：** 竞态条件，备份产物不完整。
- **修复：** `isBackingUp` 标志，并发请求返回 409。

#### M10. `scheduleBackendSync` 每次按键都触发 → 网络泛滥
- **文件：** `js/state.js:266`, `js/api.js:642-645`
- **现象：** `BACKEND_SYNC_DELAY_MS = 700ms`，每次 `saveState` 都触发同步。快速打字时每秒触发多次完整 state POST。
- **影响：** 网络拥堵 + 后端频繁执行 `replaceDb`。
- **修复：** 将 `scheduleBackendSync` 的防抖时间增加到 2-3 秒。

#### M11. `diffResult.slice(0, 200)` 后原始大数组仍被引用
- **文件：** `server/jobs.js:142-173`
- **现象：** `slice` 创建新数组，但闭包中的 `diffResult` 变量仍引用原始大数组，直到作业清理。
- **影响：** 大合同 diff 的临时内存膨胀。
- **修复：** `diffResult = diffResult.slice(0, 200);` 再附加到作业。

#### M12. `spawnSync` 探测阻塞事件循环
- **文件：** `scripts/ai-runner-lib.js:118-163`
- **现象：** `inspectCodexCommand` 使用 `spawnSync`（8 秒超时），可能循环多个候选命令。
- **影响：** 每次状态检查阻塞事件循环数十秒。
- **修复：** 缓存解析状态 30-60 秒；使用异步 `spawn` 后台刷新。

---

### 🟢 Low — 边缘情况或轻微不便

#### L1. 没有 `server.on('error')` 处理器
- **文件：** `server/server.js:32`
- **现象：** 端口被占用时抛出未处理的异常。
- **影响：** 开发重启时混乱的堆栈跟踪。

#### L2. Word 导出无加载状态
- **文件：** `js/word-docx.js:599-691`
- **现象：** `buildDocxRedlinePackage` 同步且大型，点击导出时 UI 冻结无反馈。

#### L3. 静默备份失败
- **文件：** `electron/main.js:475-479`
- **现象：** 退出时备份失败只记录日志，不提示用户。

#### L4. `findAvailablePort` 递归风险
- **文件：** `electron/main.js:64-79`
- **现象：** 端口范围被大量占用时深度递归。

#### L5. JSON 解析错误不包含原始输出
- **文件：** `server/utils.js:5-17`
- **现象：** AI 输出混乱时，错误消息不显示 runner 实际输出了什么。

#### L6. 全局命名空间污染
- **文件：** `js/render-review.js:555`
- **现象：** `window.currentReviewPlacementContext = { ... }` 可能与其他脚本冲突。

---

## 三、问题分类统计

| 级别 | 数量 | 主要影响 |
|------|------|---------|
| 🔴 Critical | 8 | 崩溃、僵尸进程、数据丢失、每日使用受阻 |
| 🟠 High | 14 | 频繁不稳定、明显卡顿、性能劣化 |
| 🟡 Medium | 12 | 累积性问题、特定场景痛点 |
| 🟢 Low | 6 | 边缘情况、轻微不便 |
| **总计** | **40** | |

---

## 四、开发者日常体验影响映射

| 日常操作 | 遇到的问题 | 严重程度 |
|---------|-----------|---------|
| **打开应用** | 双重渲染闪烁；启动时未处理的后端拒绝 | Medium |
| **上传 Word 合同** | 主线程冻结无加载状态；损坏文件静默失败；无界缓存导致 OOM | Critical/High |
| **编辑条款文本** | 每次按键触发深克隆卡顿 100-500ms；innerHTML 重建丢失焦点；后端同步泛滥网络 | Critical |
| **滚动长合同** | innerHTML 重建丢失滚动位置；滚动 handler 中 querySelectorAll 卡顿 | Critical/Medium |
| **运行 AI 分析** | withTimeout 不杀进程 → 僵尸进程；重试所有错误 → 多等 14 秒；合同切换竞态 | Critical/High |
| **切换合同** | AI 完成回调渲染错误合同；状态残留显示错误分析状态 | High |
| **导出 Word** | 同步构建冻结 UI 无反馈 | Low |
| **退出应用** | autoBackup 无超时 → 冻结；stopBackend 不等待 → 孤儿进程；不重置重启计数 → 下次无法启动 | Critical/High |
| **用外部工具查看数据库** | 无 busy_timeout → 后端崩溃 | High |
| **频繁 Ctrl+C 重启后端** | 无优雅关闭 → WAL 膨胀 + 孤儿进程 | High |

---

## 五、修复优先级建议（开发者自用视角）

### P0 — 立即修复（影响每日使用，工作量小）

| # | 问题 | 工作量 | 收益 |
|---|------|--------|------|
| 1 | `child.stdin` 错误处理 (C2) | 1 行 × 4 文件 | **防止后端崩溃** |
| 2 | `withTimeout` + `cleanupAnalysisJobs` 超时杀进程 (C1) | ~10 行 | **防止僵尸进程和队列阻塞** |
| 3 | `sendJson`/`sendStaticFile` 关闭 socket 保护 (H5) | ~3 行 × 2 函数 | **防止未处理拒绝** |
| 4 | `readJson` 客户端断开处理 (H4) | 1 行 | **防止内存泄漏** |
| 5 | `busy_timeout` (H6) | 1 行 | **防止外部工具导致崩溃** |
| 6 | `autoBackupOnQuit` 超时 (C3) | ~5 行 | **防止退出冻结** |

### P1 — 短期修复（显著改善体验，工作量中等）

| # | 问题 | 工作量 | 收益 |
|---|------|--------|------|
| 7 | `renderReview` 保留焦点/滚动 (C5) | ~15 行 | **解决最痛的 UI 问题** |
| 8 | `saveState` 移除同步克隆 (C6) | ~5 行 | **消除按键卡顿** |
| 9 | `backendRestartCount` 重置 (H1) | 2 行 | **防止后端永久死亡** |
| 10 | `stopBackend()` 等待进程死亡 (C4) | ~10 行 | **防止端口冲突** |
| 11 | `runWithRetry` 白名单可重试错误 (H3) | ~10 行 | **节省时间和配额** |
| 12 | 优雅关闭 (H7) | ~10 行 | **防止孤儿进程和 WAL 膨胀** |
| 13 | 渲染器崩溃恢复 (H11) | ~10 行 | **防止空白窗口** |

### P2 — 中期修复（架构改进，工作量大）

| # | 问题 | 工作量 | 收益 |
|---|------|--------|------|
| 14 | `renderReview` 增量更新 | 大 | **根本性解决渲染性能** |
| 15 | DOCX 解析移至 Web Worker | 中 | **消除大文件上传冻结** |
| 16 | localStorage → IndexedDB 回退 | 中 | **防止大数据丢失** |
| 17 | `process.env` 不全局修改 | 中 | **防止环境交叉污染** |
| 18 | 缓存/作业存储内存上限 | 中 | **防止长期内存泄漏** |

### P3 — 可搁置（开发者自用影响小）

- 递归端口扫描 (L4)
- 静默备份失败 (L3)
- 全局命名空间污染 (L6)
- JSON 解析错误不包含原始输出 (L5)
- 启动时双重渲染 (M3)

---

## 六、总体评估

**当前代码状态：** 核心功能已稳固（4 CRITICAL 已修复），但**开发者日常使用的稳定性和用户体验存在大量明显痛点**。

**最严重的三个问题：**
1. **`renderReview` 全量 innerHTML 重建** — 每次 AI 进度更新都打断用户输入，是最影响日常使用体验的问题
2. **`withTimeout` 不杀子进程 + `child.stdin` 未处理错误** — 导致僵尸进程积累和后端崩溃
3. **`saveState` 同步深克隆** — 大合同时每次按键都卡顿

**建议：** 先集中完成 P0 的 6 个小修复（总计约 30 行代码），可立即消除崩溃、冻结和泄漏风险；然后投入 P1 的 7 个修复，显著改善日常交互流畅度。P2 的架构改进可分批逐步实施。
