function normalizeSkillClauseSegmentation(segments = []) {
  return segments
    .filter((item) => item && (item.text || item.title))
    .map((item, index) => ({
      stableId: item.stableId || `seg-${index + 1}`,
      order: Number(item.order) || index + 1,
      title: String(item.title || "").trim(),
      text: String(item.text || "").trim(),
      type: item.type || "",
      chapterTitle: String(item.chapterTitle || "").trim(),
      hierarchyLevel: item.hierarchyLevel || "article",
    }))
    .sort((a, b) => a.order - b.order);
}

function getAiClauseSegmentationForSource(text, sourceKey) {
  const validation = getValidatedAiClauseSegmentation(text, sourceKey);
  if (!validation.accepted) return null;
  return validation.segments.map((item, index) => ({
    id: uid("clause"),
    contractId: sourceKey,
    number: index + 1,
    title: item.title,
    text: item.text,
    type: item.type || classifyClause(item.text, item.title),
    chapterTitle: item.chapterTitle || "",
    hierarchyLevel: item.hierarchyLevel || "article",
    keyClause: item.type !== "其他",
    riskLevel: "low",
    deviates: false,
    sourceKind: "ai-segmented",
    aiStableId: item.stableId,
  }));
}

function getClauseSegmentationStatus(text, sourceKey) {
  const validation = getValidatedAiClauseSegmentation(text, sourceKey);
  if (!validation.available) return { source: "local", label: "本地规则切分", count: 0, overlap: 0 };
  if (!validation.accepted) {
    return {
      source: "local",
      label: "本地规则切分",
      count: validation.segments.length,
      overlap: validation.overlap,
      note: validation.reason || "AI 切分与当前文本重合度不足，已回退。",
    };
  }
  return {
    source: "ai",
    label: "AI 语义切分",
    count: validation.segments.length,
    overlap: validation.overlap,
  };
}

function getValidatedAiClauseSegmentation(text, sourceKey) {
  const contractId = String(sourceKey || "").split(":")[0];
  const result = getStoredSkillResult(contractId);
  const segments = normalizeSkillClauseSegmentation(result?.clauseSegmentation || []);
  if (segments.length < 2) return { available: false, accepted: false, segments: [], overlap: 0 };
  const structureIssue = detectAiSegmentationStructureIssue(text, segments);
  if (structureIssue) {
    return { available: true, accepted: false, segments, overlap: 0, reason: structureIssue };
  }
  const sourceFingerprint = normalizeText(text).slice(0, 1200);
  const segmentFingerprint = normalizeText(segments.map((item) => item.text).join("\n")).slice(0, 1200);
  if (!sourceFingerprint || !segmentFingerprint) return { available: true, accepted: false, segments, overlap: 0 };
  const overlap = jaccard(tokenize(sourceFingerprint), tokenize(segmentFingerprint));
  return { available: true, accepted: overlap >= 0.28, segments, overlap };
}

function detectAiSegmentationStructureIssue(text, segments = []) {
  const sourceArticles = extractExplicitArticleRefs(text);
  if (sourceArticles.length < 2) return "";
  const sourceArticleSet = new Set(sourceArticles);
  const aiArticleRefs = segments.flatMap((segment) => extractExplicitArticleRefs(`${segment.title || ""}\n${segment.text || ""}`));
  const merged = segments.find((segment) => {
    const title = String(segment.title || "");
    const refs = extractExplicitArticleRefs(`${segment.title || ""}\n${segment.text || ""}`);
    const uniqueRefs = [...new Set(refs.filter((ref) => sourceArticleSet.has(ref)))];
    return uniqueRefs.length > 1 || /第\s*[一二三四五六七八九十百零〇两0-9]+\s*条\s*(?:至|到|-|—|－)\s*第?\s*[一二三四五六七八九十百零〇两0-9]+\s*条/.test(title);
  });
  if (merged) return "AI 切分合并了原合同中明确编号的多个正式条款，已按原合同编号回退。";
  const aiArticleSet = new Set(aiArticleRefs);
  const preservedCount = sourceArticles.filter((ref) => aiArticleSet.has(ref)).length;
  if (sourceArticles.length >= 4 && preservedCount < Math.ceil(sourceArticles.length * 0.72)) {
    return "AI 切分未充分保留原合同明确条款编号，已按原合同编号回退。";
  }
  return "";
}

function extractExplicitArticleRefs(text) {
  const refs = [];
  const source = String(text || "");
  for (const match of source.matchAll(/第\s*([一二三四五六七八九十百零〇两0-9]+)\s*条/g)) {
    const value = parseChineseOrArabicNumber(match[1]) || normalizeNumberRef(match[1]);
    if (value) refs.push(`article-${value}`);
  }
  return [...new Set(refs)];
}
