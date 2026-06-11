# 第四轮审计修复记录

> 对应审计报告：`audit-fourth-pass-b886602-developer-stability-ux.md`
> 目标：修复 Critical / High / Medium / Low 中可在当前基线内安全落地的全部问题，并建立可自动回归的质量防线。

## 修复总览

| 轮次 | 类别 | 关键改动 | 验证方式 |
|------|------|----------|----------|
| P0/P1 | 后端稳定性 | `replaceDb` 错误降级、`unhandledRejection` 优雅关闭、`asarUnpack` 补全 | `npm test` |
| P0/P1 | 前端稳定性 | `pollLegalSkillJob` race、`Store.mutate` 深克隆优化、reader filter debounce | `npm test` |
| P0/P1 | 桌面端 | `stopBackend` 关闭期不再重启、Electron smoke 环境适配 | `npm run electron:smoke` |
| 剩余 | 安全 / XSS | 全量动态 `data-*` 属性 HTML 转义 | `npm run check` + guard |
| 剩余 | 性能 | `replaceDb` async 分批让出事件循环 | `npm test` |
| 剩余 | 工程体验 | 全局 listener 去重、LRU 缓存、macOS 行为、脚本硬编码 | `npm run check` |

---

## P0/P1 修复明细

### 后端

1. **`server/store-sqlite.js`**
   - 引入 `logger`，统一日志输出。
   - `replaceDb` COMMIT 后 `pruneOrphanedFiles` / `rebuildSearchIndex` 失败时降级为 warning，不再让已提交事务回滚报错。
   - `rebuildSearchIndex` 失败时显式抛出，避免静默跳过。
   - 导出 `runInTransaction` 供外部使用。

2. **`server/server.js`**
   - `unhandledRejection` 由直接 `process.exit(1)` 改为调用 `gracefulShutdown("unhandledRejection")`。

3. **`server/jobs.js`**
   - 增加模型级别的 cost rate map（moonshot / gpt-4o / kimi 等）。
   - diff review 时提前限制 `diffParts` 数量，并在使用后释放 `previous_text` 帮助 GC。

4. **`server/routes/handlers/legal-review.js`**
   - 创建分析任务失败时使用 `serverErrorPayload` 返回统一错误结构。

### 前端

5. **`js/api/core.js`**
   - `pollLegalSkillJob` 使用 `AbortController` map 防止竞态；取消旧轮询再启动新轮询。
   - `delay()` 支持 `AbortSignal`。
   - `buildIncrementalPayload()` 基于 dirty flag 生成增量同步 payload，避免大对象全量 `JSON.stringify`。

6. **`js/store.js`**
   - `Store.mutate` 对 `save:false` 或纯指针更新跳过昂贵深克隆。

7. **`js/render-review.js`**
   - 焦点恢复使用 `focus({ preventScroll: true })` 再手动恢复 scroll，减少跳动。
   - 动态 `data-*` 属性全部走 `escapeHtml` / `cssEscapeValue`。

8. **`js/events-document.js`**
   - reader clause filter 增加 200ms debounce，避免每次按键重渲染。

9. **`js/app-events.js`**
   - `dispatchGlobalClick` 改为 async 并用 try/catch 包裹，避免未捕获异常中断事件链。

10. **`js/timer-registry.js`**
    - 新增 `clearByPrefix(prefix)`，便于批量清理同组 timer。

### 桌面端 / 构建

11. **`electron/main.js`**
    - `backendProcess.on("close")` 增加 `isStoppingBackend` 判断，关闭期间不再触发重启。
    - `stopBackend` 轮询增加快速退出路径，避免已清理的引用导致超时等待。

12. **`package.json`**
    - `asarUnpack` 补全 `server/**/*`、`.so`、`.dylib`，确保生产环境能读取后端脚本和原生库。

13. **`scripts/electron-smoke.js`**
    - 启动 Electron 时显式清除 `ELECTRON_RUN_AS_NODE`，兼容 Kimi Code CLI 等以 Node 模式运行 Electron 的环境。

### 测试 / 开发效率

14. **`scripts/check-all.js`**
    - 排除 `tests/.tmp-*` 目录。
    - 对 `.json` 文件做 `JSON.parse` 校验。

15. **`tests/test-legal-skill-pure.js`**
    - `execFileSync` 增加 30s timeout。
    - `Promise.all(asyncTests)` 增加 `.catch()` 防止未处理拒绝。

16. **`scripts/manual-flow-check.js` / `scripts/test-layer3-frontend-e2e.js`**
    - 移除硬编码 Chrome 路径，改用 Playwright 管理的 Chromium。

