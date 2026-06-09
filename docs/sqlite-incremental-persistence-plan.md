# SQLite 增量持久化方案

日期：2026-06-09

## 背景

当前 `server/store-sqlite.js` 已经把主数据迁到 SQLite，但写入策略仍然是“结构化全量替换”：

- `replaceDb(snapshot)` 会先规范化快照，再清空 `contracts`、`contract_versions`、`clauses`、`findings`、`clause_actions`、`counterparties`、`negotiations`、`playbooks`、`risk_rules`、`audit_logs`、`users` 等表，然后整表重写。
- `app_state.frontend_state` 用于保存非权威的前端辅助状态。
- `readDb()` 依旧返回完整快照，因此前端调用方无需感知 SQLite 细节。

这个方案已经比 JSON 文件稳定，但仍有三个问题：

1. 小改动成本过高。采纳一条建议、改一个条款、追加一条审计日志，都会触发整库重写。
2. 崩溃恢复边界不够细。虽然事务能保证单次 `replaceDb()` 原子性，但无法区分“合同正文变了”和“仅 UI 辅助状态变了”。
3. 并发扩展受限。后续若引入更多后台任务、自动备份、异步 Agent 写回，整库替换更容易造成锁争用和回归。

## 设计目标

1. 保持现有 `readDb()` 兼容，前端本轮不强制改协议。
2. 把“权威业务实体”和“辅助 UI 状态”分层写入。
3. 优先覆盖高频写路径，不一次性重写所有存储接口。
4. 继续保留 `replaceDb()` 作为导入/恢复/全量同步兜底能力。

## 数据分层

建议把写入对象分成三层：

### A. 权威主实体，优先做增量

- `contracts`
- `contract_versions`
- `clauses`
- `findings`
- `clause_actions`
- `files`
- `counterparties`
- `playbooks`
- `risk_rules`
- `negotiations`

这些表已经结构化，适合 `upsert/delete`。

### B. 顺序型事件流，改为追加写

- `audit_logs`
- 后续如需增加 `job_runs`、`provider_calls`、`exports` 也建议单独建表

这类数据不应跟着整库重写，应以 append-only 为主。

### C. 辅助前端状态，继续保留 `app_state`

- `activeContractId`
- `activeUpdateId`
- `reviewMode`
- `visualQaReports`
- `visualQaJobs`
- `readerFilters`
- `runnerDiagnostics`
- 其他纯 UI/会话态

这部分继续按 key 或小块 JSON 落在 `app_state`，不与权威实体混写。

## 建议落地接口

第一阶段不改前端协议，只在后端新增内部接口：

- `upsertContract(contract)`
- `upsertContractVersion(version)`
- `replaceContractClauses(contractId, versionId, clauses)`
- `replaceContractFindings(contractId, findings)`
- `replaceClauseActions(sourceKey, clauseMap)`
- `appendAuditLog(entry)`
- `patchAuxState(partialState)`
- `deleteContractCascade(contractId)`

设计原则：

- 合同主档按 `contract.id` upsert。
- 版本按 `version.id` upsert，不再依赖整库重写。
- 条款、findings、clauseActions 以“合同或 sourceKey 维度的局部 replace”为主，因为这几类数据在一次审阅完成后通常需要整组替换。
- 审计日志改为只追加，不再由 `replaceDb()` 重放。
- `rebuildSearchIndex()` 从“整表重建”逐步改成“按合同/条款/发现局部刷新”。

## 优先改造顺序

### 第 1 步：抽出写入仓储层

从 `replaceDb()` 中抽出可复用的表级写函数：

- `writeContractsTx`
- `writeVersionsTx`
- `writeClausesTx`
- `writeFindingsTx`
- `writeClauseActionsTx`
- `writePlaybooksTx`

目标是先把“整库重写逻辑”拆成“可局部调用的事务片段”。

### 第 2 步：替换高频链路

优先把以下调用从整库同步改成局部写：

1. 新建合同/新建版本
2. Agent A 审阅结果落库
3. 采纳/拒绝条款建议
4. 条款拖拽重排
5. 终稿沉淀到 playbook

这些是当前最常见、最容易把整库放大的路径。

### 第 3 步：把审计与辅助状态拆开

- `recordAudit()` 直接写 `audit_logs`
- `saveState()` 分成：
  - `saveStructuredState()` 只在必要时写权威实体
  - `saveAuxState()` 只更新 `app_state.frontend_state`

### 第 4 步：保留兜底

以下场景继续允许走 `replaceDb()`：

- 全量导入旧快照
- 从备份恢复
- 桌面端“同步到本地后端”
- 开发期修复性重建

## 与当前前端的兼容策略

本项目当前前端大量代码仍假设“内存 state 是单体对象”。因此本轮不建议直接改前端状态模型，而是采用：

1. 前端继续传完整对象或局部对象给既有 API。
2. 后端在路由层识别操作类型，转成局部仓储写入。
3. `readDb()` 继续返回完整快照，保证页面初始化和备份逻辑不变。

这样可以先降低写放大和回归风险，再考虑后续前端状态进一步拆层。

## 风险点

1. `clause_actions`、`findings`、`clauses` 之间存在合同/版本耦合，局部写时要防止“版本已更新但 findings 还是旧的”。
2. `removeArchivedFilesForSnapshot()` 目前依赖全量有效 ID 集合；做增量后需要改成基于合同/版本粒度的清理。
3. 搜索索引现在是整表重建；若不先拆出来，增量持久化收益会被 `rebuildSearchIndex()` 抵消。
4. `app_state.frontend_state` 仍可能过大，后续应考虑把 `visualQaReports`、`runnerDiagnostics` 等再拆成独立 key。

## 本阶段完成标准

这份设计稿对应 `TODO 4.1` 的“先有设计稿”要求。下一轮代码实现建议以如下标准验收：

1. 至少一条高频链路不再调用整库 `replaceDb()`。
2. 审计日志改为 append-only。
3. 局部更新后，`readDb()` 输出与当前前端兼容。
4. 搜索索引至少支持按合同局部重建，而不是每次全量重建。
