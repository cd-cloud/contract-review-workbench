function legalWorkbenchFetch(input, init = {}) {
  const headers = new Headers(init.headers || {});
  const token = window.LEGAL_WORKBENCH_API_TOKEN;
  if (token) headers.set("X-Legal-Workbench-Token", token);
  return fetch(input, { ...init, headers });
}
