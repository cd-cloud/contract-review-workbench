const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.resolve(__dirname, "../js/api-client.js"), "utf8");

function loadClient(token) {
  const calls = [];
  const context = {
    Headers,
    window: { LEGAL_WORKBENCH_API_TOKEN: token },
    fetch(input, init) {
      calls.push({ input, init });
      return Promise.resolve({ ok: true });
    },
  };
  vm.runInNewContext(source, context);
  return { client: context.legalWorkbenchFetch, calls };
}

async function main() {
  {
    const { client, calls } = loadClient("test-token");
    await client("/api/db", { headers: { "Content-Type": "application/json" } });
    assert.strictEqual(calls[0].init.headers.get("X-Legal-Workbench-Token"), "test-token");
    assert.strictEqual(calls[0].init.headers.get("Content-Type"), "application/json");
  }

  {
    const { client, calls } = loadClient("");
    await client("/api/db");
    assert.strictEqual(calls[0].init.headers.has("X-Legal-Workbench-Token"), false);
  }

  console.log("2/2 passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
