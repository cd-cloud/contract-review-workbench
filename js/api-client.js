function legalWorkbenchApiUrl(input) {
  const raw = String(input || "");
  const config = window.LEGAL_WORKBENCH_CONFIG || {};
  const backendOrigin =
    config.backendOrigin ||
    window.LEGAL_WORKBENCH_BACKEND_ORIGIN ||
    (window.location && window.location.origin) ||
    "http://127.0.0.1:8787";

  if (!raw) return backendOrigin;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.pathname.startsWith("/api/")) {
        return `${backendOrigin}${url.pathname}${url.search}${url.hash}`;
      }
    } catch (error) {
      return raw;
    }
    return raw;
  }
  return new URL(raw, backendOrigin).toString();
}

function legalWorkbenchFetch(input, init = {}) {
  const headers = new Headers(init.headers || {});
  const token = window.LEGAL_WORKBENCH_API_TOKEN || window.LEGAL_WORKBENCH_CONFIG?.apiToken;
  if (token) headers.set("X-Legal-Workbench-Token", token);
  return fetch(legalWorkbenchApiUrl(input), { ...init, headers });
}
