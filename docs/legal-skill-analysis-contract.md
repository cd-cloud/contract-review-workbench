# Legal Skill Analysis Contract

本文件定义前端 MVP 与后续 `legal-work-orchestrator / legal-contract-orchestrator` 后端分析服务之间的数据契约。

## Request

```json
{
  "jurisdiction": "中国大陆",
  "contract_type": "SaaS 服务合同",
  "business_background": "交易背景、合同目的、版本说明",
  "party_roles": "各方角色",
  "represented_party": "我方角色",
  "mode": "review",
  "contract_text": "当前版本合同文本",
  "counterparty_version": "对方修订稿或上一版本，可为空",
  "attachments_or_exhibits": "附件、邮件、修改建议，可为空",
  "drafting_requirements": "用户对本次审阅的特殊要求",
  "risk_preference": "保守 / 平衡 / 激进",
  "language": "中文",
  "output_format": "structured_json"
}
```

## Response

```json
{
  "contractSummary": {
    "contractName": "合同名称",
    "contractType": "合同类型",
    "purpose": "合同目的",
    "ourRole": "我方角色",
    "counterparty": "相对方",
    "riskLevel": "high / medium / low",
    "completionScore": 0,
    "positionDeviationLevel": "high / medium / low"
  },
  "contractLevelRisks": [
    {
      "id": "CR1",
      "severity": "high / medium / low",
      "title": "风险标题",
      "issue": "问题",
      "consequence": "后果",
      "recommendation": "建议",
      "needsBusinessConfirmation": true
    }
  ],
  "clauseAnalyses": [
    {
      "clauseId": "前端条款稳定 ID",
      "clauseTitle": "条款标题",
      "clauseType": "条款类型",
      "severity": "high / medium / low",
      "issue": "问题",
      "consequence": "后果",
      "proposedRevision": "建议修订文本",
      "negotiationPosition": "谈判立场",
      "fallbackText": "备选文本",
      "businessDecision": "需业务判断事项"
    }
  ],
  "missingFacts": [
    "待确认事实"
  ],
  "businessSummary": "给业务看的摘要"
}
```

## Integration Notes

- 前端当前 `generateFindings()` 是 MVP 本地规则占位。
- 后续应由后端调用 legal skill，并返回本文件定义的结构化结果。
- 前端条款卡片、合同级风险摘要、分析页签、Word 导出均应优先使用 skill 返回结果。

