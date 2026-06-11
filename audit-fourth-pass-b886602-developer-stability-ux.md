# 全面审查报告 (b886602) — 开发者本地使用稳定性与用户体验

> 审计日期：2026-06-11
> 审计范围：最新 commit `b886602` (fix: third audit pass — developer stability, UX and workflow fixes)
> 审计方式：人工深度走读 + 并行子代理探索（前端架构、后端稳定性、Electron/脚本层、测试层）+ 历史审计对比
> 视角：开发者个人本地使用，重点关注**日常崩溃、卡顿、数据丢失、进程泄漏、开发效率**等影响实际使用体验的问题

---

## 一、与历史审计的对比说明

本项目在 2026-06-09 至 2026-06-11 期间经历了三轮密集修复（`d4646aa` → `d353bbc` → `f3bed86` → `b886602`），大量 Critical/High 问题已闭环。本报告**不再重复列举已确认修复的问题**，只聚焦于当前代码中**仍然残留或新发现**的影响开发者日常使用的痛点。

已确认修复的关键问题包括：
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
- `captureRenderState` JSON.stringify 卡顿 → **已改为 O(1) identity hash**
- `saveAnalysisJob` 反复序列化大合同 → **已剥离 `contract_text`/`previous_text`**
- `MutationObserver` 永久运行 → **已加 disconnect + debounce**
- `stopBackend` removeAllListeners → **已改为 `isStoppingBackend` 标志（但引入了新 Critical 问题，见本轮 C5）**
- `asar: false` 暴露源码 → **已改为 `asar: true`**
- TimerRegistry 集中管理 → **已实现并替换核心 timer**
- CSRF 防护 → **已加 `X-Requested-With` header**
- `uploadedFileCache` 无界增长 → **已加 LRU (MAX_UPLOADED_FILE_CACHE = 10)**
- `rebuildSearchIndex` 失败无状态标记 → **已写入 `searchIndexStatus`**
- `incrementalSync` 事务保护 → **已使用 `runInTransaction()`**
- `unhandledRejection` 只记录不退出 → **已加 `process.exit(1)`（但方式粗暴，见本轮 H3）**

---

## 二、上一轮审计残留问题验证

| 上一轮问题 | 实际状态 | 说明 |
|-----------|---------|------|
| **C1: logger 未定义** | ❌ **仍未修复** | `store-sqlite.js:701` 仍调用 `logger.error()`，无 import |
| **C2: write() 同步抛错** | ✅ 已修复 | `base-adapter.js:88-93` 已加 try/catch |
| **C3: safeJson 循环引用** | ✅ 已修复 | `store-sqlite.js:352-363` 已用 WeakSet 处理 |
| **C4: overrides 乱码文件** | ✅ 已修复 | 文件已删除，`index.html:283` 有注释 |
| **H1: replaceDb 同步阻塞** | ❌ **仍未修复** | 仍是同步全量 DELETE + INSERT |
| **H2: saveAnalysisJob 大文本** | ✅ 已修复 | 已剥离 `contract_text`/`previous_text`/`text`/`clauses` |
| **H3: captureRenderState stringify** | ✅ 已修复 | 已改用 lightweight O(1) hash |
| **H4: MutationObserver 泄漏** | ✅ 已修复 | 已有 disconnect + visibilitychange |
| **H5: unhandledRejection 不退出** | ✅ 已修复 | 已加 `process.exit(1)`，但方式过于粗暴（见本轮 H3） |
| **H6: readJson 150MB** | ✅ 已修复 | 已从 150MB 降至 20MB |
| **H7: stopBackend 引用泄漏** | ⚠️ 部分修复 | 已用 `isStoppingBackend` 标志替代 removeAllListeners，但引入了新 Critical 问题（见本轮 C5） |
| **M1: Kimi 分块并发强制为1** | ✅ 已修复 | 默认改为 2，支持 `LEGAL_WORKBENCH_KIMI_CHUNK_CONCURRENCY` 覆盖 |
| **M2: uploadedFileCache 无界** | ✅ 已修复 | `word-docx.js:540` MAX_UPLOADED_FILE_CACHE = 10，有 LRU |
| **M3: rebuildSearchIndex 无状态** | ✅ 已修复 | 失败时写入 `searchIndexStatus = failed` |
| **M4: incrementalSync 无事务** | ✅ 已修复 | `system.js:114-155` 已包裹 `runInTransaction()` |
| **M5: buildCostMetadata 硬编码汇率** | ⚠️ 部分修复 | 已有 env 覆盖 `LEGAL_WORKBENCH_COST_RATE_PER_1K`，但模型区分仍不足 |
| **M6: 全局事件监听器永不移除** | ✅ 设计如此 | SPA 需要全局监听，TimerRegistry 已管理核心 timer |
| **M7: E2E 硬编码 Chrome 路径** | ❌ **仍未修复** | `scripts/manual-flow-check.js` 和 `scripts/test-layer3-frontend-e2e.js` 仍有硬编码路径 |

---

## 三、核心问题汇总（当前残留 + 新发现）

### 🔴 Critical — 会导致崩溃、测试阻塞、进程泄漏或每日使用受阻

