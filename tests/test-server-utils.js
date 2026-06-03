const assert = require("assert");
const { parseRunnerJson } = require("../server/utils");

// Parses valid JSON
assert.deepStrictEqual(parseRunnerJson('{"a":1}'), { a: 1 });
assert.deepStrictEqual(parseRunnerJson('[1,2,3]'), [1, 2, 3]);

// Extracts from fenced code block (```json ... ```)
assert.deepStrictEqual(
  parseRunnerJson('```json\n{"b":2}\n```'),
  { b: 2 }
);
assert.deepStrictEqual(
  parseRunnerJson('```\n[4,5,6]\n```'),
  [4, 5, 6]
);

// Extracts from curly braces when no fences
assert.deepStrictEqual(
  parseRunnerJson('prefix {"c":3} suffix'),
  { c: 3 }
);
assert.deepStrictEqual(
  parseRunnerJson('some text\n{"d":4}\nmore text'),
  { d: 4 }
);

// Empty stdout throws
assert.throws(() => parseRunnerJson(""), /empty stdout/);
assert.throws(() => parseRunnerJson(null), /empty stdout/);
assert.throws(() => parseRunnerJson(undefined), /empty stdout/);
assert.throws(() => parseRunnerJson("   "), /empty stdout/);

// Invalid JSON throws
assert.throws(() => parseRunnerJson("not json"), /JSON/);
assert.throws(() => parseRunnerJson("{bad"), /JSON/);

console.log("test-server-utils passed (5 tests)");
