/**
 * Unified test runner for all test layers.
 * Usage: node tests/test-runner.js
 */

const { spawnSync } = require("child_process");
const path = require("path");

const testFiles = [
  // Layer 0: Syntax check (already covered by check-all.js, skip here)
  // Layer 1: Shared libs
  "scripts/test-layer1-shared-libs.js",
  "tests/test-shared-libs-extended.js",
  // Layer 2: Fallback analysis
  "scripts/test-layer2-fallback-analysis.js",
  // Layer 3: Frontend utils
  "tests/test-utils-pure.js",
  "tests/test-contract-parser.js",
  // Layer 4: Numbering
  "tests/test-numbering-pure.js",
  // Layer 5: Diff engine + Redline
  "tests/test-diff-engine.js",
  "tests/test-redline-pure.js",
  // Layer 6: DOCX
  "tests/test-docx-pure.js",
  // Layer 7: Server
  "tests/test-server-store.js",
  "tests/test-api-contracts.js",
  "tests/e2e-smoke.js",
  "tests/test-export-smoke.js",
  "tests/test-state-migration.js",
  "tests/test-app-router.js",
  "tests/test-app-contract-actions.js",
  "tests/test-app-events.js",
  "tests/test-dashboard-pure.js",
  "tests/test-review-risk-pure.js",
  "tests/test-review-actions-pure.js",
  "tests/test-risk-rules-pure.js",
  "tests/test-review-checks-pure.js",
  "tests/test-review-material-pure.js",
  "tests/test-render-review-pure.js",
  "tests/test-http-utils.js",
  "tests/test-api-client.js",
  "tests/test-analysis-cache.js",
  "tests/test-jobs.js",
  "tests/test-routes-static.js",
  "tests/test-routes-api.js",
  "tests/test-review-index-pure.js",
  "tests/test-review-tree-pure.js",
  "tests/test-playbook-pure.js",
  "tests/test-server-utils.js",
  "tests/test-suggestion-action-pure.js",
  "tests/test-visual-qa-pure.js",
  "tests/test-legal-skill-pure.js",
  "tests/test-portable-runtime-pure.js",
  "tests/test-contract-intake-adapter.js",
  "tests/test-runner-health-adapters.js",
  "tests/test-contract-library-pure.js",
  "tests/test-drafting-pure.js",
  "tests/test-counterparties-pure.js",
  "tests/test-review-reorder-pure.js",
  "tests/test-analysis-fallback-pure.js",
  //"tests/test-server-api.js", // Commented out: requires server startup
];

const root = path.resolve(__dirname, "..");
let totalPassed = 0;
let totalFailed = 0;
let failedFiles = [];
let sandboxBlocked = false;

console.log("╔════════════════════════════════════════════════════════════╗");
console.log("║     Legal Contract Workbench - Comprehensive Test Suite    ║");
console.log("╚════════════════════════════════════════════════════════════╝");

for (const file of testFiles) {
  const fullPath = path.join(root, file);
  const relPath = path.relative(root, fullPath);
  console.log(`\n▶ ${relPath}`);
  const result = spawnSync(process.execPath, [fullPath], {
    cwd: root,
    encoding: "utf8",
    timeout: 120000,
  });
  if (result.error?.code === "EPERM") {
    sandboxBlocked = true;
    console.error("Nested Node child processes are blocked in the current sandbox. Run individual test files directly instead of tests/test-runner.js.");
    break;
  }
  const output = result.stdout || "";
  if (output) process.stdout.write(output);
  if (result.status === 0) {
    // Parse "X/Y passed" from output
    const match = output.match(/(\d+)\/(\d+) passed/);
    if (match) {
      totalPassed += Number(match[1]);
      totalFailed += Number(match[2]) - Number(match[1]);
    }
  } else {
    process.stderr.write(result.stderr || result.error?.message || "");
    totalFailed += 1;
    failedFiles.push(file);
  }
}

console.log("\n" + "=".repeat(60));
if (sandboxBlocked) {
  console.log("Test runner stopped early because the sandbox blocked child process creation.");
} else {
  console.log(`Total: ${totalPassed} passed, ${totalFailed} failed`);
}

if (failedFiles.length) {
  console.log(`\nFailed test files:`);
  failedFiles.forEach((f) => console.log(`  ✗ ${f}`));
}

console.log("=".repeat(60));

process.exit(totalFailed > 0 || sandboxBlocked ? 1 : 0);