#### C1. `pruneOrphanedFiles` 引用未定义的 `logger` → 进程硬崩溃（上一轮残留）
- **文件：** `server/store-sqlite.js:701`
- **现象：** 该文件顶部没有 `const logger = require("../scripts/logger");`，但 `pruneOrphanedFiles` 函数中直接调用 `logger.error(...)`。
- **触发条件：** 当数据库中存在 `file_path` 指向 `WORKBENCH_ROOT` 外部的记录时（例如手动迁移过数据、备份恢复后路径不一致），`isPathInsideRoot` 返回 false，进入 `logger.error` 分支。
- **开发者体验：** 后端进程直接抛出 `ReferenceError: logger is not defined`，成为未捕获异常，触发 `uncaughtException` → `gracefulShutdown` → `process.exit(1)`。Electron 检测到后端退出会尝试重启，若该条件持续存在，后端陷入**无限崩溃重启循环**（5 次后永久停止）。
- **修复：** `const logger = require("../scripts/logger");` 加到 `server/store-sqlite.js` 顶部。**仅需 1 行。**

#### C2. `test-legal-skill-pure.js` 的 `execFileSync` 无 timeout → 触发 `spawnSync ETIMEDOUT`
- **文件：** `tests/test-legal-skill-pure.js:14-21`、`tests/test-runner.js:80-84`
- **现象：** `runInFreshEnv()` 使用 `execFileSync` 启动子进程，**没有 `timeout` 参数**。而 `test-runner.js` 用 `spawnSync(..., { timeout: 120000 })` 调用 `test-legal-skill-pure.js`。当 `test-legal-skill-pure.js` 内部某个 `execFileSync` 卡死，整个测试文件运行超过 120s，`test-runner.js` 的 `spawnSync` 触发 `ETIMEDOUT`。
- **触发条件：** Windows 上进程启动开销大；机器负载高时 chunked analysis 测试处理 225 个条款需要较长时间。
- **开发者体验：** 运行 `npm test` 时 `test-legal-skill-pure.js` 不定期报 `ETIMEDOUT`，失败信息只显示"Timed out"，无法定位具体是哪个子测试卡死，调试成本极高。
- **修复：** 给 `runInFreshEnv` 的 `execFileSync` 增加 `timeout: 30000`。

#### C3. `test-legal-skill-pure.js` 的 `Promise.all(asyncTests)` 未处理 reject → 测试挂起
- **文件：** `tests/test-legal-skill-pure.js:450`
- **现象：** 第450行 `Promise.all(asyncTests).then(() => summary());` 没有 `.catch()`。如果 `asyncTests` 中的某个 Promise reject，`Promise.all` 立即 reject，`summary()` 永远不会执行，`process.exit(1)` 永远不会被调用。
- **触发条件：** `analyzeLegalReview` 抛异常未被正确捕获时。
- **开发者体验：** 测试进程"静默挂起"，不输出结果也不退出。`test-runner.js` 等待 120s 后 `ETIMEDOUT`，开发者完全不知道问题出在哪里。
- **修复：** 改为 `Promise.all(asyncTests).then(() => summary()).catch((e) => { console.error(e); process.exit(1); });`

#### C4. `pollLegalSkillJob` AbortController 存在严重 race condition（新发现）
- **文件：** `js/api/core.js:203-226`
- **现象：** `finally` 块中无条件执行 `pollControllers.delete(jobId)`。当同一 `jobId` 的旧任务因超时/异常进入 `finally` 时，如果新任务已经设置了新的 controller，旧任务会把新任务的 controller 误删。
- **触发条件：** 用户快速点击"运行 AI Legal Skill"重试、旧任务超时后自动重试、或 `cancelPollJob` 与新建任务竞态。
- **开发者体验：** 新任务无法被正确取消；`cancelPollJob` 对已重试的任务完全失效；可能导致同一合同被重复分析，消耗双倍 token 和 CPU。
- **修复：** 在 `finally` 中仅当当前 map 中的 controller 仍是本任务创建的那个时才删除：
  ```javascript
  finally {
    if (pollControllers.get(jobId) === controller) {
      pollControllers.delete(jobId);
    }
  }
  ```

#### C5. `stopBackend` 期间后端被意外重启 → 应用退出时进程泄漏（新发现，上一轮修复引入）
- **文件：** `electron/main.js:220-228`
- **现象：** 上一轮修复将 `removeAllListeners("close")` 移除，让 `close` handler 能正常清理 `backendProcess = null`。但 `close` handler 中没有检查 `isStoppingBackend` 标志，导致 **stop 与 restart 直接冲突**。
- **触发条件：** 用户关闭应用、调用 `quitApp()` 或执行 `stopBackend()` 时，后端子进程 exit code 非零（Windows 上 SIGTERM 通常 exit code = 1），`close` handler 触发 `tryRestartBackend()`。
- **开发者体验：** 用户点击退出后，Electron 主进程退出，但后端 Node 进程被重新拉起并变成孤儿进程；Windows 任务管理器中残留 `AI合同审阅工作台.exe` 或 `electron.exe` 进程；重复开关应用可能导致端口占用冲突。
- **修复：** 在 `close` handler 中增加停止状态守卫：
  ```javascript
  backendProcess.on("close", (code) => {
    backendProcess = null;
    backendReady = false;
    if (isStoppingBackend) return;  // 新增
    if (code !== 0 && code !== null) {
      tryRestartBackend();
    }
  });
  ```

