# 修复验证报告 (d4646aa) — 开发者个人使用视角

> 审计日期：2026-06-09  
> 审计范围：4 commits (727f67e → d4646aa) 对上一轮 4 CRITICAL + 7 HIGH 问题的修复  
> 视角调整：单用户/本地开发者自用场景，XSS/注入/DoS 等"防范用户恶意操作"类问题优先级降低

---

## 一、4 CRITICAL 修复验证 — 全部确认修复 ✅

| # | 问题 | 修复状态 | 验证依据 |
|---|------|---------|---------|
| C1 | `files` 表在 `replaceDb` 中被 CASCADE 删除且未恢复 | ✅ **已修复** | `replaceDb()` 禁用 FK → 手动 DELETE → 从 snapshot 重新 INSERT `files`；`AUTHORITATIVE_STATE_KEYS` 已包含 `files` |
| C2 | `job.__child` 未赋值 → 取消按钮无效 | ✅ **已修复** | `runConfiguredSkillCommand` 暴露 `onChild(child)`；`executeAnalysisJob` 存储 `current.__child = child`；`terminateJobChild` 调用 `child.kill()` |
| C3 | `withTimeout` 拒绝但不杀子进程 → 僵尸进程 | ✅ **已修复** | `catch` 块检测 timeout 正则 → `abort()` + `terminateJobChild(current)`；`finally` 设置 `current.__child = null` |
| C4 | `contract.id` 未消毒 → 路径遍历 + 任意删除 | ✅ **已修复** | `ensureContractFolder` 用 `[^a-zA-Z0-9._-]` 清理 `id`；`isPathInsideRoot` 二次校验；`deleteContractCascade` 同样校验 |

**结论：4 个 CRITICAL 全部修复到位，数据完整性、进程管理、路径安全均已闭环。**

---

## 二、HIGH 问题修复验证

| # | 问题 | 修复状态 | 开发者角度评估 |
|---|------|---------|--------------|
| H1 | 缓存键不完整（缺少 `previousText`/`clauses`） | ✅ **已修复** | `_makeKey` 已纳入 `previousText` 和 `clauses` 数组 |
| H2 | 下载路径未验证 | ✅ **已修复** | `isPathInsideRoot(WORKBENCH_ROOT, file.path)` 前置校验 |
| H3 | 文件流错误未处理 | ✅ **已修复** | `stream.on("error")` 已附加，500 响应或 `res.destroy()` |
| H7 | Fallback 管辖权硬编码 | ✅ **已修复** | `buildFallbackSuggestedClauseText` 读取 `request.governing_law \|\| request.jurisdiction` |
| H4 | `data-*` XSS | ⚠️ **部分修复** | 大部分已 `escapeHtml()`，但 `render-review.js:276` `data-run-legal-skill="${contract.id}"` 仍未转义。**开发者自用 → 优先级极低** |
| H5 | FTS5 查询注入 | ❌ **未修复** | `search()` 仍只替换 `"`；`(` `)` `NOT` `OR` `-` 未处理。**开发者自用 → 优先级极低** |
| **H6** | **`restoreBackupToDirectory` 覆盖打开的数据库** | ❌ **未修复** | **开发者自用 → 优先级高（唯一可能导致数据丢失）** |

---

## 三、开发者视角下的核心残余风险（重新排序）

### 🔴 高优先级：数据损坏 + 资源泄漏

#### 1. `restoreBackupToDirectory` 覆盖打开的数据库 — **HIGH，未修复**

```javascript
// server/store-sqlite.js:1423
function restoreBackupToDirectory(backupPath, targetRoot) {
  // ...
  fs.copyFileSync(backupDbPath, path.join(targetDataDir, "workbench.sqlite"));
  // 没有关闭数据库连接！
}
```