17. **`playwright.config.js`**
    - 移除误导性的 `channel: "chromium"`。

18. **`scripts/regression-smoke.js`**
    - 更新对 `js/api/*.js` 拆分后的引用映射。

---

## 剩余问题修复明细

### 安全：动态 `data-*` 属性全量转义

扫描并修复了以下文件中所有动态 `data-*` 属性：

- `js/render-review.js`：补全 `data-analysis-request`、`data-run-clause-analysis` 的转义。
- `js/dashboard.js`：`data-open-clause`、`data-open-contract`、`data-view-target`、`data-open-update`、`data-update-contract`。
- `js/contract-library.js`：`data-contract-card`、`data-open-contract`、`data-open-progress`、`data-delete-contract`。
- `js/playbook.js`：`data-playbook-review`、`data-playbook-promote-variant`、`data-risk-rule-status`、`data-open-clause`。
- `js/review-risk.js`：`data-adopt-all-contract-risks`、`data-restore-contract-risk`、`data-adopt-contract-risk`、`data-reject-contract-risk`、`data-clause-advice-anchor`、`data-adopt-clause-risk`、`data-adjust-clause-risk`、`data-comment-clause-risk`、`data-business-confirm-clause-risk`、`data-reject-clause-risk`。
- `js/review-tree.js`：`data-toggle-tree-node`。

### 性能：`replaceDb` 异步分批

- `server/store-sqlite.js`
  - `replaceDb` 改为 `async`。
  - 新增 `REPLACE_DB_BATCH_SIZE = 200` 与 `batchRun()`，在单事务内每 200 行 `setImmediate` 让出一次事件循环，缓解后端冻结。
  - 各表插入循环全部改为 `await batchRun(...)`。
- `server/routes/handlers/system.js`：调用处改为 `await replaceDb(snapshot)`。
- `scripts/split-server.py`：生成代码中的调用处同步改为 `await`。
- `tests/test-server-store.js`：测试框架改为串行队列（`testQueue` + `runAllTests`），正确 await async 测试，避免事务嵌套/锁表。

### 状态管理：减少深克隆开销

- `js/store.js`
  - 默认不再深克隆整个 state。
  - 仅在 `options.rollback === true` 时才捕获深克隆快照用于失败回滚。
  - 仍通过 `{ ...state }` 浅拷贝约束 updater。

### 全局 listener 去重

以下模块改为“先 remove 再 add”，避免热重载/测试重复注册：

- `js/app-events.js`
- `js/events-document.js`
- `js/events-draft.js`
- `js/electron-bridge.js`
- `js/search.js`

所有 attach 函数均兼容测试 mock 环境（先判断 `removeEventListener/addEventListener` 是否存在）。

### 其它 Low 优先级修复

- `js/word-docx.js`：`uploadedFileCache` 由 FIFO 改为 LRU；命中时刷新 Map 顺序，满时驱逐最旧条目。
- `electron/main.js`：macOS `window-all-closed` 不再调用 `quitApp()`，保持应用存活。
- `scripts/setup-windows.ps1`：通过 `Get-Command npm` 动态定位 npm，移除硬编码 `npm.cmd`。
- `scripts/portable-smoke.js`：`cleanup` 统一 `clearTimeout(timeout)`；timeout 使用 `unref()`；所有退出路径调用 `cleanup`。

---

## 新增质量防线

为防止上述问题回潮，新增两条轻量 guard 并接入 `npm run check`：

1. **`scripts/guard-data-attrs.js`**：扫描 `js/` 下所有动态 `data-*="${...}"` 是否被 `escapeHtml(...)` 包裹，未转义则报错。
2. **`scripts/guard-listeners.js`**：扫描 `js/` 下顶层直接调用 `document.addEventListener` / `window.addEventListener` 的位置，要求同一文件内存在对应的 `removeEventListener`，或已被 `attachXxxListeners` 包装函数包裹。

---

## 验证结果

- `npm run check`：通过
- `npm test`：**581 / 581 全部通过**
- `npm run electron:smoke`：通过

---

## 后续建议

1. 下一轮审计问题数若降到 10 个以内且无 Critical/High，即可停止“审计-全改”模式，转入伴随式 review。
2. 继续把高频问题沉淀为 guard / lint / 测试，而不是靠人工反复扫描。
3. 对 `store-sqlite.js` 可规划一次架构级重构：逐步让前端默认走 incremental sync，仅首次加载/恢复/强制刷新才调用 `replaceDb`。