#### C6. `asar` 打包模式下后端脚本路径未验证 unpacked 目录（新发现）
- **文件：** `electron/main.js:156-158`、`package.json:61-64`
- **现象：** `package.json` 将 `asar` 改为 `true`，但 `asarUnpack` 仅包含 `better-sqlite3` 的 `.node`/`.dll` 文件。`electron/main.js` 中的生产环境脚本路径直接指向 `app/server/server.js`，未考虑 `app.asar.unpacked` 回退。
- **触发条件：** 运行 `npm run build:win` 生成安装包后首次启动。当 Electron 以 `ELECTRON_RUN_AS_NODE=1` 模式 spawn 子进程时，子进程对 asar 内文件的读取能力存在平台/版本差异。
- **开发者体验：** 打包后的生产应用可能无法启动后端，前端永远停留在"正在启动后端服务…"转圈页面；`fs.existsSync(serverScript)` 在 Electron 下对 asar 路径会返回 `true`，错误不会触发启动失败对话框，而是直接在子进程中崩溃并进入重启循环。
- **修复：** 将 `server` 目录加入 `asarUnpack`，并在 `main.js` 中优先检测 unpacked 路径：
  ```json
  "asarUnpack": [
    "node_modules/better-sqlite3/**/*.{node,dll,so,dylib}",
    "server/**/*"
  ]
  ```
  ```javascript
  const unpackedScript = path.join(process.resourcesPath, "app.asar.unpacked", "server", "server.js");
  const serverScript = (!isDev && fs.existsSync(unpackedScript))
    ? unpackedScript
    : path.join(__dirname, "..", "server", "server.js");
  ```

#### C7. `Store.mutate()` 全量深克隆导致性能灾难（新发现）
- **文件：** `js/store.js:11-39`
- **现象：** 每次 `mutate` 都执行 `const prevState = deepClone(state)`，而 `deepClone` 实际是 `JSON.parse(JSON.stringify(state))`。当内存中的 state 包含多份长合同文本时，单次克隆即可阻塞主线程数十至数百毫秒。
- **触发条件：** state 膨胀后（>5 份合同或单份 >5 万字）的任何 `Store.mutate` 调用。最致命的是在 `handleClauseEditInput` 中，**每次键盘输入都会触发一次 `Store.mutate("draft-clause-text-edit", ...)`**，导致打字严重卡顿。
- **开发者体验：** 审阅长合同时，条款编辑区的输入延迟极高；频繁 GC 可能导致界面掉帧。
- **修复建议：**
  - 对只修改顶层指针的 mutate（如 `activeWorkbenchClauseId`）取消全量深克隆，改用按需路径克隆（structural sharing）。
  - 或至少对 `save: false` 的 mutate 跳过快照/回滚机制。

---

### 🟠 High — 频繁导致不稳定、卡顿或明显降低开发效率

#### H1. `replaceDb` 同步全量替换 → 后端事件循环阻塞数秒（上一轮残留）
- **文件：** `server/store-sqlite.js:721-943`
- **现象：** `replaceDb` 是同步函数，内部执行 `BEGIN IMMEDIATE` → `DELETE FROM` 所有结构化表 → 逐行 `INSERT` 整个前端 state。`better-sqlite3` 是同步 API，大合同时整个操作在事件循环主线程上运行。
- **触发条件：** 合同库规模达到 50+ 合同、数百条款时，全量同步（前端首次加载或手动强制同步）会卡住数秒。
- **开发者体验：** 所有并发 HTTP 请求挂起；Electron 主进程 UI 冻结（白屏/无响应）；AI 分析子进程心跳超时可能被误判为失败。
- **修复方向：** 将 `replaceDb` 改为 async，内部 INSERT 分批并用 `setImmediate` 让出事件循环；或优先推广 `incrementalSync`。

#### H2. `server.js:85-90` — `unhandledRejection` 直接 `process.exit(1)`，无优雅关闭（上一轮修复不彻底）
- **文件：** `server/server.js:85-90`
- **现象：** 上一轮修复将 `unhandledRejection` 从"只记录不退出"改为直接 `process.exit(1)`。**但这不是 `gracefulShutdown`**。正在运行的 AI 分析子进程被强制杀死，SQLite WAL 未 checkpoint。
- **触发条件：** 任何未捕获的 Promise 拒绝（如 AI runner 返回非 JSON 时内部解析异常、网络请求超时后未正确处理）。
- **开发者体验：** 正在审阅的长合同任务数据丢失；SQLite WAL 文件膨胀甚至损坏；Electron 进程异常退出，用户看到"应用闪退"。
- **修复建议：** 改为 `gracefulShutdown("unhandledRejection")`；或至少设置 `process.exitCode = 1` 让当前任务结束后退出，而非立即杀死。

#### H3. `playwright.config.js` 的 `channel: "chromium"` 是误导性配置
- **文件：** `playwright.config.js:18`
- **现象：** 配置中写了 `channel: "chromium"`，注释说"Use the already-downloaded Chromium"。但 Playwright 的 `channel` 配置**不会**自动下载浏览器，它要求系统已安装 Chrome/Edge/Chromium。
- **触发条件：** 在干净的 CI 环境、macOS（无 Chrome）、Linux 服务器或 Docker 容器中运行 `npx playwright test`。
- **开发者体验：** 新环境/CI 上 E2E 测试直接报错 `browserType.launch: Executable doesn't exist`，开发者需要手动安装 Chrome 或修改配置。
- **修复建议：** 移除 `channel: "chromium"`，让 Playwright 使用自带的 Chromium。

#### H4. `data-open-contract` 选择器歧义 → E2E 测试不可靠
- **文件：** `js/dashboard.js`、`js/contract-library.js`、`tests/test-e2e-*.spec.js`
- **现象：** Dashboard 页面上有**3种**不同功能但都带有 `data-open-contract` 的元素（active contract 卡片、全局搜索结果、待反馈合同列表）。E2E 测试使用 `[data-open-contract].first()`，选中的不一定是预期的按钮。
- **触发条件：** Dashboard 上同时存在多个 `data-open-contract` 元素时。
- **开发者体验：** E2E 测试不定期失败，错误表现是"点击后未触发视图切换"或"选中的不是预期的 demo contract"。
- **修复建议：** 给 active contract 按钮添加专用属性如 `data-active-contract-open`；或 E2E 测试改用更精确的选择器。

