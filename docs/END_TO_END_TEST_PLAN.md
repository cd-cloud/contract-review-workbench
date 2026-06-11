# 合同审阅工作台 — 端到端手动测试方案

> 版本：v1.0  
> 日期：2026-06-11  
> 适用范围：本次审计修复（commit `f3bed86`）后的全功能验证  
> 作者：AI Agent (third audit pass)

---

## 1. 概述

本文档为 **contract-review-workbench** 提供一套可执行的手动端到端（E2E）测试方案，覆盖：

- **核心主链路**：从新建审阅到导出交付物的完整闭环
- **7大功能域**：工作台总览、合同管理、审阅台、起草台、条款库、相对方、Electron桌面端
- **AI 层**：Agent A（法律审阅）、Agent B（Visual QA）、fallback 降级
- **新增/修复点**：schema 验证、TimerRegistry、深克隆、CSRF、Web Worker DOCX 解析、compact 改进等

**目标**：在无法完全自动化 UI 交互的场景下，通过结构化手动步骤确保所有用户可见功能正确运作。

---

## 2. 环境准备

| 项目 | 要求 |
|------|------|
| Node.js | v22.x |
| 操作系统 | Windows 10/11（主要目标）、macOS（辅助） |
| AI Provider | 至少配置以下之一：OpenAI-compatible API Key / Codex CLI / Kimi CLI |
| 测试文件 | `tests/fixtures/` 下的 `.docx` 合同模板（至少2份不同相对方） |
| 浏览器 | Electron 内置 Chromium（无需外置浏览器） |
| 网络 | 可访问配置的 AI Provider 端点 |

**启动方式**：
```bash
# 开发模式
npm run start

# 便携模式（Windows）
npm run dist:portable
# 然后运行 dist/contract-review-workbench-x.y.z.exe
```

---

## 3. 测试策略

- **P0（阻塞级）**：主链路中断即无法发布。必须全部通过。
- **P1（重要）**：高频功能，失败会严重影响用户体验。
- **P2（一般）**：边缘场景或低频功能，可记录为已知问题。
- **每轮测试标记**：通过 ✓ / 失败 ✗ / 跳过 — / 不适用 N/A

---

## 4. 核心主链路测试（P0）

> 此链路模拟真实律师用户从拿到合同到出具审阅意见的全流程。

### TC-MAIN-01 完整审阅闭环

| 属性 | 内容 |
|------|------|
| **优先级** | P0 |
| **预估耗时** | 8–15 分钟（取决于 AI 响应速度） |
| **前置条件** | 应用已启动；至少一个 AI Provider 可用；存在测试用 `.docx` 文件 |

**操作步骤**：

1. 点击「新建审阅」按钮，进入合同上传页
2. 点击上传区域，选择一份测试 `.docx` 合同（含标题、正文、签署页）
3. 等待 DOCX 解析完成，确认：
   - 合同标题正确提取
   - 条款列表非空且编号正确
   - **Web Worker 解析**：主线程无卡顿（观察无 "页面无响应" 提示）
4. 填写 intake 表单（相对方名称、合同类型、风险等级偏好）
5. 点击「开始审阅」，触发 Agent A
6. 等待 Agent A 完成：
   - 状态指示器从「分析中」变为「完成」
   - 审阅台左侧显示条款列表，右侧显示审阅意见
   - 高风险条款有醒目标识
7. 观察 fallback 机制（如配置了降级 provider）：
   - 若主 provider 超时，自动切换并提示用户
8. 模拟 Visual QA（Agent B）：
   - 触发自动修复，确认 toast 提示「已应用 X 项修复」
   - 检查修改已同步到审阅状态（Store.mutate 路径）
9. 在审阅台中：
   - 点击某条款的「采纳建议」
   - 点击某条款的「忽略」
   - 手动添加一条批注
10. 点击「导出 Word」，选择导出路径
11. 打开导出的 `.docx`，确认：
    - 原始合同内容完整
    - 审阅批注以批注形式嵌入（或按实现方式呈现）
    - 采纳的修改已体现
12. 返回工作台，确认合同卡片状态为「已审阅」
13. 点击「备份」按钮，确认备份文件生成
14. 关闭应用，重新启动
15. 确认上次审阅的合同状态、批注、采纳记录全部恢复

**预期结果**：所有步骤无报错，状态持久化正确，导出文件内容完整。

