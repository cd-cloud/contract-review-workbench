/**
 * Diff engine: token-level and line-level text diffing utilities.
 * Extracted from app.js to reduce monolithic controller size.
 */

function tokenizeForDiff(text) {
  return String(text || "").match(/[\u4e00-\u9fff]|[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_\u4e00-\u9fff]/g) || [];
}

const MAX_DIFF_TOKENS_FOR_LCS = 4000;

function buildInlineDiffParts(oldText, newText) {
  const oldTokens = tokenizeForDiff(oldText);
  const newTokens = tokenizeForDiff(newText);
  const m = oldTokens.length;
  const n = newTokens.length;
  if (m * n > MAX_DIFF_TOKENS_FOR_LCS * MAX_DIFF_TOKENS_FOR_LCS) {
    return buildLineDiffParts(oldText, newText);
  }
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = oldTokens[i] === newTokens[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const parts = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldTokens[i] === newTokens[j]) {
      parts.push({ type: "same", text: oldTokens[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      parts.push({ type: "delete", text: oldTokens[i] });
      i += 1;
    } else {
      parts.push({ type: "insert", text: newTokens[j] });
      j += 1;
    }
  }
  while (i < m) {
    parts.push({ type: "delete", text: oldTokens[i] });
    i += 1;
  }
  while (j < n) {
    parts.push({ type: "insert", text: newTokens[j] });
    j += 1;
  }
  return mergeDiffParts(parts);
}

function buildLineDiffParts(oldText, newText) {
  const oldLines = String(oldText || "").split("\n");
  const newLines = String(newText || "").split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const parts = [];
  let oi = 0;
  let ni = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi >= oldLines.length) {
      parts.push({ type: "insert", text: newLines[ni] + "\n" });
      ni += 1;
    } else if (ni >= newLines.length) {
      parts.push({ type: "delete", text: oldLines[oi] + "\n" });
      oi += 1;
    } else if (oldLines[oi] === newLines[ni]) {
      parts.push({ type: "same", text: oldLines[oi] + "\n" });
      oi += 1;
      ni += 1;
    } else if (!newSet.has(oldLines[oi])) {
      parts.push({ type: "delete", text: oldLines[oi] + "\n" });
      oi += 1;
    } else if (!oldSet.has(newLines[ni])) {
      parts.push({ type: "insert", text: newLines[ni] + "\n" });
      ni += 1;
    } else {
      parts.push({ type: "delete", text: oldLines[oi] + "\n" });
      parts.push({ type: "insert", text: newLines[ni] + "\n" });
      oi += 1;
      ni += 1;
    }
  }
  return mergeDiffParts(parts);
}

function mergeDiffParts(parts) {
  const merged = [];
  parts.forEach((part) => {
    const last = merged.at(-1);
    if (last && last.type === part.type) {
      last.text += part.text;
    } else {
      merged.push({ ...part });
    }
  });
  return merged;
}

function buildInlineDiffHtml(oldText, newText, deleteClass = "redline-deleted", insertClass = "redline-inserted") {
  return buildInlineDiffParts(oldText, newText)
    .map((part) => {
      const text = escapeHtml(part.text).replaceAll("\n", "<br />");
      if (part.type === "delete") return `<span class="${deleteClass}">${text}</span>`;
      if (part.type === "insert") return `<span class="${insertClass}">${text}</span>`;
      return text;
    })
    .join("");
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = {
  tokenizeForDiff,
  buildInlineDiffParts,
  buildLineDiffParts,
  mergeDiffParts,
  buildInlineDiffHtml,
};