#### H5. E2E 脚本硬编码 Windows Chrome 路径（上一轮残留）
- **文件：** `scripts/manual-flow-check.js:9-14`、`scripts/test-layer3-frontend-e2e.js:13-18`
- **现象：** 只查找固定的 Windows Chrome/Edge 路径，没有 macOS/Linux 路径，也没有优先使用 Playwright 自带的 Chromium。
- **触发条件：** 在 macOS、Linux CI 或 Windows 上 Chrome 安装在其他位置时。
- **开发者体验：** 跨平台开发者和 CI 环境无法运行完整 E2E 验证。
- **修复建议：** 默认使用 `chromium.launch()` 不指定 `executablePath`，允许通过环境变量覆盖。

#### H6. `replaceDb` COMMIT 后错误导致"成功却报错"状态不一致
- **文件：** `server/store-sqlite.js:940-950`
- **现象：** `replaceDb` 在第 940 行 `COMMIT` 后，继续执行 `pruneOrphanedFiles`（第 948 行）和 `rebuildSearchIndex`（第 950 行）。若这两个函数失败，`replaceDb` 抛出异常，但**事务已提交**。
- **触发条件：** `pruneOrphanedFiles` 的 logger 崩溃（C1）、或 `rebuildSearchIndex` 因 FTS5 损坏失败。
- **开发者体验：** 前端收到 500 错误，用户点击重试，导致数据重复插入或冲突；开发者查看数据库发现数据实际已写入，前后端状态严重不一致。
- **修复建议：** 将 `pruneOrphanedFiles` 和 `rebuildSearchIndex` 移入事务内；或改为"事务成功则必定成功"的幂等操作。

#### H7. `delay()` timer 不受 TimerRegistry 管理，取消时泄漏（新发现）
- **文件：** `js/api/core.js:425-427`
- **现象：** `delay(ms)` 使用裸 `setTimeout`，未接入 `TimerRegistry`。`pollLegalSkillJob` 被 abort 后，当前正在等待的 `delay(POLL_INTERVAL_MS)` timer 不会被提前清理，必须等到 2500ms 到期后才能释放。
- **触发条件：** 频繁取消/重启 Legal Skill 分析。
- **开发者体验：** 大量并发的过期 timer 会堆积，在反复重试场景下造成内存和 timer 池压力。
- **修复建议：** 让 `delay` 支持 `AbortSignal`：
  ```javascript
  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (signal) signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Cancelled")); }, { once: true });
    });
  }
  ```

#### H8. `renderReview` focus 恢复导致 scroll 位置跳跃（新发现）
- **文件：** `js/render-review.js:107-119`
- **现象：** 代码先恢复 `scrollTop`，再执行 `restored.focus()`。但 `focus()` 可能触发浏览器的自动滚动行为，从而覆盖刚刚恢复的 `scrollTop`。
- **触发条件：** 被恢复 focus 的元素位于当前 `scrollTop` 对应位置下方较远时。
- **开发者体验：** re-render 后用户的阅读位置发生非预期跳跃，需要手动滚回原来的位置，严重中断审阅流。
- **修复建议：** 使用 `restored.focus({ preventScroll: true })` 先恢复焦点和选区，最后再设置 `views.review.scrollTop = scrollTop`。

#### H9. `buildIncrementalPayload` 使用 JSON.stringify 深比较，阻塞主线程（新发现）
- **文件：** `js/api/core.js:704-714`
- **现象：** 每次 backend sync 前执行 `JSON.stringify(currentStripped) === JSON.stringify(lastStripped)`。state 越大，字符串化开销越高。
- **触发条件：** 每次用户操作后 2.5s 触发的 `flushBackendSync`。
- **开发者体验：** 在编辑长合同时，后台同步前的深比较会造成可感知的周期性强卡顿。
- **修复建议：** 引入 `stateGeneration` 计数器或 `dirtyFlags`，backend sync 直接检查 flag 而非深比较。

#### H10. `stopBackend` 中 PID 回收导致 stop 假成功（新发现）
- **文件：** `electron/main.js:288-297`
- **现象：** `stopBackend()` 使用 `process.kill(pid, 0)` 轮询检测进程存活。若操作系统在进程退出后快速回收 PID 分配给新进程，`process.kill` 不会抛出 `ESRCH`，`checkInterval` 将持续等待直到 8 秒超时。
- **触发条件：** 系统高负载下频繁启停后端，PID 空间快速周转。
- **开发者体验：** `quitApp()` 被阻塞 8 秒，用户感觉应用"卡住"。
- **修复建议：** 增加 `backendProcess === null` 作为快速退出条件（`close` 事件处理程序会在进程真正退出时设置）。

#### H11. `asarUnpack` 缺少跨平台 native module 文件类型（新发现）
- **文件：** `package.json:61-64`
- **现象：** `asarUnpack` 仅匹配 `**/*.node` 和 `**/*.dll`，未包含 Linux 的 `.so` 和 macOS 的 `.dylib`。
- **触发条件：** 在 Linux 或 macOS 上执行 `electron-builder` 打包。
- **开发者体验：** 跨平台构建时，better-sqlite3 的 native 依赖无法从 asar 中正确加载，导致后端启动失败。
- **修复建议：**
  ```json
  "asarUnpack": [
    "node_modules/better-sqlite3/**/*.{node,dll,so,dylib}",
    "server/**/*"
  ]
  ```

