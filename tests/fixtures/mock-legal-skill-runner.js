const fs = require("fs");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});

process.stdin.on("end", () => {
  const payload = input.trim() ? JSON.parse(input) : {};
  const request = payload.request || payload;
  const chunkMeta = request.analysis_chunk_meta || null;
  const chunkIndex = chunkMeta?.chunkIndex || 1;
  const clauses = Array.isArray(request.clauses) ? request.clauses : [];
  const response = {
    contractSummary: {
      contractName: request.contract_name || "mock contract",
      contractType: request.contract_type || "mock type",
      purpose: chunkMeta ? `chunk-${chunkIndex}` : "single-pass",
      riskLevel: "low",
      completionScore: clauses.length,
      positionDeviationLevel: null,
    },
    clauseSegmentation: clauses.map((clause, index) => ({
      stableId: clause.stableId || clause.id || `chunk-${chunkIndex}-${index + 1}`,
      order: index + 1,
      title: clause.title || "",
      text: clause.text || "",
      type: clause.type || "其他",
      chapterTitle: clause.chapterTitle || "",
      hierarchyLevel: clause.hierarchyLevel || "article",
    })),
    contractLevelRisks: [
      {
        severity: "low",
        actionType: "comment_only",
        title: `Chunk ${chunkIndex} risk`,
        issue: `chunk-risk-${chunkIndex}`,
        consequence: "mock consequence",
        suggestion: "mock suggestion",
        proposedClauseText: "",
        targetInsertPosition: "",
        businessRationale: "mock rationale",
        adoptionNote: "mock note",
        negotiationBottomLine: "mock bottom line",
        acceptableFallback: "mock fallback",
        linkedClauseIds: clauses[0] ? [clauses[0].id] : [],
        qualityScore: 88,
      },
    ],
    clauseAnalyses: clauses.map((clause) => ({
      clauseId: clause.id,
      title: clause.title || "",
      clauseType: clause.type || "其他",
      severity: "low",
      actionType: "comment_only",
      issue: `issue-${clause.id}`,
      consequence: "mock consequence",
      proposedRevision: `rev-${clause.id}`,
      targetText: clause.text || "",
      replacementText: "",
      commentText: `comment-${clause.id}`,
      negotiationPosition: "mock position",
      fallbackText: "",
      businessDecision: "",
      adoptionNote: "mock note",
      negotiationBottomLine: "mock bottom line",
      acceptableFallback: "mock fallback",
      linkedClauseIds: [clause.id],
      qualityScore: 91,
    })),
    missingFacts: [`chunk-${chunkIndex}`],
    businessSummary: `chunk-summary-${chunkIndex}`,
  };

  process.stdout.write(JSON.stringify({ response }, null, 2));
});
