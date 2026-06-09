const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.resolve(__dirname, "../js/api-client.js"), "utf8");

function loadClient(token) {
  const calls = [];
  const context = {
    Headers,
    URL,
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
    assert.strictEqual(calls[0].input, "http://127.0.0.1:8787/api/db");
    assert.strictEqual(calls[0].init.headers.has("X-Legal-Workbench-Token"), false);
    assert.strictEqual(calls[0].init.headers.get("Content-Type"), "application/json");
    assert.strictEqual(calls[0].init.credentials, "include");
  }

  {
    const { client, calls } = loadClient("");
    await client("/api/db");
    assert.strictEqual(calls[0].init.headers.has("X-Legal-Workbench-Token"), false);
  }

  {
    const calls = [];
    const context = {
      Headers,
      URL,
      window: {
        LEGAL_WORKBENCH_CONFIG: {
          apiToken: "config-token",
          backendOrigin: "http://127.0.0.1:8791",
        },
      },
      fetch(input, init) {
        calls.push({ input, init });
        return Promise.resolve({ ok: true });
      },
    };
    vm.runInNewContext(source, context);
    await context.legalWorkbenchFetch("http://localhost:8787/api/contracts?x=1");
    assert.strictEqual(calls[0].input, "http://127.0.0.1:8791/api/contracts?x=1");
    assert.strictEqual(calls[0].init.headers.has("X-Legal-Workbench-Token"), false);
    assert.strictEqual(calls[0].init.credentials, "include");
  }

  console.log("3/3 passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
