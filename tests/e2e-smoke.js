const assert = require("assert");
const path = require("path");

function clearModule(target) {
  try {
    delete require.cache[require.resolve(target)];
  } catch (error) {}
}

function mockModule(target, exportsValue) {
  const resolved = require.resolve(target);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue,
  };
}

function mockReq(bodyObj, method = "POST", token = "test-token") {
  const body = Buffer.from(JSON.stringify(bodyObj || {}));
  return {
    method,
    headers: { "x-legal-workbench-token": token },
    on(event, handler) {
      if (event === "data") handler(body);
      if (event === "end") handler();
    },
  };
}

function mockRes() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

function makeUrl(pathname) {
  return new URL(pathname, "http://127.0.0.1:8787");
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const tempDataDir = path.join(process.cwd(), ".tmp-e2e-smoke");
  process.env.LEGAL_WORKBENCH_DATA_DIR = tempDataDir;
  process.env.LEGAL_WORKBENCH_TOKEN = "test-token";

  [
    "../server/routes/api",
    "../server/jobs",
    "../server/store",
    "../server/store-sqlite",
    "../server/http-utils",
  ].forEach(clearModule);

  mockModule("../server/contract-intake-adapter", {
    runContractIntake: async () => ({
      ok: true,
      source: "mock-intake-runner",
      intake: {
        contractName: "示例 SaaS 服务协议",
        contractType: "SaaS 服务合同",
        counterparty: "测试客户有限公司",
        ourRole: "服务提供方",
        purpose: "采购智能客服 SaaS 服务",
        businessBackground: "用于测试的 mock intake 结果。",
        confidence: 92,
        missingFacts: [],
        jurisdiction: "中国大陆",
      },
      promptVersion: "mock-intake-v1",
    }),
    getRunnerStatus: () => ({ configured: true, ready: true, lastRunState: "succeeded" }),
  });

  mockModule("../server/legal-skill-adapter", {
    analyzeLegalReview: async () => ({
      ok: true,
      source: "mock-legal-skill-runner",
      promptVersion: "mock-legal-v1",
      response: {
        contractSummary: {
          contractType: "SaaS 服务合同",
          purpose: "采购智能客服 SaaS 服务",
          riskLevel: "medium",
        },
        clauseSegmentation: [
          {
            stableId: "seg-1",
            order: 1,
            title: "服务内容",
            text: "第一条 服务内容\n乙方向甲方提供 SaaS 服务。",
            type: "服务范围",
            chapterTitle: "",
            hierarchyLevel: "article",
          },
        ],
        contractLevelRisks: [
          {
            severity: "medium",
            actionType: "add_clause",
            title: "建议补充数据使用条款",
            issue: "未明确训练边界",
            suggestion: "补充客户数据使用边界",
            proposedClauseText: "未经客户书面同意，不得将客户数据用于通用模型训练。",
            targetInsertPosition: "服务内容条款之后",
            businessRationale: "",
            adoptionNote: "",
            negotiationBottomLine: "不得用于通用模型训练",
            acceptableFallback: "允许匿名化统计",
            linkedClauseIds: ["clause-1"],
            qualityScore: 88,
          },
        ],
        clauseAnalyses: [
          {
            clauseId: "clause-1",
            title: "服务内容",
            clauseType: "服务范围",
            severity: "medium",
            actionType: "revise_clause",
            issue: "服务范围定义不完整",
            consequence: "交付边界不清",
            proposedRevision: "乙方向甲方提供智能客服 SaaS 系统、API 调用服务及后台支持。",
            targetText: "乙方向甲方提供 SaaS 服务。",
            replacementText: "乙方向甲方提供智能客服 SaaS 系统、API 调用服务及后台支持。",
            commentText: "",
            negotiationPosition: "保留乙方实现方式自主权",
            fallbackText: "乙方向甲方提供智能客服 SaaS 服务。",
            businessDecision: "",
            adoptionNote: "",
            negotiationBottomLine: "保留服务范围解释权",
            acceptableFallback: "保留 API 支持描述即可",
            linkedClauseIds: [],
            qualityScore: 81,
          },
        ],
        missingFacts: [],
        businessSummary: "mock review complete",
      },
      __costMeta: { model: "mock", provider: "mock", source: "mock-legal-skill-runner" },
    }),
    getRunnerStatus: () => ({ configured: true, ready: true, lastRunState: "succeeded", model: "mock", provider: "mock" }),
  });

  mockModule("../server/suggestion-action-adapter", {
    runSuggestionAction: async () => ({ ok: true, source: "mock-suggestion", action: { status: "adopted" } }),
    getRunnerStatus: () => ({ configured: true, ready: true, lastRunState: "succeeded" }),
  });

  mockModule("../server/visual-qa-adapter", {
    runVisualQa: async () => ({ ok: true, source: "mock-visual-qa", visualQa: { status: "pass", summary: "ok" } }),
    getRunnerStatus: () => ({ configured: true, ready: true, lastRunState: "succeeded" }),
  });

  const { handleApi } = require("../server/routes/api");
  const { _clearAllJobsForTesting } = require("../server/jobs");
  _clearAllJobsForTesting();

  const intakeRes = mockRes();
  await handleApi(
    mockReq({ contractText: "第一条 服务内容\n乙方向甲方提供 SaaS 服务。" }),
    intakeRes,
    makeUrl("/api/contract-intake")
  );
  assert.strictEqual(intakeRes.status, 200);
  const intakeBody = JSON.parse(intakeRes.body);
  assert.strictEqual(intakeBody.ok, true);
  assert.strictEqual(intakeBody.intake.contractType, "SaaS 服务合同");

  const createJobRes = mockRes();
  await handleApi(
    mockReq({
      workflow: "legal-contract-review",
      contract_text: "第一条 服务内容\n乙方向甲方提供 SaaS 服务。",
      contract_type: "SaaS 服务合同",
      represented_party: "服务提供方",
      counterparty: "测试客户有限公司",
      jurisdiction: "中国大陆",
      clauses: [{ id: "clause-1", title: "服务内容", text: "乙方向甲方提供 SaaS 服务。", type: "服务范围" }],
    }),
    createJobRes,
    makeUrl("/api/legal-review/jobs")
  );
  assert.strictEqual(createJobRes.status, 202);
  const createBody = JSON.parse(createJobRes.body);
  assert.strictEqual(createBody.ok, true);
  const jobId = createBody.job.id;
  assert.ok(jobId);

  let completed = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pollRes = mockRes();
    await handleApi(
      { method: "GET", headers: { "x-legal-workbench-token": "test-token" } },
      pollRes,
      makeUrl(`/api/legal-review/jobs/${encodeURIComponent(jobId)}`)
    );
    assert.strictEqual(pollRes.status, 200);
    const pollBody = JSON.parse(pollRes.body);
    if (pollBody.job.status === "completed") {
      completed = pollBody.job;
      break;
    }
    await delay(25);
  }

  assert.ok(completed, "Expected legal review job to complete");
  assert.strictEqual(completed.result.source, "mock-legal-skill-runner");
  assert.strictEqual(completed.result.promptVersion, "mock-legal-v1");
  assert.strictEqual(completed.result.response.clauseSegmentation.length, 1);
  assert.strictEqual(completed.result.response.clauseAnalyses.length, 1);
  assert.strictEqual(completed.result.response.contractLevelRisks.length, 1);

  const suggestionRes = mockRes();
  await handleApi(
    mockReq({
      userAction: "adopt",
      targetClauseId: "clause-1",
      targetClause: { id: "clause-1", title: "服务内容", text: "乙方向甲方提供 SaaS 服务。" },
      suggestion: {
        actionType: "revise_clause",
        issue: "服务范围定义不完整",
        fix: "乙方向甲方提供智能客服 SaaS 系统、API 调用服务及后台支持。",
      },
    }),
    suggestionRes,
    makeUrl("/api/ai-suggestion/action")
  );
  assert.strictEqual(suggestionRes.status, 200);
  const suggestionBody = JSON.parse(suggestionRes.body);
  assert.strictEqual(suggestionBody.ok, true);
  assert.strictEqual(suggestionBody.source, "mock-suggestion");

  const visualQaRes = mockRes();
  await handleApi(
    mockReq({
      reason: "smoke-test",
      contract: { id: "contract-demo", name: "示例 SaaS 服务协议", type: "SaaS 服务合同" },
      material: { sourceKey: "contract-demo:current", title: "当前主版本", mode: "clean" },
      contractText: "第一条 服务内容\n乙方向甲方提供 SaaS 服务。",
      clauses: [{ id: "clause-1", title: "服务内容", text: "乙方向甲方提供 SaaS 服务。", type: "服务范围" }],
      findings: [],
      actions: [],
      insertedClauses: [],
      localChecks: [],
    }),
    visualQaRes,
    makeUrl("/api/visual-qa")
  );
  assert.strictEqual(visualQaRes.status, 200);
  const visualQaBody = JSON.parse(visualQaRes.body);
  assert.strictEqual(visualQaBody.ok, true);
  assert.strictEqual(visualQaBody.source, "mock-visual-qa");
  assert.strictEqual(visualQaBody.visualQa.status, "pass");

  console.log("e2e-smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
