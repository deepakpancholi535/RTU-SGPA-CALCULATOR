const StudentResult = require("../../backend/models/StudentResult");
const { connectToDatabase } = require("../_lib/db");

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSearchParams(req) {
  const base = `http://${req.headers.host || "localhost"}`;
  const url = new URL(req.url || "/api/result/history", base);
  return url.searchParams;
}

async function handleHistory(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    await connectToDatabase();

    const params = getSearchParams(req);
    const rollNoRaw = (params.get("rollNo") || "").trim();
    if (!rollNoRaw) {
      return sendJson(res, 400, { error: "rollNo query parameter is required" });
    }

    const limitRaw = parseInt(params.get("limit"), 10);
    const limit = Number.isNaN(limitRaw) ? 8 : Math.min(Math.max(limitRaw, 1), 20);

    const rollNoRegex = new RegExp(`^${escapeRegex(rollNoRaw)}$`, "i");
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
      rollNo: rollNoRaw,
      count: trend.length,
      trend
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Server error" });
  }
}

module.exports = handleHistory;
