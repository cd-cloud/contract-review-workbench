const http = require("http");

function requestText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`${url} returned ${res.statusCode}: ${body}`));
          return;
        }
        resolve(body);
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error(`${url} timed out`));
    });
  });
}

async function requestJson(url, headers = {}) {
  const text = await requestText(url, headers);
  return JSON.parse(text);
}

function parseRuntimeConfig(source) {
  const token = source.match(/LEGAL_WORKBENCH_API_TOKEN\s*=\s*"([^"]+)"/)?.[1] ||
    source.match(/"apiToken"\s*:\s*"([^"]+)"/)?.[1];
  const origin = source.match(/LEGAL_WORKBENCH_BACKEND_ORIGIN\s*=\s*"([^"]+)"/)?.[1] ||
    source.match(/"backendOrigin"\s*:\s*"([^"]+)"/)?.[1];
  if (!token) throw new Error("Could not read apiToken from /js/runtime-config.js");
  return { token, origin };
}

async function main() {
  const port = process.argv[2] || process.env.LEGAL_WORKBENCH_PORT || "8787";
  const base = `http://127.0.0.1:${port}`;
  const runtime = parseRuntimeConfig(await requestText(`${base}/js/runtime-config.js`));
  const origin = runtime.origin || base;
  const headers = { "X-Legal-Workbench-Token": runtime.token };
  const health = await requestJson(`${origin}/api/health`, headers);
  const runner = await requestJson(`${origin}/api/legal-review/runner-status`, headers);
  console.log(JSON.stringify({ ok: true, health, runner }, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
