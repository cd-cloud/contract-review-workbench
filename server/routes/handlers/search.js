const { sendJson, serverErrorPayload } = require("../../http-utils");
const { search, searchContracts, searchClauses } = require("../../store");

async function handleSearch(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/search") {
    try {
      const query = url.searchParams.get("q") || "";
      const types = (url.searchParams.get("types") || "").split(",").filter(Boolean);
      const contractId = url.searchParams.get("contractId") || null;
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 50), 200));
      const results = search(query, { types, limit, contractId });
      sendJson(res, 200, { ok: true, query, results }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Search failed"), req);
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/search/contracts") {
    try {
      const query = url.searchParams.get("q") || "";
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 20), 100));
      const results = searchContracts(query, limit);
      sendJson(res, 200, { ok: true, query, results }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Contract search failed"), req);
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/search/clauses") {
    try {
      const query = url.searchParams.get("q") || "";
      const contractId = url.searchParams.get("contractId") || null;
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 20), 100));
      const results = searchClauses(query, contractId, limit);
      sendJson(res, 200, { ok: true, query, contractId, results }, req);
    } catch (error) {
      sendJson(res, error.statusCode || 500, serverErrorPayload(error, "Clause search failed"), req);
    }
    return true;
  }

  return false;
}

module.exports = { handleSearch };
