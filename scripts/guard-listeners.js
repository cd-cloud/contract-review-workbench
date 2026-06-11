/**
 * Guard: ensure global document/window listeners are paired with removeEventListener
 * before addEventListener, or wrapped in an attachXxxListeners helper.
 *
 * This prevents listener leaks during hot reload / repeated test script loads.
 */

const fs = require("fs");
const path = require("path");

const JS_DIR = path.resolve(__dirname, "..", "js");

const ADD_RE = /\b(document|window)\.addEventListener\s*\(\s*["']([^"']+)["']/g;
const REMOVE_RE = /\b(document|window)\.removeEventListener\s*\(\s*["']([^"']+)["']/g;
const ATTACH_FN_RE = /function\s+attach\w+Listeners\s*\(/i;

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

function main() {
  const files = walk(JS_DIR);
  const failures = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    // If the file wraps listeners in an attachXxxListeners helper, we trust it.
    if (ATTACH_FN_RE.test(content)) continue;

    const adds = [];
    let m;
    ADD_RE.lastIndex = 0;
    while ((m = ADD_RE.exec(content)) !== null) {
      adds.push({ target: m[1], event: m[2] });
    }
    if (adds.length === 0) continue;

    const removes = new Set();
    REMOVE_RE.lastIndex = 0;
    while ((m = REMOVE_RE.exec(content)) !== null) {
      removes.add(`${m[1]}:${m[2]}`);
    }

    for (const { target, event } of adds) {
      if (!removes.has(`${target}:${event}`)) {
        const rel = path.relative(process.cwd(), file);
        failures.push(`${rel}: ${target}.addEventListener("${event}", ...) is missing a paired removeEventListener`);
      }
    }
  }

  if (failures.length) {
    console.error("listener guard failed:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  console.log(`listener guard ok (${files.length} files checked)`);
}

main();