**验证重点**（对应本次修复）：
- [ ] DOCX 解析在 Worker 中运行，无 UI 冻结
- [ ] `TimerRegistry` — 切换视图后旧轮询/定时器已清理（ DevTools Console 无 `setInterval` 泄漏警告）
- [ ] `Store.mutate()` — 采纳/忽略操作后其他合同状态未被污染
- [ ] `applyVisualQaAutoFixes()` — 通过 `Store.mutate` 修改状态，非直接改对象
- [ ] 导出后 `reviewAdviceSync` 定时器已清理（切换合同后无残留同步）

---

## 5. 功能域测试用例

### 5.1 工作台总览（Dashboard）

| ID | 名称 | 优先级 | 步骤 | 预期结果 |
|----|------|--------|------|----------|
| TC-DASH-01 | 合同列表加载 | P0 | 启动应用，进入工作台 | 合同卡片按时间倒序排列，状态标签正确 |
| TC-DASH-02 | 搜索过滤 | P1 | 在搜索框输入相对方名称关键字 | 列表实时过滤，150ms debounce 无卡顿 |
| TC-DASH-03 | 状态筛选 | P1 | 点击「待审阅」/「已审阅」筛选标签 | 仅显示对应状态合同 |
| TC-DASH-04 | 快速新建 | P1 | 点击「+ 新建审阅」 | 进入合同上传页，无状态残留 |
| TC-DASH-05 | 数据持久化 | P1 | 添加批注 → 刷新页面 | 批注仍在，localStorage 通过 `saveState()` 写入 |

### 5.2 合同管理（Contract Management）

| ID | 名称 | 优先级 | 步骤 | 预期结果 |
|----|------|--------|------|----------|
| TC-CONT-01 | 合同上传 | P0 | 上传 `.docx` | 解析成功，条款树正确 |
| TC-CONT-02 | 合同删除 | P1 | 删除一个合同 | 确认对话框 → 删除 → 列表更新，localStorage 同步 |
| TC-CONT-03 | 合同重命名 | P1 | 修改合同标题 | 标题保存，卡片同步更新 |
| TC-CONT-04 | 多合同切换 | P1 | 打开合同A → 打开合同B → 回到A | A 的审阅状态和滚动位置恢复；B 的定时器已清理 |
| TC-CONT-05 | 日期解析 | P2 | 上传含签署日期的合同 | 日期正确显示，非法日期（如 "尽快"）显示为「未设置」而非 NaN |
| TC-CONT-06 | 缓存一致性 | P1 | 同一合同重复上传 | `splitVersionClauses()` 缓存键含 hash，不碰撞 |

### 5.3 审阅台（Review Console）

| ID | 名称 | 优先级 | 步骤 | 预期结果 |
|----|------|--------|------|----------|
| TC-REV-01 | Agent A 触发 | P0 | 点击「开始审阅」 | 状态轮询正常，完成后意见渲染 |
| TC-REV-02 | 条款级操作 | P0 | 采纳/忽略/批注 | 操作即时生效，状态持久化 |
| TC-REV-03 | 滚动同步 | P1 | 在左侧条款树滚动 | 右侧审阅意见自动同步高亮对应条款 |
| TC-REV-04 | 风险等级过滤 | P1 | 筛选「仅看高风险」 | 仅显示 high risk 条款 |
| TC-REV-05 | 异步安全 | P1 | 快速切换合同同时审阅进行中 | 旧合同的审阅结果不渲染到新合同（`assertStillActive` 守卫） |
| TC-REV-06 | 状态回滚 | P1 | 触发异常操作（如手动抛错） | `Store.mutate()` catch 块回滚到 prevState，UI 不进入不一致状态 |
| TC-REV-07 | 审阅结果 schema 验证 | P1 | Agent A 返回异常 JSON | `validateAgainstSchema` 捕获并展示友好错误，不崩溃 |

### 5.4 起草台（Drafting Console）

| ID | 名称 | 优先级 | 步骤 | 预期结果 |
|----|------|--------|------|----------|
| TC-DRAFT-01 | 从模板起草 | P1 | 选择条款模板 → 填充变量 | 生成新合同草案 |
| TC-DRAFT-02 | 插入条款 | P1 | 从条款库插入一条标准条款 | 条款插入到正确位置，格式保留 |
| TC-DRAFT-03 | 实时保存 | P1 | 修改草案内容 | autosave 触发（延迟 800ms，非 180ms），无频繁保存提示 |

