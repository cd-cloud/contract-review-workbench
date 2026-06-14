const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [
  {
    file: "js/word-docx.js",
    patterns: ["ChapterHeading", "SubclauseDecimal", "renderWordHtmlClauseText"],
  },
  {
    file: "js/api/segmentation.js",
    patterns: ["getClauseSegmentationStatus"],
  },
  {
    file: "js/api/findings.js",
    patterns: ["clauseSegmentation", "dedupeSkillFindings", "matchClauseByExplicitNumber"],
  },
  {
    file: "scripts/codex-skill-runner.js",
    patterns: ["Segmentation UI rule", "heading-only segment", "Clause placement is critical"],
  },
  {
    file: "js/review-risk.js",
    patterns: ["renderAdviceBlock", "advice-heading", "\\u5efa\\u8bae\\u6587\\u672c"],
  },
  {
    file: "js/render-review.js",
    patterns: ["AI切分", "segmentationStatus.label"],
  },
  {
    file: "schemas/legal-skill-response.schema.json",
    patterns: ["clauseSegmentation", "stableId", "hierarchyLevel"],
  },
  {
    file: "schemas/suggestion-action-response.schema.json",
    patterns: ["insertedClause", "rejectionReason", "knowledgeNote"],
  },
  {
    file: "schemas/contract-intake-response.schema.json",
    patterns: ["contractName", "businessBackground", "missingFacts"],
  },
  {
    file: "server/routes/handlers/adapters.js",
    patterns: ["/api/ai-suggestion/action", "runSuggestionAction", "/api/contract-intake", "runContractIntake", "/api/visual-qa", "runVisualQa"],
  },
  {
    file: "js/api/core.js",
    patterns: ["runContractIntake", "/api/contract-intake"],
  },
  {
    file: "js/api-client.js",
    patterns: ["legalWorkbenchFetch"],
  },
  {
    file: "index.html",
    patterns: ["./js/runtime-config.js", "./js/api-client.js"],
  },
  {
    file: "js/api-client.js",
    patterns: ["credentials: init.credentials || \"include\"", "legalWorkbenchApiUrl"],
  },
  {
    file: "js/app-contract-actions.js",
    patterns: ["runContractIntake", "detectedMissingFacts", "scheduleAutomaticCodexReview", "runAutomaticCodexReview", "ensureAnalysisHasCodexSegmentation", "autofillNewReviewFromLocalRules"],
  },
  {
    file: "js/app-router.js",
    patterns: ["toggleTreeNodeExpansion"],
  },
  {
    file: "js/render-review.js",
    patterns: ["autoReviewJobs", "material.sourceKey || contract.id"],
  },
  {
    file: "js/review-risk.js",
    patterns: ["data-adjust-clause-risk", "\\u8fdb\\u4e00\\u6b65\\u8c03\\u6574"],
  },
  {
    file: "schemas/visual-qa-response.schema.json",
    patterns: ["visualQa", "suggestionPlacementIssues", "blockingExportIssues"],
  },
  {
    file: "scripts/ai-visual-qa-runner.js",
    patterns: ["Agent B", "待采纳后编号", "suggestionPlacementIssues"],
  },
  {
    file: "js/render-review.js",
    patterns: ["renderVisualQaPanel", "scheduleVisualQaOnReviewOpen"],
  },
  {
    file: "js/api/visualqa.js",
    patterns: ["VISUAL_QA_INTERACTION_DELAY_MS", "pendingReason", "Visual QA 已排队"],
  },
];

const failures = [];
for (const check of checks) {
  const fullPath = path.join(root, check.file);
  const content = fs.readFileSync(fullPath, "utf8");
  for (const pattern of check.patterns) {
    if (!content.includes(pattern)) failures.push(`${check.file} missing ${pattern}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("regression smoke ok");
