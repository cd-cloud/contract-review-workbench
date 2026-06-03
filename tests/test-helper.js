/**
 * Test helper for running browser-side JS in Node.js.
 * Provides minimal globals and a test runner.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

// Minimal browser globals for pure-function tests
global.window = global;
global.document = { querySelector: () => null };
global.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; },
};

// Load a JS file into global scope (simulating <script> tag)
function loadScript(relativePath) {
  const fullPath = path.resolve(__dirname, "..", relativePath);
  const code = fs.readFileSync(fullPath, "utf8");
  // Use indirect eval to run in global scope
  const geval = eval;
  geval(code);
}

// Simple test runner
let totalTests = 0;
let passedTests = 0;
let failedTests = [];

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (error) {
    failedTests.push({ name, error });
    process.stdout.write(`  ✗ ${name}\n`);
    process.stdout.write(`    ${error.message}\n`);
  }
}

function testAsync(name, fn) {
  totalTests++;
  return fn()
    .then(() => {
      passedTests++;
      process.stdout.write(`  ✓ ${name}\n`);
    })
    .catch((error) => {
      failedTests.push({ name, error });
      process.stdout.write(`  ✗ ${name}\n`);
      process.stdout.write(`    ${error.message}\n`);
    });
}

function summary() {
  const failed = totalTests - passedTests;
  process.stdout.write(`\n${passedTests}/${totalTests} passed${failed ? `, ${failed} failed` : ""}\n`);
  if (failed) {
    process.stdout.write(`\nFailed tests:\n`);
    failedTests.forEach(({ name, error }) => {
      process.stdout.write(`  - ${name}: ${error.message}\n`);
    });
    process.exit(1);
  }
}

module.exports = { loadScript, test, testAsync, summary, assert };
