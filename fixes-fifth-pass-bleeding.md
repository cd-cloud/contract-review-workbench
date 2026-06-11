# 第五轮深入审计止血修复记录

> 对应审计报告：`audit-fifth-pass-deep-dive.md`  
> 目标：修复 Critical/High 级别止血问题，保持 `npm test` 581/581、`npm run check`、`npm run electron:smoke` 全绿。

## 已修复问题清单

### C1. `replaceDb` 长事务阻塞并发写入
- **文件**：`server/store-sqlite.js`
- **根因**：`BEGIN IMMEDIATE` 后调用 `await batchRun(...)`，`batchRun` 每批通过 `setImmediate` 让出事件循环，导致 SQLite 写锁在长达数秒/数分钟内被持有，所有并发写入超时。
- **修复**：
  1. `batchRun` 检测 `db.inTransaction`：若处于显式事务中则同步执行，不再 `await yieldToEventLoop()`。
  2. 恢复 `pruneOrphanedFiles(validContractIds, validVersionIds, validFileIds)` 在清表前的调用，避免全量同步后孤儿归档文件残留。
- **验证**：`npm test` 581/581 通过，`replaceDb prunes orphaned archived files` 测试通过。

### H1. Electron 退出竞态产生孤儿后端进程
- **文件**：`electron/main.js`
- **根因**：`stopBackend()` 的 8s 兜底过早把 `isStoppingBackend` 设为 `false`；延迟触发的 `close` 事件会再次进入 `tryRestartBackend()`。另外 `tryRestartBackend()` 在应用退出时仍可能调度新的 `startBackend()`。
- **修复**：
  1. `startBackend()` 开头增加 `if (backendProcess || isQuitting || isStoppingBackend) return;`。
  2. `tryRestartBackend()` 开头增加 `if (isQuitting || isStoppingBackend) return;`。
  3. `stopBackend()` 在所有路径（checkInterval 命中、8s 兜底）中保持 `isStoppingBackend = true`，仅在 `backendProcess.on("close")` 中统一清除。
  4. `close` 事件处理中若 `isStoppingBackend` 为真，则清除标志后直接返回，不再重启。
- **验证**：`npm run electron:smoke` 通过，无孤儿 Node 进程残留。

### H2. `/api/db/sync` 无超时导致 `isSyncing` 永久占用
- **文件**：`server/routes/handlers/system.js`
- **根因**：慢客户端或超大 `replaceDb` 可能让 `isSyncing` 长时间为 `true`，后续同步全部返回 429。
- **修复**：
  1. 引入 `SYNC_TIMEOUT_MS = 90000`。
  2. 新增 `withSyncTimeout(promise, startTime, label)`，对 `readJson(req)`、`incrementalSync(snapshot)`、`replaceDb(snapshot)` 分别设置剩余时间超时。
  3. 超时后返回 503，并在 `finally` 中释放 `isSyncing`。
- **验证**：`npm test` 通过。

### H3. `flushBackendSync()` 在请求成功前更新 `lastSyncedSnapshot`
- **文件**：`js/api/core.js`
- **根因**：`lastSyncedSnapshot` 在 `legalWorkbenchFetch` 之前被更新；若请求失败，下次增量同步基于一个后端尚未持久化的基线，导致变更丢失。
- **修复**：将 `lastSyncedSnapshot = stripLargeTextsFromSnapshot(snapshot);` 移到请求成功（`response.ok`）之后。
- **验证**：`npm test` 通过。

### H4. `base-adapter` 子进程忽略 `timeoutMs`
- **文件**：`server/base-adapter.js`
- **根因**：`execFile(...)` 未设置 `timeout`，AI runner 子进程可能无限挂起。
- **修复**：
  1. 从 `runnerConfig.timeoutMs` 读取超时，默认 120000ms。
  2. `execFile` 选项增加 `timeout` 与 `killSignal: "SIGTERM"`。
  3. 若子进程因 SIGTERM 被 kill，抛出明确超时错误。
- **验证**：`npm test`、`npm run electron:smoke` 通过。

### H5. `readJson` 20 MB 限制与上传 50 MB 配置冲突
- **文件**：`server/http-utils.js`、`server/config.js`、`tests/test-http-utils.js`
- **根因**：`readJson` 硬编码 20 MB，但 `config.maxFileBytes` 默认 50 MB；15 MB DOCX base64 后约 20 MB+，上传/DOCX 解析在到达业务校验前被拒绝。
- **修复**：
  1. `config.js` 新增 `maxJsonPayloadBytes`，默认 `max(20MB, maxFileBytes * 1.5)`（约 75 MB）。
  2. `readJson(req, options)` 支持 `options.maxBytes`，默认使用 `config.maxJsonPayloadBytes`。
  3. 更新测试名称以匹配新语义（151 MB 仍被拒绝）。
- **验证**：`npm test` 通过。

### H6. `incrementalSync` 嵌套 `db.transaction()` savepoints
- **文件**：`server/store-sqlite.js`
- **根因**：`incrementalSync` 外层通过 `runInTransaction` 开启事务，内层 `replaceContractClauses`、`replaceContractFindings`、`replaceClauseActions` 又各自创建 `db.transaction()`，形成嵌套 savepoints，增加死锁/回滚异常风险。
- **修复**：上述三个函数检测 `db.inTransaction`；若已处于事务中则直接执行工作函数，否则创建新事务。
- **验证**：`npm test` 通过。

### H7. `Store.setActiveContract()` 误清 `backend-health` 等全局轮询
- **文件**：`js/store.js`、`js/timer-registry.js`
- **根因**：切换合同时调用 `TimerRegistry.clearAll()`，会一并清除跨视图应保持的全局 timer（如未来的 `backend-health`）。
- **修复**：
  1. `TimerRegistry` 新增 `clearAllExcept(keepIds)`。
  2. `Store.setActiveContract()` 改为 `TimerRegistry.clearAllExcept(["backend-health"])`。
- **验证**：`npm test`、`npm run check` 通过。

## 本轮早期已完成的止血项

- **`scripts/ai-runner-lib.js` `compact()` 未定义 `end` 变量**：已改为 `totalProcessed`。
- **`server/store-sqlite.js` 文件路径遍历**：`deleteFile`、`saveFile`、`getContractFolder`、`replaceDb` 文件导入统一加入 `isPathInsideRoot(WORKBENCH_ROOT, ...)` 校验。
- **`server/http-utils.js` `.api_token` 权限**：写入后执行 `fs.chmodSync(tokenPath, 0o600)`。

## 基线状态

```bash
npm test              # 581/581 passed
npm run check         # All 157 JS files and schemas passed check.
npm run electron:smoke # passed
```

## 后续根因级改进（未进入本轮）

- 全量 `state` 同步改为 dirty-entity 增量同步。
- FTS5 增量更新，避免全量重建。
- 文件传输改用流式 multipart，避免 base64 全量进 JSON。
- 统一 Electron/后端/Job 生命周期状态机。
