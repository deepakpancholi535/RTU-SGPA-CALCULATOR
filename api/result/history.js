const StudentResult = require("../../backend/models/StudentResult");
const { connectToDatabase, getMongoUri } = require("../_lib/db");
const {
  verifyResultAccessToken,
  extractBearerTokenFromHeaders,
  normalizeRollNo
} = require("../../backend/utils/accessToken");
const { consumeRateLimit, getClientIp } = require("../../backend/utils/rateLimit");
const { sendJson } = require("../_lib/http");

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSearchParams(req) {
  const base = `http://${req.headers.host || "localhost"}`;
  const url = new URL(req.url || "/api/result/history", base);
  return url.searchParams;
}

async function handleHistory(req, res) {
  const ip = getClientIp(req);
  const rate = consumeRateLimit({
    key: `history:${ip}`,
    windowMs: 60 * 1000,
    max: 30
  });
  if (!rate.allowed) {
    const retryAfter = Math.max(Math.ceil((rate.resetAt - Date.now()) / 1000), 1);
    res.setHeader("Retry-After", String(retryAfter));
    return sendJson(res, 429, { error: "Too many requests. Please try again shortly." });
  }

  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    if (!getMongoUri()) {
      return sendJson(res, 503, { error: "History is unavailable because database is not configured" });
    }
    const conn = await connectToDatabase({ required: false });
    if (!conn) {
      return sendJson(res, 503, { error: "History is unavailable because database is not configured" });
    }

    const params = getSearchParams(req);
    const rollNoRaw = (params.get("rollNo") || "").trim();
    const requestedRollNo = normalizeRollNo(rollNoRaw);
    if (!requestedRollNo) {
      return sendJson(res, 400, { error: "rollNo query parameter is required" });
    }

    const token = extractBearerTokenFromHeaders(req.headers);
    const claims = verifyResultAccessToken(token);
    if (!claims || !claims.rollNo) {
      return sendJson(res, 401, { error: "Unauthorized history request" }, { noStore: true });
    }
    if (claims.rollNo !== requestedRollNo) {
      return sendJson(res, 403, { error: "History access denied for this roll number" }, { noStore: true });
    }

    const limitRaw = parseInt(params.get("limit"), 10);
    const limit = Number.isNaN(limitRaw) ? 8 : Math.min(Math.max(limitRaw, 1), 20);

    const rollNoRegex = new RegExp(`^${escapeRegex(requestedRollNo)}$`, "i");
    const records = await StudentResult.find({ rollNo: rollNoRegex })
      .sort({ semester: 1, updatedAt: -1 })
      .limit(limit)
      .lean();

    const trend = records
      .sort((a, b) => (a.semester || 0) - (b.semester || 0))
      .map((item) => ({
        semester: item.semester || null,
        sgpa: typeof item.sgpa === "number" ? item.sgpa : null,
        totalCredits: typeof item.totalCredits === "number" ? item.totalCredits : null,
        updatedAt: item.updatedAt || null
      }));

    return sendJson(res, 200, {
      rollNo: requestedRollNo,
      count: trend.length,
      trend
    }, { noStore: true });
  } catch (error) {
    const safeError = /MONGODB_URI|MONGO_URI/i.test(String(error?.message || ""))
      ? "Database unavailable"
      : "Server error";
    return sendJson(res, 500, { error: safeError });
  }
}

module.exports = handleHistory;
