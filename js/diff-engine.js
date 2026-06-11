/**
 * Diff engine: token-level and line-level text diffing utilities.
 * Extracted from app.js to reduce monolithic controller size.
 *
 * Token-level diff uses Hirschberg's algorithm (O(m*n) time, O(n) space)
 * instead of the naive O(m*n) DP to avoid memory explosion on large texts.
 */

function tokenizeForDiff(text) {
  return String(text || "").match(/[\u4e00-\u9fff]|[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_\u4e00-\u9fff]/g) || [];
}

const MAX_DIFF_TOKENS_FOR_LCS = 4000;

/* ─────────────── Hirschberg LCS (O(m*n) time, O(n) space) ─────────────── */

function lastRowLCS(xs, ys) {
  const m = xs.length;
  const n = ys.length;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      curr[j] = xs[i - 1] === ys[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    const tmp = prev; prev = curr; curr = tmp;
    curr.fill(0);
  }
  return prev;
}

function hirschbergLCS(xs, ys) {
  const m = xs.length;
  const n = ys.length;
  if (m === 0) return [];
  if (m === 1) {
    const j = ys.indexOf(xs[0]);
    return j >= 0 ? [[0, j]] : [];
  }
  const mid = Math.floor(m / 2);
  const leftLcs = lastRowLCS(xs.slice(0, mid), ys);
  const rightLcs = lastRowLCS(xs.slice(mid).reverse(), ys.slice().reverse());
  let maxSum = -1;
  let bestK = 0;
  for (let k = 0; k <= n; k += 1) {
    const sum = leftLcs[k] + rightLcs[n - k];
    if (sum > maxSum) {
      maxSum = sum;
      bestK = k;
    }
  }
  const leftMatches = hirschbergLCS(xs.slice(0, mid), ys.slice(0, bestK));
  const rightMatches = hirschbergLCS(xs.slice(mid), ys.slice(bestK));
  // Adjust right half indices
  const adjustedRight = rightMatches.map(([i, j]) => [i + mid, j + bestK]);
  return leftMatches.concat(adjustedRight);
}

function buildInlineDiffParts(oldText, newText) {
  const oldTokens = tokenizeForDiff(oldText);
  const newTokens = tokenizeForDiff(newText);
  const m = oldTokens.length;
  const n = newTokens.length;

  // If either side is empty, fast-path
  if (m === 0 && n === 0) return [];
  if (m === 0) return mergeDiffParts(newTokens.map((t) => ({ type: "insert", text: t })));
  if (n === 0) return mergeDiffParts(oldTokens.map((t) => ({ type: "delete", text: t })));

  // If too large even for Hirschberg (time concerns), fall back to line diff
  if (m * n > MAX_DIFF_TOKENS_FOR_LCS * MAX_DIFF_TOKENS_FOR_LCS) {
    return buildLineDiffParts(oldText, newText);
  }

  const matches = hirschbergLCS(oldTokens, newTokens);
  const matchedOld = new Set(matches.map(([i]) => i));
  const matchedNew = new Set(matches.map(([, j]) => j));

  const parts = [];
  let oi = 0;
  let ni = 0;
  let mi = 0;
  while (oi < m || ni < n) {
    // Advance to next match
    if (mi < matches.length) {
      const [miOld, miNew] = matches[mi];
      // Output deletions before match
      while (oi < miOld) {
        parts.push({ type: "delete", text: oldTokens[oi] });
        oi += 1;
      }
      // Output insertions before match
      while (ni < miNew) {
        parts.push({ type: "insert", text: newTokens[ni] });
        ni += 1;
      }
      // Output match
      parts.push({ type: "same", text: oldTokens[oi] });
      oi += 1;
      ni += 1;
      mi += 1;
    } else {
      // No more matches — tail deletions/insertions
      while (oi < m) {
        parts.push({ type: "delete", text: oldTokens[oi] });
        oi += 1;
      }
      while (ni < n) {
        parts.push({ type: "insert", text: newTokens[ni] });
        ni += 1;
      }
    }
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

// Browser-only: functions are available in the global scope via <script> tag.
// Node.js consumers can require this file directly.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    tokenizeForDiff,
    buildInlineDiffParts,
    buildLineDiffParts,
    mergeDiffParts,
    buildInlineDiffHtml,
  };
}
