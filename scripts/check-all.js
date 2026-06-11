const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

function collectJsFiles(dir, exclude = ["node_modules", ".git", "dist", "tests/.tmp-"]) {
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

// Validate JSON schemas
const schemasDir = path.join(ROOT, "schemas");
if (fs.existsSync(schemasDir)) {
  for (const entry of fs.readdirSync(schemasDir, { withFileTypes: true })) {
    if (!entry.name.endsWith(".json")) continue;
    const full = path.join(schemasDir, entry.name);
    try {
      JSON.parse(fs.readFileSync(full, "utf8"));
      console.log(`  ✓ schemas/${entry.name}`);
    } catch (error) {
      console.error(`  ✗ schemas/${entry.name}`);
      console.error(error.message);
      failed += 1;
    }
  }
}

if (failed) {
  console.error(`\n${failed} file(s) failed syntax/validation check.`);
  process.exit(1);
} else {
  console.log(`\nAll ${files.length} JS files and schemas passed check.`);
}
