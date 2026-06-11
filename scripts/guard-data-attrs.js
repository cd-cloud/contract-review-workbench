/**
 * Guard: ensure dynamic data-* HTML attributes are escaped.
 * Scans js/ (recursively) for data-FOO="${expr}" where expr is not wrapped in escapeHtml(...).
 * Excludes patterns that are clearly hardcoded (no ${}) or JS selectors (not in HTML templates).
 */

const fs = require("fs");
const path = require("path");

const JS_DIR = path.resolve(__dirname, "..", "js");
const DYNAMIC_ATTR_RE = /data-([a-z0-9-]+)="\$\{([^}]+(?:\$\{[^}]*\}[^}]*)*)\}"/gi;
const ESCAPED_RE = /^\s*(?:escapeHtml|cssEscapeValue)\s*\(/i;
const HARDCODED_RE = /^\s*(?:true|false|\d+|['"`][^'"`]*['"`])\s*$/i;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

const QUERY_SELECTOR_RE = /querySelector(?:All)?\s*\(/i;

function isInsideHtmlTemplate(content, index) {
  // Heuristic: dynamic data-* attrs are only dangerous when emitted as HTML.
  // We approximate by checking whether the line contains a template literal with HTML-ish syntax.
  const lineStart = content.lastIndexOf("\n", index) + 1;
  const lineEnd = content.indexOf("\n", index);
  const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  if (!/[<>`]/.test(line)) return false;
  // Exclude JS selector strings like `.foo[data-x="${...}"]`
  if (QUERY_SELECTOR_RE.test(line)) return false;
  return true;
}

function main() {
  const files = walk(JS_DIR);
  const failures = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    let match;
    DYNAMIC_ATTR_RE.lastIndex = 0;
    while ((match = DYNAMIC_ATTR_RE.exec(content)) !== null) {
      const attrName = match[1];
      const expr = match[2];
      const index = match.index;
      if (ESCAPED_RE.test(expr)) continue;
      if (HARDCODED_RE.test(expr)) continue;
      // Known safe internal enum attributes
      if (attrName === "comparison-type") continue;
      if (!isInsideHtmlTemplate(content, index)) continue;
      const rel = path.relative(process.cwd(), file);
      failures.push(`${rel}:${content.slice(0, index).split("\n").length} data-${attrName} attr not escaped: data-${attrName}="\${${expr.slice(0, 60)}}"`);
    }
  }

  if (failures.length) {
    console.error("data-* escape guard failed:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  console.log(`data-* escape guard ok (${files.length} files checked)`);
}

main();
