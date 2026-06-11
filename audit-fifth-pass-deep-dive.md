# 第五轮深入审计报告

> 审计时间：2026-06-12  
> 范围：`contract-review-workbench-fresh/` 全量源码  
> 维度：安全、稳定性/并发、性能/大数据、架构/可维护性  
> 方法：静态代码分析 + 跨模块依赖审查  

## 执行摘要

第四轮修复后，项目已建立起 `npm run check` + `npm test` + `electron:smoke` 三道防线，明显问题基本收敛。本轮深入审计从**架构级隐患**切入，发现的问题以**性能、数据一致性、资源生命周期**为主，安全类问题次之。

核心结论：
- **前端以整个 `state` 为单一值**：每次交互都触发全量序列化、HTTP 同步、全量重渲染。
- **后端以 `replaceDb` 为默认写路径**：全表 truncate+rewrite 仍然是常态，而不是兜底。
- **Electron 进程生命周期与后端启停存在竞态**：关闭窗口时可能产生孤儿后端进程。
- **文件系统边界校验不统一**：`deleteFile` / `saveFile` 等关键路径缺少 `isPathInsideRoot`。

| 严重等级 | 数量 | 说明 |
|----------|------|------|
| Critical | 4 | 运行时崩溃、长时间锁表、全量同步导致不可用 |
| High | 16 | 安全越权、数据不一致、竞态、资源泄漏、关键超时缺失 |
| Medium | 28 | 性能恶化、重复代码、测试性差、边界条件 |
| Low | 12 | 文档、硬编码、信息泄露、可维护性 |

---

## 一、Critical（立即修复）

### C1. `scripts/ai-runner-lib.js:481` `compact()` 引用未定义变量 `end`
- **影响**：AI runner 子进程在处理长文本时抛出 `ReferenceError`，导致 AI 分析直接失败。
- **修复**：在模板字符串前定义 `const end = headLen + tailLen`（或等价值）。

### C2. `server/store-sqlite.js:751-990` `replaceDb` 长时间持有 `BEGIN IMMEDIATE` 事务并 `await`
- **影响**：虽然 `replaceDb` 已改为 async 分批，但 SQLite 写锁在 `BEGIN IMMEDIATE` 到 `COMMIT` 之间一直被持有；`setImmediate` 让出事件循环时，其他写入（`saveAnalysisJob`、incremental upserts）被阻塞 5s 后报 `SQLITE_BUSY`。
- **修复**：
  - 短期：为 `replaceDb` 加进程内互斥锁，确保全量同步串行；同时把 `better-sqlite3` busy timeout 提升到 30s 并对调用方返回 `429 retry-after`。
  - 长期：前端默认走 incremental/entity API，`replaceDb` 仅用于导入/恢复/强制刷新。

### C3. 前端以完整 `state` 作为同步/持久化/渲染单位
- **位置**：`js/state.js:221 clone()`、`js/state.js:300 stripLargeTexts()`、`js/api/core.js:439 syncBackendSnapshot()`、`js/api/core.js:727 flushBackendSync()`、`js/render-review.js:60 renderReview()`。
- **影响**：大合同/多合同时，每次按键/点击都触发全状态 `JSON.parse/stringify`、全量 HTTP 上传、整棵条款树 `innerHTML` 重建，主线程卡顿数百毫秒，后端锁表数秒。
- **修复**：
  - 将 `__backendSyncDirtyFlags` 从布尔扩展为 dirty-entity map，只上传变更的合同/版本/条款/操作。
  - `renderReview` 改为增量渲染或虚拟滚动，只更新变化卡片。
  - 用 `structuredClone` 替代 `JSON.parse(stringify)`，或直接用 immutable 更新避免深克隆。

### C4. `server/store-sqlite.js:1678-1722` `rebuildSearchIndex()` 全量删除重建
- **影响**：每次 `replaceDb` 都清空 `search_index` 再全量插入；大合同时 FTS5 重建耗时数秒，阻塞写入。
- **修复**：改为增量更新：根据变更的合同/条款 ID 删除对应行，再插入新行。

