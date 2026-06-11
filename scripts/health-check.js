const http = require("http");

function request(url, headers = {}) {
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
        resolve({ body, headers: res.headers });
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error(`${url} timed out`));
    });
  });
}

async function requestText(url, headers = {}) {
  const response = await request(url, headers);
  return response.body;
}

async function requestJson(url, headers = {}) {
  const text = await requestText(url, headers);
  return JSON.parse(text);
}

function parseRuntimeConfig(source) {
  const origin = source.match(/LEGAL_WORKBENCH_BACKEND_ORIGIN\s*=\s*"([^"]+)"/)?.[1] ||
    source.match(/"backendOrigin"\s*:\s*"([^"]+)"/)?.[1];
  return { origin };
}

function cookieHeaderFromResponse(headers = {}) {
  const setCookie = headers["set-cookie"];
  if (!setCookie) return "";
  const items = Array.isArray(setCookie) ? setCookie : [setCookie];
  return items.map((entry) => String(entry).split(";")[0]).join("; ");
}

async function main() {
  const port = process.argv[2] || process.env.LEGAL_WORKBENCH_PORT || "8787";
  const base = `http://127.0.0.1:${port}`;
  let origin = base;
  let cookie = "";
  try {
    const runtimeResponse = await request(`${base}/js/runtime-config.js`);
    const runtime = parseRuntimeConfig(runtimeResponse.body);
    origin = runtime.origin || base;
    cookie = cookieHeaderFromResponse(runtimeResponse.headers);
  } catch (e) {
    // runtime-config.js may be unavailable; fall back to direct API calls
  }
  const headers = cookie ? { Cookie: cookie } : {};
  const health = await requestJson(`${origin}/api/health`, headers);
  const runner = await requestJson(`${origin}/api/legal-review/runner-status`, headers);
  console.log(JSON.stringify({ ok: true, health, runner }, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
