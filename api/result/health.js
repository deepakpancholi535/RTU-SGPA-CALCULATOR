const APP_VERSION = process.env.APP_VERSION || "1.0.0";
const { sendJson } = require("../_lib/http");

function handleHealth(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  return sendJson(res, 200, {
    status: "ok",
    service: "rtu-result-api",
    version: APP_VERSION,
    timestamp: new Date().toISOString()
  });
}

module.exports = handleHealth;