---

## 二、High（短期修复，建议 1-2 周内）

### 安全

#### H1. `server/store-sqlite.js:1482-1489` `deleteFile()` 未校验文件路径
- **风险**：通过恶意 snapshot 写入任意 `filePath`，再调 `DELETE /api/files/:id` 删除系统任意文件。
- **修复**：删除前 `isPathInsideRoot(WORKBENCH_ROOT, file.path)`，越界则拒绝并记录审计。

#### H2. `server/store-sqlite.js:1019-1024` `saveFile()` 允许 `..` 和路径分隔符
- **风险**：`POST /api/files` 可写入 `../../data/workbench.sqlite` 覆盖数据库。
- **修复**：`name` 去除 `..`、斜杠、反斜杠；最终路径用 `isPathInsideRoot(FILE_DIR, filePath)` 校验。

#### H3. `server/http-utils.js:10-27` `.api_token` 文件权限过宽
- **风险**：多用户机器上其他用户可读 token，直接调用所有 `/api/*`。
- **修复**：写 token 后 `fs.chmodSync(tokenPath, 0o600)`；Electron 优先通过环境变量传 token。

#### H4. `server/store-sqlite.js:826-832` `replaceDb()` 从 snapshot 导入文件记录不校验路径
- **风险**：与 H1 组合，形成“导入-删除”链删除任意文件。
- **修复**：导入 `files` 时校验 `path`/`filePath` 必须在 `WORKBENCH_ROOT` 内，越界记录丢弃/报错。

#### H5. `server/store-sqlite.js:718-734` `getContractFolder()` 返回路径未校验
- **风险**：异常目录名 `contractId-xxx-../../evil` 可导致后续写文件越界。
- **修复**：返回前 `isPathInsideRoot(WORKBENCH_ROOT, path)`；扫描时跳过含 `..` 或分隔符的目录名。

### 稳定性 / 并发

#### H6. `electron/main.js` 关闭应用期间后端可能重启
- **位置**：`electron/main.js:223-232` `stopBackend()`、`electron/main.js:235-246` `tryRestartBackend()`。
- **风险**：`stopBackend` 过早把 `isStoppingBackend` 设为 false；`close` 事件延迟触发时可能调用 `tryRestartBackend()`，在退出时产生孤儿后端进程。
- **修复**：`isStoppingBackend` 保持 true 直到 `close` 真正触发；`startBackend` / `tryRestartBackend` 开头加 `if (isQuitting) return;`。

#### H7. `electron/main.js` `stopBackend` 8s 固定超时可能提前声明成功
- **风险**：定时器 8s 后就 resolve，但子进程可能仍在运行；硬停止定时器在成功路径中未被清理。
- **修复**：仅在 `close` 事件或 `taskkill` 完成后 resolve；所有退出路径清理 timer/interval。

#### H8. `server/store-sqlite.js:697-716` `pruneOrphanedFiles()` 在事务开始前执行
- **风险**：事务回滚后，磁盘文件已被删但数据库仍引用，导致文件找不到。
- **修复**：只在 `COMMIT` 成功后执行 prune。

#### H9. `server/routes/handlers/system.js:45-70` `/api/db/sync` 无请求超时
- **风险**：`server.timeout` 默认为 0，慢客户端可永久占用 `isSyncing`，后续同步全部 429。
- **修复**：`server.timeout = 120000`；`/api/db/sync` 内 `req.setTimeout(120000)` 并在超时回调释放 `isSyncing`。

#### H10. `server/store-sqlite.js:1619-1656` `restoreBackupToDirectory()` 替换全局 DB 连接时可能有进行中的请求
- **风险**：`closeDb()` 关闭连接并替换 `db` 引用，其他异步请求可能正持有 prepared statement。
- **修复**：加全局 DB 锁，拒绝新请求，等待在途请求完成后再 close/reopen。