#### H12. Reader filter 输入无 debounce，高频触发全量 DOM 重建（新发现）
- **文件：** `js/events-document.js:37-57`
- **现象：** `reader-clause-search` 的 `input` 事件直接调用 `renderReview()`。用户每输入一个汉字（拼音输入法过程中可能触发多次 input），都会触发一次全量 `innerHTML` 重建。
- **触发条件：** 在搜索框中快速输入长关键词。
- **开发者体验：** 搜索体验极其卡顿，低端设备上甚至可能出现输入丢失。
- **修复建议：** 添加 150-300ms debounce：
  ```javascript
  TimerRegistry.set("reader-filter-debounce", setTimeout(() => renderReview(), 200));
  ```

#### H13. `legal-review/jobs` 错误处理未脱敏
- **文件：** `server/routes/handlers/legal-review.js:23-24`
- **现象：** `POST /api/legal-review/jobs` 的 catch 块直接返回 `error.message || String(error)`，**没有使用 `serverErrorPayload`**。而同一文件中 `POST /api/legal-review` 是正确使用了 `serverErrorPayload` 的。
- **触发条件：** 创建分析 job 时发生任何错误（如 runner 未配置、请求体过大）。
- **开发者体验：** 生产环境下原始错误信息（可能包含路径、配置细节）泄漏给前端；与后端错误脱敏设计不一致。
- **修复建议：** 改为 `sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Failed to create analysis job"), req)`。

---

### 🟡 Medium — 累积性问题或特定场景下的痛点

#### M1. `buildCostMetadata` 硬编码汇率，缺乏模型区分
- **文件：** `server/jobs.js:136-138`
- **现象：** 仅区分 `moonshot`（0.024 CNY/1K）和其他（0.03 CNY/1K）。未区分 GPT-4o、Claude 3.5 Sonnet 等不同定价模型，也不区分 input/output token 单价差异。
- **触发条件：** 任何 AI 分析完成后展示成本估算。
- **开发者体验：** 使用非 Moonshot 模型时，成本估算严重偏离实际账单，导致开发者/用户对成本预测失去信任。
- **修复建议：** 建立 `MODEL_RATES` 映射表（支持 input/output 差异定价）；允许通过环境变量注入完整映射。

#### M2. `diffParts` 与 `job.request` 闭包引用导致大文本内存驻留
- **文件：** `server/jobs.js:199-243`
- **现象：** `executeAnalysisJob` 中 `diffParts` 间接引用 `request.previous_text` / `request.contract_text`；同时 `job.request` 保存完整原始请求。分析任务可能持续 1-10 分钟，期间大合同文本（数十 MB）无法被 GC。
- **触发条件：** 分析包含 `previous_text` 的大合同（>5MB 文本）时。
- **开发者体验：** 队列中 2 个并行任务即可占用数百 MB 内存，Electron 主进程 OOM 风险增加。
- **修复建议：** `createAnalysisJob` 接收请求后立即剥离大字段；需要原始文本时从 SQLite 按需读取。

#### M3. `rebuildSearchIndex` 失败静默降级，搜索功能不可用
- **文件：** `server/store-sqlite.js:1640-1684`
- **现象：** `rebuildSearchIndex` 内部 try-catch 失败时，仅写入 `app_state.searchIndexStatus = failed`，**不向调用方抛出**，也不自动重试。
- **触发条件：** FTS5 虚拟表损坏（罕见但可能发生）。
- **开发者体验：** 同步显示成功，但全局搜索返回空结果；开发者误以为数据丢失。
- **修复建议：** 在 `readDb` 返回的 `storageMeta` 中携带 `searchIndexStatus`；提供 `POST /api/search/rebuild` 手动重建接口。

#### M4. `check-all.js` 静态检查范围不足
- **文件：** `scripts/check-all.js`
- **现象：** 只检查 `.js` 文件语法，不检查 `schemas/*.json` 的 JSON 有效性；`exclude` 列表未包含 `tests/.tmp-*` 临时目录。
- **触发条件：** 开发者手动编辑 `schemas/*.json` 时引入语法错误；测试运行后临时目录出现损坏的 `.js` 文件。
- **开发者体验：** JSON schema 语法错误无法在 `npm run check` 阶段捕获，可能在运行时导致 `JSON.parse` 失败。
- **修复建议：** 增加 `tests/.tmp-*` 到 `exclude` 列表；增加对 `schemas/*.json` 的 JSON 有效性检查。

#### M5. `test-server-api.js` 被注释排除在统一测试套件之外
- **文件：** `tests/test-runner.js:63`
- **现象：** `//"tests/test-server-api.js", // Commented out: requires server startup`
- **触发条件：** 始终。
- **开发者体验：** 这部分测试永远不会在 `npm test` 中运行，server API 的回归问题无法被自动发现。
- **修复建议：** 改为自启动 server 的独立测试或创建 `npm run test:server`。

#### M6. `regression-smoke.js` 覆盖范围有限且脆弱
- **文件：** `scripts/regression-smoke.js`
- **现象：** 只检查特定字符串是否在特定文件中存在。这不是行为测试，只是"字符串存在性"检查。
- **触发条件：** 任何重构或重命名都会误报失败。
- **开发者体验：** false positive 和 false negative 同时存在，开发者对回归测试的信任度降低。
- **修复建议：** 将关键路径改为调用实际函数/模块的轻量级单元测试。

