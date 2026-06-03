# Regression Samples

本项目的回归样本用于验证审阅台闭环，而不是沉淀真实客户合同。真实合同进入样本前应先脱敏。

## 样本类型

- `numbered-service-contract`：覆盖“第X条”、中文序号、阿拉伯编号、括号编号混合层级。
- `ai-segmentation-contract`：覆盖 Codex `clauseSegmentation` 优先切分和本地规则回退。
- `add-clause-routing`：覆盖新增条款建议只展示一次，并归位到最相关条款卡片。
- `word-export-outline`：覆盖导出 DOCX/HTML 时保留章节、条款、小款缩进。

## 最低验收

- 条款正文不能被误作标题。
- 同一条新增条款建议只能出现一次。
- Codex 切分不可用时必须回退到本地切分并提示。
- Word 导出的条款标题、正文、小款应有可辨识层级。