#### H11. `server/base-adapter.js:65-95` `runConfiguredCommand()` 忽略 `timeoutMs`
- **风险**：AI runner 子进程可无限挂起，占满 job 并发槽。
- **修复**：根据 `runnerConfig.timeoutMs` 设置 `setTimeout` 杀死子进程。

#### H12. `server/server.js:85-90` `unhandledRejection` 无条件立即退出
- **风险**：轻微瞬时错误（如一次网络抖动）导致后端直接退出，可能中断正在进行的写入/job。
- **修复**：区分致命/可恢复；可恢复的仅记录并继续，只有重复致命错误或 DB 损坏才关闭。

### 数据一致性

#### H13. `js/api/core.js:733-776` `flushBackendSync()` 在请求成功前更新 `lastSyncedSnapshot`
- **风险**：请求失败后，下次同步认为已经同步过，只发空的 incremental payload，后端永远追不上。
- **修复**：把 `lastSyncedSnapshot = ...` 移到请求成功后的分支。

#### H14. `server/routes/handlers/system.js:114-155` `incrementalSync` 嵌套 `db.transaction()` savepoints
- **风险**：内层 savepoint 回滚可能意外撤销外层工作，增加死锁/锁超时风险。
- **修复**：将 incremental sync 改写为单个 `db.transaction()` 回调，或传递 tx 对象给 helper。

### 资源 / 性能

#### H15. `server/http-utils.js:181-202` `readJson` 20 MB 限制与上传 50 MB 配置冲突
- **风险**：合法大文件（~15 MB DOCX base64 后 ~20 MB+）被 `readJson` 拒绝，上传/DOCX 解析/导出在真正校验前失败。
- **修复**：`readJson` 限制至少为 `MAX_ARCHIVE_FILE_BYTES * 1.5`；大文件改用 multipart/form-data 流式上传。

#### H16. `js/api/core.js:89` + `server/http-utils.js` 大合同法律审查请求被 readJson 拒绝
- **风险**：backend chunking 本可处理大文本，但请求体在入口处就被 20 MB 限制拦住。
- **修复**：为 `/api/legal-review/*`、`/api/contract-intake`、`/api/docx/parse` 单独设置更高的 body 限制或流式接口。

#### H17. `js/store.js:88-101` `Store.setActiveContract()` 调用 `TimerRegistry.clearAll()` 清掉 backend-health
- **风险**：切换合同后，backend health 检查永久停止，应用无法感知后端恢复。
- **修复**：`clearAll` 排除 `backend-health`，或在切换后重新启动它。

---

## 三、Medium（中期优化，建议 1 个月内）

### 性能 / 渲染

- **M1.** `js/render-review.js:902` `getClauseAggregateQueueStatus()` 默认参数每次重新计算 `placementClauses` → 每渲染一个条款都重新 split/flatten。应每 render 计算一次并传递。
- **M2.** `js/render-review.js:622-655` `renderContractStructureOverview()` 对每个条款计算两次风险摘要 → O(clauses²)。预计算风险 map。
- **M3.** `js/review-risk.js:212-238` `getClauseRiskSummary()` 缓存每次 render 被清空 → 重复计算。按 `contractId + sourceKey + resultVersion` 缓存。
- **M4.** `js/review-material.js:219-254` `splitVersionClauses()` LRU 缓存仅 16，切换视图易 miss → 增大缓存或强引用当前 material。
- **M5.** `js/review-index.js:228-291` `buildHistoricalPracticeReferences()` 每次 active card render 都扫描全库 → 预按类型/相对方索引。
- **M6.** `js/diff-engine.js:32-57` Hirschberg diff 阈值过高，大文本仍可能卡顿 UI → 降低阈值或移入 Worker。
- **M7.** `js/api/findings.js:184-191` `findBestSkillClause()` 对每个 finding 遍历所有条款 → O(findings × clauses)。缓存 clause 特征向量。
- **M8.** `js/word-docx.js:1154-1217` `createZip()` 在内存中构建整个 ZIP → 大导出包内存峰值高。流式写入 `WritableStream`。
- **M9.** `server/store-sqlite.js:470-600` `assembleStructuredSnapshot()` 全表加载无分页 → `readDb()` 在大 portfolio 时内存爆炸。支持按合同过滤/分页。
- **M10.** `server/store-sqlite.js:1338-1387` `saveAnalysisJob()` 持久化完整 `result_json` → WAL 膨胀。限制/压缩大字段。