#### M7. 大量 `state` 直接写入仍未收敛到 `Store.mutate()`
- **文件：** `js/app-router.js`、`js/contract-lifecycle.js`、`js/review-actions.js`、`js/review-reorder.js`、`js/search.js` 等
- **现象：** 全仓仍有 **62 处** `state.xxx = ...` 直接写入，未经过 `Store.mutate()`。虽然 TODO.md 标记 3.2 为"进行中"，但进度缓慢。
- **触发条件：** 任何前端状态变更路径。
- **开发者体验：** 状态变更不可追踪、不可回滚；新增功能时容易破坏不可变性假设；单元测试难以隔离状态副作用。
- **修复建议：** 继续推进 TODO 3.2，优先收敛高频写路径（app-router、review-actions、contract-lifecycle）。

#### M8. `dispatchGlobalClick` 忽略 async handler 异常，导致 unhandled rejection（新发现）
- **文件：** `js/app-events.js:16-18`
- **现象：** `void handleGlobalClick(event)` 不等待 async handler（如 `handleExportClick`、`handleClauseRiskClick`）完成，也不捕获异常。一旦这些 handler 内部抛出错误（如网络中断、后端 500），会成为 `unhandledrejection`。
- **触发条件：** 点击"采纳风险建议"、"生成拟发送版本"等按钮时后端异常。
- **开发者体验：** 控制台报错，按钮可能卡在 disabled 状态无法恢复，用户体验中断且无降级提示。
- **修复建议：** 将 `dispatchGlobalClick` 改为 async，并包装 try/catch：
  ```javascript
  async function dispatchGlobalClick(event) {
    try { await handleGlobalClick(event); } catch (e) { console.error(e); }
  }
  ```

#### M9. `render-review.js` 中 `data-*` 属性转义遗漏（新发现）
- **文件：** `js/render-review.js` 多处
- **现象：** 大量动态 `data-*` 属性未套用 `escapeHtml`，如 `data-run-legal-skill="${contract.id}"`、`data-workbench-clause="${clause.id}"` 等。
- **触发条件：** 合同 ID 或条款 ID 包含恶意字符（虽然当前是系统生成，但接口或导入路径可能被污染）。
- **开发者体验：** 存在 XSS 向量，一旦 ID 被注入，可在审阅台执行任意脚本。
- **修复建议：** 对所有动态 `data-*` 属性统一套用 `escapeHtml`。

#### M10. 多处裸 `setTimeout` 未注册到 `TimerRegistry`（新发现）
- **文件：** `js/render-review.js:737`、`js/electron-bridge.js:91`、`js/api/core.js:735`
- **现象：** `scheduleCodexSegmentation` 中的 `setTimeout(..., 0)`、`electron-bridge` 的 `enhancementDebounce`、`flushBackendSync` 的 fallback `setTimeout(doClone, 0)` 均未通过 `TimerRegistry` 管理。
- **触发条件：** `Store.setActiveContract` 调用 `TimerRegistry.clearAll()` 时。
- **开发者体验：** 切换合同后，旧合同的 segmentation timer 或 bridge enhancement 仍可能执行，造成不必要的 CPU 消耗或 DOM 操作异常。
- **修复建议：** 全部改用 `TimerRegistry.set(...)` 注册。

---

### 🟢 Low — 边缘情况或轻微不便

#### L1. `readJson` 20MB 限制可能过小
- **文件：** `server/http-utils.js:186`
- **现象：** `readJson` 限制为 20MB。全量同步大型合同库时，JSON payload 可能超过此限制。
- **触发条件：** 合同库规模大（50+ 合同、多版本、附件元数据）。
- **开发者体验：** 同步请求被 413 拒绝，前端无自动分片机制。
- **修复建议：** 将限制提升至可配置（如 `config.maxJsonPayloadBytes`，默认 50MB）；或对 `/api/db/sync` 提供分块 endpoint。

#### L2. `preflight.js` 的 `checkNpm` 在 Windows 上对非标准安装路径误判
- **文件：** `scripts/preflight.js:24-49`
- **现象：** 只检查 `path.dirname(process.execPath)` 旁的 `npm.cmd`，或 `process.env.npm_execpath`。如果开发者使用 `nvm-windows`、`fnm` 或 Volta，`npm` 可能不在这些位置。
- **触发条件：** 使用 nvm-windows/fnm 切换 Node 版本后运行 `npm run preflight`。
- **开发者体验：** 误报 "npm.cmd not found"，但 `npm` 实际可用。
- **修复建议：** 增加 fallback：尝试执行 `npm --version`，如果成功则通过。

#### L3. `playwright.config.js` `fullyParallel: false` + `workers: 1` 拖慢 E2E
- **文件：** `playwright.config.js:10-11`
- **现象：** E2E 测试完全串行，单 worker。
- **触发条件：** 始终。
- **开发者体验：** 5 个 E2E spec 文件串行执行，总耗时 3-5 分钟。但当前测试确实共享应用状态，并行可能导致数据冲突。
- **修复建议：** 保持现状（数据隔离优先），但可在 CI 中通过 `PLAYWRIGHT_BASE_URL` 指向多个独立实例实现并行。

#### L4. `electron-bridge.js` MutationObserver 在页面 unload 时未清理（新发现）
- **文件：** `js/electron-bridge.js:86-124`
- **现象：** `visibilitychange` 会 disconnect/reconnect observer，但没有监听 `beforeunload` 或 `unload`。Electron 环境下窗口刷新或关闭时，observer 和 `visibilitychange` 监听器不会被显式释放。
- **触发条件：** 热重载开发、Electron 窗口刷新。
- **开发者体验：** 重复加载脚本会导致 observer 和事件监听器堆积。
- **修复建议：** 添加 `window.addEventListener("beforeunload", () => { if (observer) observer.disconnect(); })`。

