/**
 * Shared normalization utilities (UMD: works in browser and Node.js).
 * In the browser, loading this script defines normalizeSeverity in global scope.
 * In Node.js, require() returns an object with the function.
 */
(function (root, factory) {
  const exports = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = exports;
  }
}(typeof self !== "undefined" ? self : this, function (global) {
  function normalizeSeverity(value) {
    const text = String(value || "").toLowerCase();
    if (text.includes("high") || text.includes("高") || text.includes("重大")) return "high";
    if (text.includes("medium") || text.includes("中")) return "medium";
    return "low";
  }

  // Expose to global scope in browser so existing scripts can use it directly.
  if (typeof global !== "undefined") {
    global.normalizeSeverity = normalizeSeverity;
  }

  return { normalizeSeverity };
}));