### 架构 / 可维护性

- **M11.** `js/contract-parser.js:40` 与 `lib/contract-splitter.js:58` 两个 `splitClauses` 高度重复 → 合并为单一实现。
- **M12.** `js/utils.js:14`、`js/review-index.js:348`、`js/api/findings.js:522` 中文/阿拉伯数字转换实现三处重复 → 统一 `contract-numbers.js`。
- **M13.** `js/store.js:56` `getClauseActions` / `js/store.js:68` `getWorkbenchMaterial` 与 `js/review-material.js` 实现重复 → Store 作为唯一入口。
- **M14.** 前端全局 `state` 仍被大量模块直接读写 → 继续推进 `Store.mutate`，核心逻辑改为接受参数而非读全局。
- **M15.** `js/render-review.js:60` 混合渲染与业务编排（调度 segmentation、Visual QA）→ 拆分为 view-model 计算、DOM 应用、副作用调度三层。
- **M16.** `app.js` 加载时执行副作用（attach listener、start interval、render）→ 包装为 `initWorkbench()` 显式入口。
- **M17.** `js/electron-bridge.js:6`、`js/search.js:5` IIFE 立即执行，测试无法 mock → 改为导出 `init` 函数。
- **M18.** 命名不一致：`updates` vs `contractVersions`、`findings` vs `reviewRecords` → 选定一套并移除别名转换。
- **M19.** 多处 `innerHTML` 直接赋值无统一 helper → 增加 `html` 标签模板自动转义 + `renderInto`。

### 安全 / 边界

- **M20.** `server/routes/upload-utils.js:56-60` DOCX 校验只查 ZIP 头，未校验 `word/document.xml` → 增加包结构校验。
- **M21.** `server/routes/handlers/files.js:139-147` `POST /api/files` 未复用 `validateUploadedPayload` → 统一校验。
- **M22.** `server/routes/upload-utils.js` MIME 来自客户端 → 服务端根据魔数/扩展名重新推导。
- **M23.** `server/store-sqlite.js:34` `wal_checkpoint(${mode})` 拼接（已白名单）→ 改为常量调用。
- **M24.** `server/store-sqlite.js:71` `PRAGMA user_version = ${version}` 拼接（内部可控）→ 强制转整数。
- **M25.** `server/http-utils.js:96-110` token 认证未要求 `X-Requested-With` → 对 state-changing 请求统一要求。
- **M26.** `server/store-sqlite.js:1538-1617` `runAutoBackup()` 与长事务可能冲突 → 加 sync mutex 协调。
- **M27.** `server/http-utils.js:173-179` `serverErrorPayload()` 在 verbose 模式返回错误详情 → 生产默认关闭并脱敏。
- **M28.** `scripts/ai-runner-lib.js:142-153` Windows 下用 `cmd /c` 包装命令 → 避免或做字符白名单校验。

---

## 四、Low（长期 / 可选）

### 安全 / 信息泄露

- L1. `/api/health` 返回本地路径信息 → 仅返回 `ok`、`service`、`port`。
- L2. 备份未加密 → 备份目录设 `0o700` 或 zip 加密。
- L3. Cookie 无过期时间、未标记 Secure（localhost 可接受）。
- L4. AI runner stderr 可能含合同片段 → 日志目录 `0o700` 并避免回显全文。

### 代码 / 文档