### 5.5 条款库（Clause Library）

| ID | 名称 | 优先级 | 步骤 | 预期结果 |
|----|------|--------|------|----------|
| TC-CLAUSE-01 | 浏览条款 | P1 | 进入条款库页 | 分类树加载正常，条款卡片显示标题、风险等级、适用场景 |
| TC-CLAUSE-02 | 搜索条款 | P1 | 搜索「保密」 | 返回含「保密」的条款，支持模糊匹配 |
| TC-CLAUSE-03 | 收藏条款 | P2 | 点击收藏图标 | 收藏状态切换，个人收藏列表更新 |

### 5.6 相对方（Counterparties）

| ID | 名称 | 优先级 | 步骤 | 预期结果 |
|----|------|--------|------|----------|
| TC-CP-01 | 相对方列表 | P1 | 进入相对方页 | 列表加载，显示交易次数、最近合同 |
| TC-CP-02 | 搜索相对方 | P1 | 在搜索框快速输入（模拟连续击键） | 150ms debounce，无输入卡顿；结果正确过滤 |
| TC-CP-03 | 相对方详情 | P1 | 点击相对方卡片 | 侧滑/跳转详情页，显示历史合同、风险画像 |
| TC-CP-04 | 缓存性能 | P2 | 多次切换相对方视图 | `WeakMap` 缓存生效，`buildCounterpartyProfile` 不重复计算 |

### 5.7 Electron 桌面端

| ID | 名称 | 优先级 | 步骤 | 预期结果 |
|----|------|--------|------|----------|
| TC-ELEC-01 | 应用启动 | P0 | 双击 `.exe` 或 `npm run start` | 窗口打开，后端服务启动，无白屏 |
| TC-ELEC-02 | 后端生命周期 | P0 | 关闭主窗口 | 后端进程正确退出，端口释放 |
| TC-ELEC-03 | 便携模式启动 | P1 | 运行便携版 `.exe` | 自解压后端脚本，health check 通过后再加载前端 |
| TC-ELEC-04 | 后端脚本缺失处理 | P1 | 模拟删除 `resources/app/server/server.js` | 弹出错误对话框「后端脚本不存在」，应用退出而非白屏 |
| TC-ELEC-05 | 打包后 asar | P1 | 检查 `resources/app.asar` 存在 | 源码不暴露，`asar: true` 生效 |
| TC-ELEC-06 | 运行时环境变量隔离 | P1 | 设置 `ELECTRON_RUN_AS_NODE=1` 后启动 | 应用正常启动，`applySelectedRuntimeProfile` 使用临时 env 不污染全局 |

### 5.8 AI 层（AI Layer）

| ID | 名称 | 优先级 | 步骤 | 预期结果 |
|----|------|--------|------|----------|
| TC-AI-01 | Agent A 正常审阅 | P0 | 选择 healthy provider，上传合同 | JSON 输出通过 schema 验证，意见结构化展示 |
| TC-AI-02 | Agent A fallback | P1 | 配置主 provider 为无效端点 | 超时后自动降级到备用 provider，提示用户 |
| TC-AI-03 | Agent B Visual QA | P1 | 触发自动修复 | 修复项匹配本地建议，`Store.mutate` 应用；0 匹配时正确记录审计日志 |
| TC-AI-04 | Provider 自动选择 | P1 | 不指定 provider，启动审阅 | 按优先级选择：ready API > Codex CLI > Kimi CLI > fallback |
| TC-AI-05 | 长文本截断 | P1 | 上传超长合同（>120K 字符） | `compact()` 保留前 60% + 后 40%，尾部关键条款不丢失，JSON 结构合法 |
| TC-AI-06 | Schema 验证失败 | P1 | 模拟返回缺失必填字段的 JSON | `validateAgainstSchema` 抛出清晰错误，前端显示「AI 输出格式异常」toast |
| TC-AI-07 | Polling 清理 | P1 | 开始审阅后快速取消/切换 | `pollControllers` abort 旧请求，无残留 HTTP 连接 |

### 5.9 导出层（Export Layer）

