const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

function collectJsFiles(dir, exclude = ["node_modules", ".git", "dist"]) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (exclude.some((e) => full.includes(e))) continue;
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(full, exclude));
    } else if (entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

const files = collectJsFiles(ROOT);
let failed = 0;

for (const file of files.sort()) {
  const rel = path.relative(ROOT, file);
  try {
    execSync(`node --check "${file}"`, { stdio: "pipe" });
    console.log(`  ✓ ${rel}`);
  } catch (error) {
    console.error(`  ✗ ${rel}`);
    console.error(error.stderr?.toString() || error.message);
    failed += 1;
  }
}

if (failed) {
  console.error(`\n${failed} file(s) failed syntax check.`);
  process.exit(1);
} else {
  console.log(`\nAll ${files.length} files passed syntax check.`);
}