#### L5. `focusSelector` 未对动态 ID 做 CSS escape，focus 恢复可能失败（新发现）
- **文件：** `js/render-review.js:85-87`
- **现象：** 构建 `focusSelector` 时直接拼接 `activeEl.dataset.clauseCard`，未调用 `cssEscapeValue`。如果 clauseId 包含引号、方括号等特殊字符，`document.querySelector` 会抛出 `DOMException` 或返回 null。
- **触发条件：** 使用包含特殊字符的 clause ID（虽不常见，但自定义导入时可能出现）。
- **开发者体验：** re-render 后 focus 恢复失败，用户需要手动点击才能继续编辑。
- **修复建议：** 统一使用已有的 `cssEscapeValue` 辅助函数。

#### L6. `state.js` 中 `hasStrippedTexts` 为空实现（新发现）
- **文件：** `js/state.js:321-329`
- **现象：** 函数始终返回 `false`，内部有一个空的 `if` 块，明显是未完成的代码。
- **触发条件：** 任何调用 `hasStrippedTexts` 的逻辑。
- **开发者体验：** 如果未来被调用，会导致 large text 恢复逻辑异常，可能造成数据静默丢失。
- **修复建议：** 实现完整逻辑或移除该函数。

#### L7. `events-modal.js` 模块加载时 querySelector 可能为 null（新发现）
- **文件：** `js/events-modal.js:313-315`
- **现象：** 模块顶层直接执行 `document.querySelector("#upload-form").addEventListener(...)`，未检查 null。
- **触发条件：** JS 在 HTML 元素渲染前加载（如 `<script>` 被移到 `<head>` 中）。
- **开发者体验：** `TypeError: Cannot read properties of null`，阻断后续所有脚本执行。
- **修复建议：** 包装在 `DOMContentLoaded` 中或添加 `?.` 可选链。

---

## 四、问题分类统计

| 级别 | 数量 | 主要影响 |
|------|------|---------|
| 🔴 Critical | 7 | 进程崩溃、测试阻塞/挂起、进程泄漏、前端卡顿、打包失败 |
| 🟠 High | 13 | 同步阻塞、错误泄漏、E2E 不可靠、状态不一致、timer 泄漏、scroll 跳跃、深比较卡顿 |
| 🟡 Medium | 10 | 成本估算不准、内存驻留、搜索失效、静态检查不足、state 治理、XSS 风险、async 异常 |
| 🟢 Low | 7 | payload 限制、preflight 误判、E2E 串行、observer 清理、CSS escape、空实现、querySelector null |
| **总计** | **37** | |

---

## 五、开发者日常体验影响映射

| 日常操作 | 仍遇到的问题 | 严重程度 |
|---------|-----------|---------|
| **打开应用** | `unhandledRejection` 直接 exit → 闪退 + WAL 损坏风险；asar 打包后后端无法启动 | High / Critical |
| **上传 Word 合同** | `replaceDb` 同步阻塞 → 后端冻结 | High |
| **编辑条款文本** | `replaceDb` 同步阻塞后端；`Store.mutate` 深克隆 → 打字卡顿；state 直接写入不可追踪 | High / Critical |
| **滚动/浏览长合同** | `renderReview` focus 恢复导致 scroll 跳跃；全量重建仍是瓶颈 | High |
| **运行 AI 分析** | `diffParts` 闭包引用大文本 → 内存驻留；`pollLegalSkillJob` race condition → 重复分析；Kimi 默认 2 并发 | Critical / Medium |
| **切换合同** | `logger` 未定义 → 若路径越界则崩溃（边缘但致命） | Critical |
| **导出 Word** | `replaceDb` 阻塞期间导出请求排队/超时 | High |
| **全局搜索** | `rebuildSearchIndex` 失败静默降级 → 搜索空结果 | Medium |
| **关闭应用** | `stopBackend` 期间后端被意外重启 → 僵尸进程 | Critical |
| **运行测试** | `test-legal-skill-pure.js` ETIMEDOUT / 挂起 → 测试不可信 | Critical |
| **E2E 验证** | `channel: chromium` + 硬编码路径 + 选择器歧义 → 跨平台不可用 | High |
| **打包发布** | asar 未 unpack server 目录 + 缺少 `.so`/`.dylib` → 生产环境启动失败 | Critical |

---

## 六、修复优先级建议（开发者自用视角）

### P0 — 立即修复（影响每日使用，工作量极小）

| # | 问题 | 文件 | 工作量 | 收益 |
|---|------|------|--------|------|
| 1 | `server/store-sqlite.js` 导入 `logger` (C1) | `server/store-sqlite.js` | 1 行 | **消除可复现的进程崩溃** |
| 2 | `test-legal-skill-pure.js` `execFileSync` 加 timeout (C2) | `tests/test-legal-skill-pure.js` | 1 行 | **消除测试随机超时失败** |
| 3 | `test-legal-skill-pure.js` `Promise.all` 加 catch (C3) | `tests/test-legal-skill-pure.js` | 2 行 | **消除测试静默挂起** |
| 4 | `pollLegalSkillJob` race condition 修复 (C4) | `js/api/core.js` | 3 行 | **避免重复分析和取消失效** |
| 5 | `stopBackend` close handler 加 `isStoppingBackend` 守卫 (C5) | `electron/main.js` | 1 行 | **消除退出时僵尸进程** |
| 6 | `server` 目录加入 `asarUnpack` 并检测 unpacked 路径 (C6) | `package.json` / `electron/main.js` | ~5 行 | **打包后可正常启动** |
| 7 | `legal-review.js` 使用 `serverErrorPayload` (H13) | `server/routes/handlers/legal-review.js` | 1 行 | **统一错误脱敏** |