| ID | 名称 | 优先级 | 步骤 | 预期结果 |
|----|------|--------|------|----------|
| TC-EXP-01 | 导出 Word | P0 | 审阅完成后点击「导出 Word」 | `.docx` 文件生成，内容完整，批注嵌入 |
| TC-EXP-02 | 导出 PDF | P1 | 点击「导出 PDF」（如有实现） | PDF 生成，格式正确 |
| TC-EXP-03 | 导出备份 | P1 | 点击「备份」 | 备份文件含完整 state，可用于恢复 |

### 5.10 系统管理（System & Security）

| ID | 名称 | 优先级 | 步骤 | 预期结果 |
|----|------|--------|------|----------|
| TC-SEC-01 | CSRF 防护 | P1 | 用 `curl` 不带 `X-Requested-With` 访问 API | 返回 401/403，`isAuthorizedApiRequest` 拦截 |
| TC-SEC-02 | CSRF 正常请求 | P1 | 应用内正常操作 | `legalWorkbenchFetch` 自动携带 header，请求通过 |
| TC-SEC-03 | Session Cookie | P1 | 登录后检查 cookie | `SameSite=Strict`，`HttpOnly`（如适用） |
| TC-STOR-01 | localStorage 一致性 | P1 | 任意操作后检查 `localStorage` | 所有写入通过 `saveState()`，无直接 `setItem` 绕过 |
| TC-STOR-02 | State 不可变性 | P1 | 在 console 执行 `state.findings.push({})` | 由于 `structuredClone` 回滚机制，异常操作不污染持久状态 |

---

## 6. 回归测试清单

以下场景在每次代码变更后应快速验证：

- [ ] **启动**：dev 模式 / 便携模式均能启动
- [ ] **上传**：`.docx` 解析正确，Worker 不卡 UI
- [ ] **审阅**：Agent A 完成一次完整审阅
- [ ] **操作**：采纳 + 忽略 + 批注各一次
- [ ] **切换**：合同 A → B → A，状态正确
- [ ] **导出**：Word 导出内容完整
- [ ] **重启**：关闭后重启，数据恢复
- [ ] **安全**：CSRF header 检查生效

---

## 7. 已知限制与注意事项

1. **AI Provider 依赖**：Agent A/B 测试需要真实 AI 响应，建议准备一份「短合同模板」控制耗时。
2. **Windows 为主**：便携模式测试仅限 Windows；macOS 请使用 dev 模式。
3. ** better-sqlite3**：首次启动若遇原生模块加载失败，需运行 `npm run rebuild`。
4. **长文本**：`compact()` 虽保留尾部，但超长合同仍可能因 AI 上下文限制被截断，属于预期行为。
5. **TimerRegistry**：DevTools Performance 面板可验证定时器泄漏，但手动测试主要通过「切换合同后功能正常」间接验证。
6. **Web Worker**：如浏览器安全策略阻止 Worker 加载，会 fallback 到主线程解析，测试时应确认 Worker 路径 `./js/workers/docx-parser.worker.js` 可访问。

---

## 8. 测试记录模板

每轮测试后填写：

```markdown
| 轮次 | 日期 | 测试人 | 环境 | P0通过 | P1通过 | P2通过 | 失败ID | 备注 |
|------|------|--------|------|--------|--------|--------|--------|------|
| R1 | 2026-06-11 | — | Win11, Node22 | 12/12 | 25/25 | 8/8 | 无 | 基线测试 |
```

---

## 9. 附录：快速问题定位

| 现象 | 可能原因 | 排查方向 |
|------|----------|----------|
| 启动白屏 | 后端未启动 / 脚本缺失 | 检查 `server/server.js` 是否存在，端口是否占用 |
| DOCX 解析卡死 | Worker 加载失败 fallback 主线程 | DevTools Network 面板检查 worker 文件 404 |
| 审阅结果不显示 | AI Provider 不可用 / schema 验证失败 | Console 查看 `runJsonTask` 错误，检查 schema 路径 |
| 切换合同状态错乱 | `Store.mutate()` 回滚或 `assertStillActive` | 检查 Console 是否有 mutation error |
| 搜索/输入卡顿 | debounce 未生效或缓存失效 | 检查 `filterCounterpartiesTimer` 和 `WeakMap` |
| Toast 不消失 | DOM 未清理 | 检查 `showToast` 的 `setTimeout` 回调是否执行 |
| 定时器泄漏 | `TimerRegistry.clearAll()` 未调用 | 切换视图前后对比 `TimerRegistry.timers.size` |

---

*本文档随代码迭代更新。如有新功能域或重大重构，应同步补充测试用例。*
