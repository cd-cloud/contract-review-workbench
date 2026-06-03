/**
 * Shared server-side utilities.
 */

function parseRunnerJson(stdout) {
  const text = String(stdout || "").trim();
  if (!text) throw new Error("empty stdout");
  try {
    return JSON.parse(text);
  } catch (error) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw error;
  }
}

module.exports = { parseRunnerJson };
