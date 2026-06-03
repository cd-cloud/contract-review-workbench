# 代码架构审查记录

日期：2026-05-23

## 当前模块分工

- `index.html`：页面骨架、弹窗、脚本加载顺序。
- `styles.css`：全局布局、审阅台、合同库、条款卡片、响应式样式。
- `app.js`：应用入口、页面切换、全局事件绑定、表单提交、合同/版本创建、fallback 分析入口。
- `js/utils.js`：通用展示工具，例如 HTML 转义、风险等级文案、中文序号。
- `js/analysis-fallback.js`：浏览器端 fallback 合同识别、条款风险、信息抽取和相对方创建。
- `js/ui-shell.js`：弹窗打开关闭、toast、上传/进度/Skill 结果/新增条款弹窗。
- `js/dashboard.js`：总览页、待反馈任务、全局检索、审计日志渲染。
- `js/contract-library.js`：合同库列表、筛选、合同卡片渲染。
- `js/drafting.js`：起草台渲染、初稿生成 fallback。
- `js/counterparties.js`：相对方列表、画像、筛选。
- `js/contract-lifecycle.js`：删除合同/版本、生成拟发送版本、清理版本关联状态。
- `js/contract-parser.js`：浏览器端合同类型识别、条款分类、章节/条款/子条款拆分。
- `js/state.js`：种子数据、状态加载、状态标准化、本地缓存写入。
- `js/api.js`：Legal Skill 请求、异步 job 轮询、后端快照同步、Skill 结果落库。
- `js/render-review.js`：审阅台主体渲染、条款工作区、时间线、导出面板。
- `js/review-material.js`：材料选择、清洁/修订模式文本选择、版本条款拆分、小条款文本组合。
- `js/review-risk.js`：合同级风险、条款风险、条款分析和 AI 建议展示。
- `js/review-index.js`：本条款历史版本、本合同关联条款、同类条款口径。
- `js/review-redline.js`：清洁/修订模式展示、红线文本、拟发送版本对比文本。
- `js/review-tree.js`：章节、条款、子条款、多级子条款树形渲染。
- `js/review-actions.js`：采纳 AI 建议、采纳合同级建议、采纳条款级建议。
- `js/review-checks.js`：拟发送版本自动核查。
- `js/review-numbering.js`：条款/小条款编号、插入排序、引用改写、插入审计。
- `js/review-reorder.js`：条款和小条款拖拽重排、跨父级移动、重排审计记录。
- `js/word-docx.js`：浏览器端 docx 解析、修订/批注 docx 导出。
- `js/playbook.js`：条款库渲染、检索和沉淀展示。
- `server/*`：本地 API、快照存储、Legal Skill runner 适配。
- `scripts/*`：Codex/本地 runner、Node 端 docx 解析。

## 本轮已清理

- 从 `render-review.js` 拆出 `review-material.js`，材料选择、版本文本、清洁/修订展示文本、小条款组合逻辑集中到材料层。
- 从 `app.js` 拆出 `dashboard.js`、`contract-library.js`、`drafting.js`、`counterparties.js`，页面级渲染不再堆在入口文件里。
- 从 `app.js` 拆出 `contract-lifecycle.js`，删除合同/版本、拟发送版本生成和版本状态清理集中管理。
- 从 `app.js` 拆出 `ui-shell.js`，弹窗和 toast 统一归到 UI 壳层。
- 从 `app.js` / `drafting.js` 拆出 `utils.js` 和 `analysis-fallback.js`，通用工具与 fallback 分析逻辑不再混在入口文件里。
- 保持 `contract-parser.js`、`review-numbering.js`、`review-reorder.js` 的既有拆分，审阅台的结构拆分、编号引用维护、拖拽重排职责继续独立。
- 更新 `index.html` 与 `npm run check` 的脚本顺序，确保依赖先加载。
- 运行重复函数检查，未发现全局函数重名冲突。

## 当前状态

- `app.js` 已从约 1970 行降到约 1000 行以内，职责变为入口、页面切换、事件和表单流转。
- `render-review.js` 已降到约 395 行，主要保留审阅台视图渲染。
- 页面级模块、审阅台数据层、编号/拖拽/风险/索引/红线各自独立，当前结构已经比较通畅。

## 后续可选拆分

1. 将 `app.js` 中的全局事件绑定拆成 `events.js`。
2. 将 `app.js` 中的上传/进度表单提交拆成 `forms.js`。
3. 将 `word-docx.js` 拆为 `docx-read.js` 与 `docx-export.js`。
4. 将浏览器 fallback、后端 adapter、runner 的结构化结果 normalizer 合并成共享 schema 模块。
