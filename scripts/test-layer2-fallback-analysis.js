/**
 * Layer 2: Contract parsing + clause matching integration test
 * Tests the complete fallback analysis pipeline end-to-end.
 */

const assert = require("assert");

process.env.LEGAL_SKILL_ALLOW_FALLBACK = "1";
// Ensure no runner is configured so we hit the fallback path
process.env.LEGAL_SKILL_RUNNER_SCRIPT = "";
process.env.LEGAL_SKILL_COMMAND = "";

const { analyzeLegalReview, getRunnerStatus } = require("../server/legal-skill-adapter");

const sampleContract = `技术服务合同

甲方：北京科技有限公司
乙方：上海云服务股份有限公司

鉴于甲方拟采购乙方提供的云计算服务，双方经友好协商，达成如下协议。

第一条 服务范围
1.1 乙方应向甲方提供基于云平台的计算、存储及网络服务。
1.2 服务内容包括：虚拟机实例、对象存储、负载均衡及数据库服务。

第二条 服务费用与付款
2.1 服务费用按实际使用量计费，单价详见附件《价格清单》。
2.2 甲方应于每月收到账单后十五个工作日内支付上月费用。
2.3 逾期付款的，甲方应按日万分之五支付滞纳金。

第三条 知识产权
3.1 乙方保留其提供的软件、平台及相关技术的全部知识产权。
3.2 甲方在使用服务过程中产生的数据及成果归甲方所有。

第四条 保密义务
4.1 双方应对在履行本合同过程中知悉的对方商业秘密予以保密。
4.2 保密义务不因本合同终止而失效，持续有效三年。

第五条 违约责任
5.1 任何一方违反本合同约定，应赔偿守约方因此遭受的直接损失。
5.2 乙方因服务中断造成甲方损失的，赔偿责任不超过上月服务费用总额。

第六条 期限与终止
6.1 本合同有效期为一年，自签署之日起算。
6.2 任何一方提前三十日书面通知对方，可终止本合同。

第七条 争议解决
7.1 因本合同引起的争议，双方应友好协商解决。
7.2 协商不成的，任何一方均可向甲方所在地有管辖权的人民法院提起诉讼。
`;

async function main() {
  const runnerStatus = getRunnerStatus();
  assert.strictEqual(runnerStatus.mode, "fallback", "Should be in fallback mode");
  console.log("  ✓ Runner status: fallback mode");

  const request = {
    contract_name: "测试-技术服务合同",
    contract_text: sampleContract,
    contract_type: "",
    counterparty: "上海云服务股份有限公司",
    represented_party: "甲方",
    business_background: "采购云计算服务",
    clauses: [], // Empty to trigger splitClauses fallback
  };

  const result = await analyzeLegalReview(request);

  assert.strictEqual(result.ok, true, "Result should be ok");
  assert.ok(result.response, "Result should have response");
  console.log("  ✓ Fallback analysis returned successfully");

  const { contractSummary, clauseSegmentation, clauseAnalyses, contractLevelRisks } = result.response;

  // Validate contract summary
  assert.ok(contractSummary.contractType, `Should infer contract type, got: ${contractSummary.contractType}`);
  assert.ok(contractSummary.purpose, "Should infer purpose");
  assert.ok(["high", "medium", "low"].includes(contractSummary.riskLevel), `Valid riskLevel: ${contractSummary.riskLevel}`);
  console.log(`  ✓ Contract summary: type=${contractSummary.contractType}, risk=${contractSummary.riskLevel}`);

  // Validate clause segmentation
  assert.ok(Array.isArray(clauseSegmentation), "clauseSegmentation should be array");
  assert.ok(clauseSegmentation.length >= 5, `Should have >=5 clauses, got ${clauseSegmentation.length}`);

  // CRITICAL: Verify unified ID format (clause-N, not runner-clause-N)
  clauseSegmentation.forEach((clause, index) => {
    const expectedId = `clause-${index + 1}`;
    assert.strictEqual(clause.stableId, expectedId, `Clause ${index} should have id ${expectedId}, got ${clause.stableId}`);
    assert.ok(clause.title || clause.text, `Clause ${index} should have title or text`);
    assert.ok(clause.type, `Clause ${index} should have type`);
  });
  console.log(`  ✓ Clause segmentation: ${clauseSegmentation.length} clauses, IDs unified to clause-N`);

  // Validate clause analyses
  assert.ok(Array.isArray(clauseAnalyses), "clauseAnalyses should be array");
  const analysesWithClauseId = clauseAnalyses.filter((a) => a.clauseId);
  console.log(`  ✓ Clause analyses: ${clauseAnalyses.length} total, ${analysesWithClauseId.length} with clauseId`);

  // CRITICAL: Verify clauseIds in analyses match segmentation IDs
  const segmentationIds = new Set(clauseSegmentation.map((c) => c.stableId));
  const unmatched = analysesWithClauseId.filter((a) => !segmentationIds.has(a.clauseId));
  assert.strictEqual(unmatched.length, 0, `All clauseIds in analyses should match segmentation. Unmatched: ${unmatched.map((u) => u.clauseId).join(", ")}`);
  console.log("  ✓ All clauseIds in analyses match segmentation IDs");

  // Verify we have diverse clause types
  const types = new Set(clauseSegmentation.map((c) => c.type));
  console.log(`  ✓ Detected clause types: ${Array.from(types).join(", ")}`);

  // Verify contract-level risks
  assert.ok(Array.isArray(contractLevelRisks), "contractLevelRisks should be array");
  console.log(`  ✓ Contract-level risks: ${contractLevelRisks.length}`);

  // Verify findings have valid severity
  const allFindings = [...clauseAnalyses, ...contractLevelRisks];
  const severities = new Set(allFindings.map((f) => f.severity));
  const validSeverities = ["high", "medium", "low"];
  const invalidSeverities = Array.from(severities).filter((s) => !validSeverities.includes(s));
  assert.strictEqual(invalidSeverities.length, 0, `All severities should be valid. Invalid: ${invalidSeverities.join(", ")}`);
  console.log("  ✓ All findings have valid severity levels");

  console.log("\nLayer 2: Fallback analysis pipeline tests passed.");
}

main().catch((error) => {
  console.error("Layer 2 test failed:", error);
  process.exit(1);
});