### P1 — 短期修复（显著改善体验，工作量中等）

| # | 问题 | 文件 | 工作量 | 收益 |
|---|------|------|--------|------|
| 8 | `replaceDb` 异步化/分批或推广 `incrementalSync` (H1) | `server/store-sqlite.js` | 中 | **消除后端冻结** |
| 9 | `unhandledRejection` 走 `gracefulShutdown` (H2) | `server/server.js` | 2 行 | **优雅退出，保护 WAL** |
| 10 | 移除 `playwright.config.js` `channel` (H3) | `playwright.config.js` | 1 行 | **E2E 在干净环境可运行** |
| 11 | 修复 `data-open-contract` 选择器歧义 (H4) | `tests/test-e2e-*.spec.js` / `js/dashboard.js` | 3 处 | **E2E 测试稳定** |
| 12 | E2E 脚本使用 Playwright 自带 Chromium (H5) | `scripts/manual-flow-check.js` / `scripts/test-layer3-frontend-e2e.js` | 各1行 | **跨平台 E2E 可用** |
| 13 | `replaceDb` COMMIT 后错误降级处理 (H6) | `server/store-sqlite.js` | ~10 行 | **避免状态不一致** |
| 14 | `delay()` 支持 `AbortSignal` (H7) | `js/api/core.js` | ~5 行 | **减少 timer 泄漏** |
| 15 | `renderReview` focus/scroll 恢复时序 (H8) | `js/render-review.js` | 2 行 | **避免阅读位置跳跃** |
| 16 | `buildIncrementalPayload` 去掉 JSON.stringify 深比较 (H9) | `js/api/core.js` | ~10 行 | **减少周期性强卡顿** |
| 17 | `stopBackend` PID 回收快速退出 (H10) | `electron/main.js` | 5 行 | **避免退出卡住 8 秒** |
| 18 | Reader filter 输入加 debounce (H12) | `js/events-document.js` | 3 行 | **搜索不再卡顿** |

### P2 — 中期修复（架构改进，工作量中等）

| # | 问题 | 文件 | 工作量 | 收益 |
|---|------|------|--------|------|
| 19 | `Store.mutate()` 按需/异步克隆 (C7) | `js/store.js` | 中 | **消除打字卡顿** |
| 20 | `buildCostMetadata` 模型区分 (M1) | `server/jobs.js` | ~15 行 | **成本估算可信** |
| 21 | `diffParts` / `job.request` 内存瘦身 (M2) | `server/jobs.js` | ~10 行 | **减少 OOM 风险** |
| 22 | `rebuildSearchIndex` 失败暴露 (M3) | `server/store-sqlite.js` | ~5 行 | **搜索问题可感知** |
| 23 | `check-all.js` 扩展覆盖 (M4) | `scripts/check-all.js` | ~5 行 | **静态检查更完整** |
| 24 | 恢复 `test-server-api.js` (M5) | `tests/test-runner.js` | 中 | **API 回归可检测** |
| 25 | `regression-smoke.js` 行为化 (M6) | `scripts/regression-smoke.js` | 中 | **回归测试可信** |
| 26 | 高频 state 写路径收敛到 `Store.mutate()` (M7) | `js/*.js` | 中 | **状态治理改善** |
| 27 | `dispatchGlobalClick` async try/catch (M8) | `js/app-events.js` | 3 行 | **避免按钮卡死** |
| 28 | 统一 `data-*` 属性 escapeHtml (M9) | `js/render-review.js` | ~10 行 | **消除 XSS 风险** |
| 29 | 裸 `setTimeout` 接入 TimerRegistry (M10) | `js/*.js` | ~5 处 | **避免旧合同 timer 泄漏** |

### P3 — 可搁置（开发者自用影响小）

- `readJson` payload 限制可配置化（L1）
- `preflight.js` npm 路径 fallback（L2）
- E2E 并行化（L3）
- `electron-bridge.js` beforeunload cleanup（L4）
- `focusSelector` CSS escape（L5）
- `hasStrippedTexts` 实现或移除（L6）
- `events-modal.js` null check（L7）

---

## 七、总体评估

**当前代码状态：** 相比 `f3bed86`，系统核心稳定性已有质的飞跃。进程管理、错误重试、焦点保留、备份超时、优雅关闭等关键痛点均已闭环。**但仍有 7 个 Critical 问题（其中多个仅需 1-3 行修复）和 13 个 High 问题阻碍开发者日常流畅使用。**

**最严重的五个残留问题：**
1. **`pruneOrphanedFiles` 的 `logger` 未定义** — 确定性的进程崩溃路径，修复只需加一行 import。
2. **`stopBackend` 期间后端被意外重启** — 上一轮修复引入的回归，导致退出时产生僵尸进程。
3. **`asar` 打包后后端脚本路径问题** — 影响打包发布，生产环境可能无法启动。
4. **`Store.mutate()` 全量深克隆** — 长合同时每次键盘输入都卡顿，严重影响编辑体验。
5. **`pollLegalSkillJob` race condition** — 可能导致同一合同被重复分析，浪费 token 和 CPU。

**测试层状态：** `test-legal-skill-pure.js` 的同步子进程模式是定时炸弹，严重影响开发者对测试套件的信任；E2E 测试在跨平台/干净环境下几乎无法直接运行。

**建议：** 先集中 30 分钟完成 P0 的 7 个极小修复（总计不到 20 行代码），立即消除崩溃、进程泄漏、测试阻塞和打包失败风险；然后投入 2-4 小时完成 P1 的 11 个修复，显著改善日常交互流畅度和开发可靠性。P2 的架构改进可在后续迭代中分批实施。