**风险：** 恢复备份时，`better-sqlite3` 可能仍持有 WAL 文件句柄。`fs.copyFileSync` 在 Windows 上极可能触发 `EBUSY` 或导致 WAL 与主库不一致，最终数据库损坏。

**影响：** 这是目前唯一可能导致**数据永久丢失**的操作。开发者日常使用备份恢复功能时直接触发。

**修复建议：**
```javascript
function restoreBackupToDirectory(backupPath, targetRoot) {
  // 1. 关闭数据库连接（调用方需先 closeDb()）
  // 2. copyFileSync
  // 3. 重新打开连接
}
```

---

#### 2. `runCodexJsonTask` 临时文件泄漏 — **HIGH，未修复**

```javascript
// scripts/ai-runner-lib.js:377
function runCodexJsonTask({ prompt, schemaPath, outputPrefix, signal }) {
  const outputFile = path.join(os.tmpdir(), `${outputPrefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  // ...spawn codex...
  const finalText = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : stdout;
  // ❌ 永不删除 outputFile
}
```

**风险：** 每次 AI 分析调用都泄漏一个 JSON 临时文件到 `os.tmpdir()`。长期使用（每天分析 10-20 份合同）会在 `%TEMP%` 累积数千个文件。

**影响：** 磁盘空间缓慢泄漏；Windows 临时目录清理机制可能滞后数月。

**修复建议：** `finally` 或 `child.on("close")` 末尾加 `fs.unlinkSync(outputFile)`。

---

#### 3. 分块分析串行执行 — **MEDIUM → 开发者角度 HIGH**

```javascript
// server/legal-skill-adapter.js:297
for (let index = 0; index < requests.length; index += 1) {
  chunkResults.push(await runChunkWithRetry(
    () => runConfiguredSkillCommand(chunkRequest, options, runnerConfig),
    { signal: options.signal }
  ));
}
```

**风险：** 所有 chunk 串行执行。一份 400 条款的大合同可能需要 5-8 个 chunk，每个 chunk 30-60 秒，总耗时 3-8 分钟。

**影响：** 开发者日常处理大合同时等待时间极长，且无并发控制杠杆可调。

**修复建议：** 增加 `MAX_CHUNK_CONCURRENCY`（默认 2-3），用 `Promise.allSettled` 并行执行，兼顾 API 速率限制和速度。

---

### 🟡 中优先级：功能异常 + 架构债务

#### 4. `rebuildSearchIndex` 事务外运行 — **MEDIUM，未修复**

```javascript
// server/store-sqlite.js:889-899
tx();                       // 数据事务提交
runWalCheckpoint("PASSIVE");
pruneOrphanedFiles(...);
const structuredSnapshot = assembleStructuredSnapshot();
rebuildSearchIndex(structuredSnapshot);   // ❌ 不在事务中，失败只 console.error
```

**风险：** 如果 `rebuildSearchIndex` 失败（如 FTS5 表损坏），数据库数据已提交但搜索索引为空。用户无法搜索任何内容，且没有自动重试机制。

**影响：** 开发者替换数据库后搜索功能突然失效，需手动触发重建或重启。

**修复建议：** 将 `rebuildSearchIndex` 纳入 `tx()` 事务，或在失败时写入 `search_index_status` 标记并下次启动时重试。

---

#### 5. `Store.mutate` 直接 mutation — **MEDIUM，未修复**

```javascript
// js/store.js
const Store = {
  mutate(action, updater, options = {}) {
    if (typeof updater === "function") updater(state);  // 直接修改全局 state
    if (options.save !== false) saveState();
    return state;
  }
};
```

**风险：** `updater(state)` 直接修改全局对象，没有结构克隆或 copy-on-write。多处组件可能持有旧引用，导致 UI 状态不一致（如侧边栏与主面板显示不同数据）。

**影响：** 偶发的 UI 不同步 bug，开发者自行调试时难以定位。

**修复建议：** 最小改动：`const next = { ...state }; updater(next); state = next;` 或引入 Immer。

---

#### 6. `renderReview` 全量 innerHTML 重建 — **MEDIUM → 开发者角度 MEDIUM**

```javascript
// js/render-review.js:18
function renderReview() {
  // ...
  views.review.innerHTML = `
    <div class="review-grid">
      ${renderReviewTopTools(...)}
      <section class="review-main">...</section>
    </div>
  `;
}
```

**风险：** 每次状态变更都销毁并重建整个 DOM 树，事件监听器全部丢失，滚动位置重置，输入框焦点丢失。

**影响：** 大合同时渲染卡顿明显（>1000 条款时 DOM 操作耗时数百毫秒）。

**修复建议：** 长期应迁移到虚拟 DOM 或细粒度更新；短期可先用 `DocumentFragment` + `diff` 减少重排。

---

### 🟢 低优先级：可接受或可延迟

| # | 问题 | 状态 | 开发者角度说明 |
|---|------|------|--------------|
| 7 | `uploadedFileCache` 无界 | 未修复 | 浏览器端 Map，刷新页面即清空。长期打开可能占内存，但影响可控。 |
| 8 | `pruneOrphanedFiles` / `removeArchivedFilesForSnapshot` 重复 | 未修复 | 纯代码质量，功能无风险。 |
| 9 | `sendStaticFile` 读整个文件到内存 | 未修复 | 开发者自用文件通常 < 10MB，影响可忽略。 |
| 10 | `readJson` 字符串累积 | 未修复 | 有 20MB 上限保护，开发者场景足够。 |
| 11 | `applySelectedRuntimeProfile` 无 try/finally | 未修复 | `configureRunnerProfile` 不抛异常，实际风险极低。 |
| 12 | `runAutoBackup` 保留竞争条件 | 未修复 | 单用户场景几乎不可能触发并发备份。 |
| 13 | 队列大小无限制 | 未修复 | 开发者不会无限创建任务；`MAX_ANALYSIS_JOBS=2` 已限制并发。 |
| 14 | Electron IPC dialog options 未验证 | 未修复 | 自己不会攻击自己。 |
| 15 | H4/H5 XSS/FTS5 注入 | 部分/未修复 | 单用户场景无恶意输入来源。 |

---

## 四、修复建议优先级（开发者自用）

| 优先级 | 问题 | 修复工作量 | 收益 |
|--------|------|-----------|------|
| **P0** | `restoreBackupToDirectory` 关闭数据库连接后再复制 | 小（加一行 `closeDb()`） | **避免数据损坏** |
| **P0** | `runCodexJsonTask` 删除临时文件 | 极小（加 `fs.unlinkSync`） | **避免磁盘泄漏** |
| **P1** | 分块分析并发执行 | 中（加并发控制 + 错误聚合） | **大合同分析速度提升 2-3x** |
| **P1** | `rebuildSearchIndex` 纳入事务或失败重试 | 小 | **搜索功能可靠性** |
| **P2** | `Store.mutate` 引入浅拷贝 | 小 | **减少 UI 状态不同步 bug** |
| **P2** | `renderReview` 增量更新 | 大 | **大合同渲染流畅度** |
| **P3** | 其余低优先级问题 | - | 可长期搁置 |

---

## 五、总体结论

**4 CRITICAL + 大部分 HIGH 已修复，系统核心安全架构已稳固。**

从**开发者个人使用**角度，当前唯一需要立即处理的是 **`restoreBackupToDirectory` 的数据库覆盖问题**（可能导致数据损坏）和 **`runCodexJsonTask` 的临时文件泄漏**（长期资源泄漏）。其余问题要么是纯性能优化（分块并发、render 增量更新），要么是单用户场景下实际风险极低的边缘情况（XSS、注入、队列限制等）。

建议下一轮集中解决 **P0 + P1** 的 4 个问题，即可将系统推向高度可用的个人生产工具状态。