- L5. `js/render-review.js:744` 等 “Smoke marker” 注释是测试痕迹 → 替换为 `data-testid` 或语义 class。
- L6. `js/review-risk.js:335` `buildAdviceActionSummary()` 恒返回空字符串 → 删除或实现。
- L7. `js/render-review.js:197` / `js/review-actions.js:470` Visual QA 调度 stub 为空 → 删除或标记为 intentional no-op。
- L8. `js/state.js` 注释说后端是唯一事实来源，实际仍是乐观本地 + 异步同步 → 更新文档。
- L9. `lib/contract-splitter.js` 顶部注释与 `js/contract-parser.js` 重复实现矛盾 → 更新。
- L10. 大量 magic number（200 字符大文本阈值、debounce 时间、相似度阈值等）→ 集中 `config/constants.js`。
- L11. `server/store-sqlite.js:369-388` `AUTHORITATIVE_STATE_KEYS` 包含 legacy 别名 → 文档化或清理。
- L12. 前端 IndexedDB 加载是 fire-and-forget → 等待加载完成再首次 render。

---

## 五、跨主题关联分析

### 5.1 性能问题的共同根因：以 state 为单一值
几乎所有 Critical/High 性能问题都源于一个模式：**把整个 `state` 当作一个值来 clone、serialize、upload、render**。这是 MVP 阶段“先跑通”的合理选择，但随着数据量增长已成为系统瓶颈。

**修复策略**：从“值语义”转向“实体语义”：
- 前端：只序列化 dirty 实体。
- 后端：只 upsert 变更的行，不再全表重写。
- 渲染：只更新变更的卡片。

### 5.2 安全问题的共同根因：文件系统边界校验不统一
`isPathInsideRoot` 已在下载和级联删除中正确使用，但未覆盖 `saveFile`、`deleteFile`、`getContractFolder`、`replaceDb` 文件记录导入。这属于“同一类修复没推广到所有入口”。

### 5.3 稳定性问题的共同根因：生命周期状态机不完整
Electron 的 `isStoppingBackend` / `isQuitting` 标志未能覆盖所有异步分支；后端 `isSyncing` 缺少超时和恢复；job 并发缺少真正的超时/取消。需要把“状态 + 超时 + 清理”三位一体补齐。

---

## 六、推荐修复路线图

### 第 1 周：止血（Critical + 高安全/稳定性）
1. 修复 `scripts/ai-runner-lib.js:481` 未定义 `end`。
2. 为 `deleteFile`、`saveFile`、`getContractFolder`、`replaceDb` 文件导入统一加 `isPathInsideRoot`。
3. `.api_token` 设为 `0o600`。
4. Electron `stopBackend` / `tryRestartBackend` 加 `isQuitting` 保护。
5. `replaceDb` 加进程内互斥锁并提升 busy timeout。
6. `flushBackendSync` 把 `lastSyncedSnapshot` 更新移到请求成功后。
7. `base-adapter`  honoring `timeoutMs`。

### 第 2-3 周：路径收敛（High + 关键 Medium）
1. 提升 `readJson` 限制或引入 multipart 流式上传。
2. `pruneOrphanedFiles` 移到事务提交后。
3. `/api/db/sync` 加请求超时和 `isSyncing` 释放。
4. `Store.setActiveContract()` 不再清掉 backend-health。
5. `unhandledRejection` 区分致命/可恢复。
6. `incrementalSync` 改为单事务或 tx 透传。
7. 备份目录权限 `0o700`。

### 第 4-6 周：架构升级（性能/可维护性）
1. 前端 dirty-entity 同步替代全量同步。
2. `rebuildSearchIndex` 增量更新。
3. `renderReview` 增量/虚拟化。
4. 合并重复 clause splitter / number converter。
5. 推进 `Store.mutate` 替代直接 `state` 写入。
6. 统一命名（updates/contractVersions、findings/reviewRecords）。

---

## 七、验证建议

每完成一组修复后，必须运行：

```bash
npm run check        # 包含新增的 data-* 和 listener guard
npm test             # 581 个测试全绿
npm run electron:smoke
```

新增问题修复后，应补充对应的测试或 guard，避免下一轮审计再次发现同类问题。
