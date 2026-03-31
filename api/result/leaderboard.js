const StudentResult = require("../../backend/models/StudentResult");
const { connectToDatabase, getMongoUri } = require("../_lib/db");

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function normalizeName(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.replace(/\s+/g, " ").slice(0, 60);
}

function normalizeRollNo(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.toUpperCase().slice(0, 32);
}

function normalizeSgpa(value) {
  const sgpa = Number(value);
  if (!Number.isFinite(sgpa)) return null;
  if (sgpa < 0 || sgpa > 10) return null;
  return Number(sgpa.toFixed(2));
}

function normalizeSemester(value) {
  if (value === null || value === undefined || value === "") return null;
  const sem = Number.parseInt(value, 10);
  if (!Number.isFinite(sem) || sem < 1 || sem > 12) return null;
  return sem;
}

function normalizeLimit(value, fallback = 10) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 50);
}

function toLeaderboardEntry(record) {
  const sgpa = normalizeSgpa(record?.sgpa);
  if (sgpa === null) return null;
  return {
    id: record?._id ? String(record._id) : null,
    name: normalizeName(record?.leaderboardName || record?.name || "Anonymous"),
    rollNo: record?.rollNo || null,
    semester: normalizeSemester(record?.semester),
    sgpa,
    updatedAt: record?.updatedAt || null
  };
}

function rankEntries(entries, limit) {
  const sorted = entries
    .filter(Boolean)
    .sort((a, b) => {
      if (b.sgpa !== a.sgpa) return b.sgpa - a.sgpa;
      return new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime();
    })
    .slice(0, limit);

  return sorted.map((entry, index) => ({
    rank: index + 1,
    name: entry.name,
    rollNo: entry.rollNo,
    semester: entry.semester,
    sgpa: entry.sgpa,
    updatedAt: entry.updatedAt
  }));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      throw new Error("Invalid JSON body");
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new Error("Invalid JSON body");
  }
}

function safeErrorMessage(error) {
  if (!error) return "Server error";
  const message = typeof error.message === "string" ? error.message.trim() : "";
  if (!message) return "Server error";
  if (/MONGODB_URI|MONGO_URI/i.test(message)) return "Database unavailable";
  return message;
}

async function ensureDatabase(res) {
  if (!getMongoUri()) {
    sendJson(res, 503, { error: "Leaderboard is unavailable because database is not configured" });
    return false;
  }
  const conn = await connectToDatabase({ required: false });
  if (!conn) {
    sendJson(res, 503, { error: "Leaderboard is unavailable because database is not configured" });
    return false;
  }
  return true;
}

async function fetchLeaderboard(limit) {
  const docs = await StudentResult.find({
    leaderboardOptIn: true,
    sgpa: { $ne: null }
  })
    .select("leaderboardName name rollNo semester sgpa updatedAt")
    .lean();

  const entries = docs.map(toLeaderboardEntry);
  return rankEntries(entries, limit);
}

async function handleGet(req, res) {
  const base = `http://${req.headers.host || "localhost"}`;
  const url = new URL(req.url || "/api/result/leaderboard", base);
  const limit = normalizeLimit(url.searchParams.get("limit"), 10);

  const available = await ensureDatabase(res);
  if (!available) return;

  const entries = await fetchLeaderboard(limit);
  return sendJson(res, 200, {
    count: entries.length,
    entries
  });
}

async function handlePost(req, res) {
  const available = await ensureDatabase(res);
  if (!available) return;

  const body = await readJsonBody(req);
  const optIn = body.optIn !== false;
  if (!optIn) {
    return sendJson(res, 200, { ok: true, optedIn: false });
  }

  const name = normalizeName(body.name);
  const sgpa = normalizeSgpa(body.sgpa);
  const rollNo = normalizeRollNo(body.rollNo);
  const semester = normalizeSemester(body.semester);

  if (!name) {
    return sendJson(res, 400, { error: "Name is required for leaderboard" });
  }
  if (sgpa === null) {
    return sendJson(res, 400, { error: "Valid SGPA (0 to 10) is required for leaderboard" });
  }

  const baseUpdate = {
    name,
    sgpa,
    leaderboardOptIn: true,
    leaderboardName: name
  };
  if (semester !== null) {
    baseUpdate.semester = semester;
  }

  let savedDoc = null;
  if (rollNo) {
    const filter = { rollNo, semester: semester !== null ? semester : null };
    const update = { ...baseUpdate, rollNo };
    savedDoc = await StudentResult.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    });
  } else {
    savedDoc = await StudentResult.create(baseUpdate);
  }

  const entries = await fetchLeaderboard(10);
  const rank = entries.find((entry) => {
    if (rollNo && entry.rollNo) {
      return entry.rollNo === rollNo && entry.semester === (semester !== null ? semester : null);
    }
    return (
      entry.name === name &&
      entry.sgpa === sgpa &&
      String(entry.updatedAt || "") === String(savedDoc.updatedAt || "")
    );
  })?.rank || null;

  return sendJson(res, 200, {
    ok: true,
    optedIn: true,
    rank,
    entries
  });
}

async function handleLeaderboard(req, res) {
  try {
    if (req.method === "GET") {
      return await handleGet(req, res);
    }
    if (req.method === "POST") {
      return await handlePost(req, res);
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return sendJson(res, 500, { error: safeErrorMessage(error) });
  }
}

module.exports = handleLeaderboard;
