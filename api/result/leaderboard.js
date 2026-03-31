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

function normalizeBranch(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return text.replace(/\s+/g, " ").toUpperCase().slice(0, 48);
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

function normalizeTotalMarks(value) {
  const marks = Number(value);
  if (!Number.isFinite(marks) || marks < 0) return null;
  return Number(marks.toFixed(2));
}

function sumMarksFromSubjects(subjects) {
  if (!Array.isArray(subjects) || !subjects.length) return null;
  let total = 0;
  let found = false;
  subjects.forEach((subject) => {
    const marks = Number(subject?.marks);
    if (!Number.isFinite(marks)) return;
    total += marks;
    found = true;
  });
  if (!found) return null;
  return Number(total.toFixed(2));
}

function normalizeLimit(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 20000);
}

function toLeaderboardEntry(record) {
  const sgpa = normalizeSgpa(record?.sgpa);
  if (sgpa === null) return null;
  const totalMarksSum =
    normalizeTotalMarks(record?.leaderboardTotalMarks) ?? sumMarksFromSubjects(record?.subjects);
  return {
    id: record?._id ? String(record._id) : null,
    name: normalizeName(record?.leaderboardName || record?.name || "Anonymous"),
    rollNo: record?.rollNo || null,
    branch: normalizeBranch(record?.branch),
    semester: normalizeSemester(record?.semester),
    sgpa,
    totalMarksSum,
    updatedAt: record?.updatedAt || null
  };
}

function getEntryIdentity(entry) {
  if (entry?.rollNo) return `roll:${entry.rollNo}`;
  return `anon:${String(entry?.name || "").toLowerCase()}|branch:${entry?.branch || "NA"}`;
}

function dedupeEntries(entries) {
  const byIdentity = new Map();
  entries.filter(Boolean).forEach((entry) => {
    const key = getEntryIdentity(entry);
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, entry);
      return;
    }

    const existingTime = new Date(existing.updatedAt || 0).getTime();
    const currentTime = new Date(entry.updatedAt || 0).getTime();
    if (currentTime > existingTime) {
      byIdentity.set(key, entry);
      return;
    }
    if (currentTime === existingTime) {
      if (entry.sgpa > existing.sgpa) {
        byIdentity.set(key, entry);
        return;
      }
      if (entry.sgpa === existing.sgpa) {
        const existingMarks = normalizeTotalMarks(existing.totalMarksSum) ?? -1;
        const currentMarks = normalizeTotalMarks(entry.totalMarksSum) ?? -1;
        if (currentMarks > existingMarks) {
          byIdentity.set(key, entry);
        }
      }
    }
  });
  return Array.from(byIdentity.values());
}

function rankEntries(entries, limit) {
  const sortedBase = dedupeEntries(entries)
    .sort((a, b) => {
      if (b.sgpa !== a.sgpa) return b.sgpa - a.sgpa;
      const aMarks = normalizeTotalMarks(a.totalMarksSum) ?? -1;
      const bMarks = normalizeTotalMarks(b.totalMarksSum) ?? -1;
      if (bMarks !== aMarks) return bMarks - aMarks;
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    });
  const sorted = Number.isFinite(limit) ? sortedBase.slice(0, limit) : sortedBase;

  return sorted.map((entry, index) => ({
    rank: index + 1,
    name: entry.name,
    rollNo: entry.rollNo,
    branch: entry.branch,
    semester: entry.semester,
    sgpa: entry.sgpa,
    totalMarksSum: entry.totalMarksSum,
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
    .select("leaderboardName name rollNo branch semester sgpa leaderboardTotalMarks subjects.marks updatedAt")
    .lean();

  const entries = docs.map(toLeaderboardEntry);
  return rankEntries(entries, limit);
}

async function handleGet(req, res) {
  const base = `http://${req.headers.host || "localhost"}`;
  const url = new URL(req.url || "/api/result/leaderboard", base);
  const limit = normalizeLimit(url.searchParams.get("limit"), null);

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
  const branch = normalizeBranch(body.branch);
  const semester = normalizeSemester(body.semester);
  const totalMarksSum = normalizeTotalMarks(body.totalMarksSum);

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
  if (branch) {
    baseUpdate.branch = branch;
  }
  if (totalMarksSum !== null) {
    baseUpdate.leaderboardTotalMarks = totalMarksSum;
  }

  let savedDoc = null;
  if (rollNo) {
    await StudentResult.updateMany({ rollNo }, { $set: { leaderboardOptIn: false } });
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

  const entries = await fetchLeaderboard(null);
  const rank = entries.find((entry) => {
    if (rollNo) {
      return entry.rollNo === rollNo;
    }
    return (
      entry.name === name &&
      entry.branch === (branch || null) &&
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
