const fileInput = document.getElementById("fileInput");
const dropzone = document.getElementById("dropzone");
const pickBtn = document.getElementById("pickBtn");
const analyzeBtn = document.getElementById("analyzeBtn");
const statusEl = document.getElementById("status");
const fileMeta = document.getElementById("fileMeta");
const subjectsBody = document.getElementById("subjectsBody");
const pdfBtn = document.getElementById("pdfBtn");
const feedbackBtn = document.getElementById("feedbackBtn");

const rollNoEl = document.getElementById("rollNo");
const nameEl = document.getElementById("studentName");
const branchEl = document.getElementById("branch");
const semesterEl = document.getElementById("semester");
const sgpaEl = document.getElementById("sgpa");
const creditsEl = document.getElementById("credits");
const gradePointsEl = document.getElementById("gradePoints");

const historyListEl = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const confidenceBadgeEl = document.getElementById("confidenceBadge");
const matchBadgeEl = document.getElementById("matchBadge");
const creditsBadgeEl = document.getElementById("creditsBadge");
const trendStatusEl = document.getElementById("trendStatus");
const trendChartEl = document.getElementById("trendChart");
const leaderboardStatusEl = document.getElementById("leaderboardStatus");
const leaderboardBodyEl = document.getElementById("leaderboardBody");
const leaderboardPodiumEl = document.getElementById("leaderboardPodium");
const leaderboardSectionsEl = document.getElementById("leaderboardSections");
const leaderboardSectionButtons = Array.from(
  document.querySelectorAll(".leaderboard-section-btn[data-section]")
);
const semesterFilterWrapEl = document.getElementById("semesterFilterWrap");
const branchFilterWrapEl = document.getElementById("branchFilterWrap");
const leaderboardSemesterSelectEl = document.getElementById("leaderboardSemesterSelect");
const leaderboardBranchSelectEl = document.getElementById("leaderboardBranchSelect");
const leaderboardModalEl = document.getElementById("leaderboardModal");
const leaderboardNameInputEl = document.getElementById("leaderboardNameInput");
const leaderboardPromptSgpaEl = document.getElementById("leaderboardPromptSgpa");
const leaderboardSkipBtnEl = document.getElementById("leaderboardSkipBtn");
const leaderboardJoinBtnEl = document.getElementById("leaderboardJoinBtn");
const healthDotEl = document.getElementById("healthDot");
const buildBadgeEl = document.getElementById("buildBadge");
const themeSwitchEl = document.getElementById("themeSwitch");
const themeButtons = Array.from(document.querySelectorAll("[data-theme-choice]"));

const HISTORY_LIMIT = 10;
const LEADERBOARD_TOP_COUNT = 3;
const LEADERBOARD_FETCH_LIMIT = 20000;
const LEADERBOARD_REFRESH_MS = 25000;
const UI_BUILD = "v24";
const THEME_KEY = "rtu_ui_theme_v1";
const THEME_CHOICES = ["light", "mid", "dark"];
const DEFAULT_REMOTE_API_BASE = "";

let currentFile = null;
let lastResponse = null;
let lastTrendPoints = [];
let pendingLeaderboardResult = null;
let leaderboardEntriesCache = [];
let leaderboardSection = "semester";
let historyEntriesCache = [];
let leaderboardFallbackEntriesCache = [];
let leaderboardDecisionCache = {};
const rollTokenCache = new Map();

function normalizeApiBase(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

function resolveConfiguredFallbackApiBase() {
  const fromWindow = normalizeApiBase(
    window.__RTU_API_FALLBACK__ ||
      window.__RTU_FALLBACK_API_BASE__ ||
      window.__RTU_API_BASE__
  );
  if (fromWindow) return fromWindow;

  const fromMeta = normalizeApiBase(
    document.querySelector('meta[name="rtu-api-fallback"]')?.getAttribute("content") || ""
  );
  if (fromMeta) return fromMeta;

  return normalizeApiBase(DEFAULT_REMOTE_API_BASE);
}

const CONFIGURED_FALLBACK_API_BASE = resolveConfiguredFallbackApiBase();

const API_BASE = (() => {
  const host = window.location.hostname || "";
  if (!host) {
    return CONFIGURED_FALLBACK_API_BASE || "/api/result";
  }
  if (host.includes("localhost") || host === "127.0.0.1") {
    return "http://localhost:8080/api/result";
  }
  return "/api/result";
})();

const API_BASES = (() => {
  const urls = [API_BASE];
  const host = window.location.hostname || "";
  const isLocal = host.includes("localhost") || host === "127.0.0.1";
  if (!isLocal && API_BASE.startsWith("/") && CONFIGURED_FALLBACK_API_BASE) {
    urls.push(CONFIGURED_FALLBACK_API_BASE);
  }
  return Array.from(new Set(urls));
})();

let preferredApiBase = API_BASES[0];

function normalizeRollKey(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toUpperCase();
}

function setAccessTokenForResult(result) {
  const roll = normalizeRollKey(result?.rollNo);
  const token = typeof result?.accessToken === "string" ? result.accessToken.trim() : "";
  const expiresAt =
    typeof result?.accessTokenExpiresAt === "string" ? result.accessTokenExpiresAt : null;

  if (!roll || !token) return;

  rollTokenCache.set(roll, {
    token,
    expiresAt,
  });
}

function getAccessTokenForRoll(rollNo) {
  const key = normalizeRollKey(rollNo);
  if (!key) return null;
  const entry = rollTokenCache.get(key);
  if (!entry || !entry.token) return null;

  if (entry.expiresAt) {
    const expiry = new Date(entry.expiresAt).getTime();
    if (!Number.isNaN(expiry) && Date.now() >= expiry) {
      rollTokenCache.delete(key);
      return null;
    }
  }

  return entry.token;
}

function buildApiUrl(base, path, query = "") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}${query}`;
}

async function fetchApiWithFallback(path, options = {}) {
  const method = options.method || "GET";
  const body = options.body;
  const headers = options.headers;
  const query = options.query || "";
  const orderedBases = [preferredApiBase, ...API_BASES.filter((base) => base !== preferredApiBase)];

  let lastResponse = null;
  let lastError = null;
  const attempts = [];

  for (const base of orderedBases) {
    const url = buildApiUrl(base, path, query);
    try {
      const response = await fetch(url, {
        method,
        body,
        headers,
      });
      attempts.push({ base, status: response.status });

      if (response.ok) {
        preferredApiBase = base;
        return response;
      }

      lastResponse = response;
      const retryable =
        response.status === 404 ||
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;
      if (!retryable) {
        return response;
      }
    } catch (error) {
      attempts.push({ base, error: error?.message || "Network error" });
      lastError = error;
    }
  }

  if (lastResponse) {
    const fallbackHadNetworkError = attempts.some((attempt) => typeof attempt.error === "string");
    if (lastResponse.status === 404 && fallbackHadNetworkError) {
      const error = new Error(
        "Primary API returned 404 and fallback API was unreachable. Redeploy latest Vercel config."
      );
      error.attempts = attempts;
      throw error;
    }
    return lastResponse;
  }

  if (lastError) {
    lastError.attempts = attempts;
    throw lastError;
  }

  const unavailable = new Error("Unable to reach API endpoint.");
  unavailable.attempts = attempts;
  throw unavailable;
}

if (buildBadgeEl) {
  buildBadgeEl.textContent = `Build ${UI_BUILD}`;
}

function getSafeTheme(theme) {
  if (THEME_CHOICES.includes(theme)) return theme;
  return "mid";
}

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch (error) {
    return null;
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    // Ignore storage failures in private mode.
  }
}

function applyTheme(theme) {
  const safeTheme = getSafeTheme(theme);
  document.body.dataset.theme = safeTheme;
  themeButtons.forEach((button) => {
    const isActive = button.dataset.themeChoice === safeTheme;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function resolveInitialTheme() {
  const savedTheme = getStoredTheme();
  if (THEME_CHOICES.includes(savedTheme)) return savedTheme;

  const bodyTheme = document.body?.dataset?.theme;
  if (THEME_CHOICES.includes(bodyTheme)) return bodyTheme;

  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "mid";
}

function initThemeToggle() {
  applyTheme(resolveInitialTheme());

  if (!themeSwitchEl) return;
  themeSwitchEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme-choice]");
    if (!button) return;
    const selected = getSafeTheme(button.dataset.themeChoice);
    applyTheme(selected);
    saveTheme(selected);
    drawTrendChart(lastTrendPoints);
  });
}

document.addEventListener("submit", (event) => {
  event.preventDefault();
  event.stopPropagation();
});

if (
  window.location.hostname.includes("localhost") ||
  window.location.hostname === "127.0.0.1"
) {
  window.__rtuDebug = {
    getCurrentFile: () => currentFile,
    getFileInputCount: () => (fileInput.files ? fileInput.files.length : 0),
    getHistoryCount: () => loadHistory().length,
    getPreferredApiBase: () => preferredApiBase,
    getApiBases: () => [...API_BASES],
    getFallbackApiBase: () => CONFIGURED_FALLBACK_API_BASE || null,
    getTheme: () => document.body.dataset.theme || null,
    getLeaderboardEntries: () => loadLeaderboardLocal(),
  };
}

const setStatus = (message, state = "") => {
  statusEl.textContent = message;
  if (state) {
    statusEl.dataset.state = state;
  } else {
    statusEl.removeAttribute("data-state");
  }
};

const sanitizeErrorMessage = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (/NOT_FOUND/i.test(compact)) {
    return "API route not found (404). Verify Vercel project Root Directory is repo root and redeploy.";
  }
  if (/FUNCTION_INVOCATION_FAILED|A server error has occurred/i.test(compact)) {
    return "API function failed (500). Check Vercel env vars (MONGODB_URI or MONGO_URI), then redeploy.";
  }
  if (/MONGODB_URI|MONGO_URI/i.test(compact)) {
    return "MongoDB connection is not configured correctly on Vercel (set MONGODB_URI or MONGO_URI).";
  }
  if (compact.length > 220) {
    return `${compact.slice(0, 217)}...`;
  }
  return compact;
};

const formatNumber = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  const num = Number(value);
  const fixed = num.toFixed(digits);
  return fixed.replace(/\.00$/, "");
};

const formatMarks = (value) => {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (Number.isNaN(Number(value))) {
    return String(value);
  }
  return formatNumber(value, 0);
};

const formatFileSize = (bytes) => {
  if (!bytes && bytes !== 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(1)} ${units[idx]}`;
};

const buildFeedbackEmail = () => {
  if (!feedbackBtn) return null;
  const user = feedbackBtn.dataset.user;
  const domain = feedbackBtn.dataset.domain;
  if (!user || !domain) return null;
  return `${user}@${domain}`;
};

const openFeedbackEmail = () => {
  const email = buildFeedbackEmail();
  if (!email) return;
  const subject = feedbackBtn.dataset.subject || "RTU Result Analyzer Feedback";
  const body = "Hi Deepak,\n\n";
  const mailto = `mailto:${email}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
  window.location.href = mailto;
};

const isPdfFile = (file) => {
  if (!file) return false;
  if (file.type === "application/pdf") return true;
  return /\.pdf$/i.test(file.name || "");
};

const setFile = (file) => {
  currentFile = null;
  if (!file) {
    fileMeta.textContent = "No file selected.";
    return;
  }
  if (!isPdfFile(file)) {
    setStatus("Only PDF files are supported.", "error");
    fileMeta.textContent = "No file selected.";
    return;
  }
  currentFile = file;
  setStatus("");
  fileMeta.textContent = `${currentFile.name} (${formatFileSize(currentFile.size)})`;
};

const clearTable = () => {
  subjectsBody.innerHTML = `
    <tr class="placeholder">
      <td colspan="7">Upload a file to see subject details.</td>
    </tr>
  `;
};

const setSummary = (data) => {
  rollNoEl.textContent = data?.rollNo || "-";
  nameEl.textContent = data?.name || "-";
  branchEl.textContent = data?.branch || "-";
  semesterEl.textContent =
    data?.semester !== null && data?.semester !== undefined ? data.semester : "-";
  sgpaEl.textContent =
    data?.sgpa !== null && data?.sgpa !== undefined ? formatNumber(data.sgpa, 2) : "-";
  creditsEl.textContent =
    data?.totalCredits !== null && data?.totalCredits !== undefined
      ? formatNumber(data.totalCredits, 2)
      : "-";
  gradePointsEl.textContent =
    data?.totalGradePoints !== null && data?.totalGradePoints !== undefined
      ? formatNumber(data.totalGradePoints, 2)
      : "-";
};

const renderSubjects = (subjects) => {
  subjectsBody.innerHTML = "";
  if (!Array.isArray(subjects) || subjects.length === 0) {
    clearTable();
    return;
  }

  subjects.forEach((subject) => {
    const row = document.createElement("tr");
    const cells = [
      subject.subject || subject.subjectName || "-",
      subject.subjectCode || subject.code || subject.courseCode || "-",
      subject.credits ?? "-",
      formatMarks(subject.marks ?? subject.totalMarks ?? subject.score),
      subject.grade ?? "-",
      subject.gradePoint ?? "-",
      subject.contribution ?? "-",
    ];
    cells.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    subjectsBody.appendChild(row);
  });
};

const toDisplayString = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
};

const safeArray = (value) => (Array.isArray(value) ? value : []);

const normalizeAnalysis = (data) => {
  const subjects = safeArray(data?.subjects);
  const analysis = data?.analysis || {};
  const totalParsedRaw = Number(analysis.totalParsed);
  const matchedRaw = Number(analysis.matched);
  const unmatchedRaw = Number(analysis.unmatched);
  const coverageRaw = Number(analysis.coverage);
  const creditsMissingRaw = Number(analysis.creditsMissing);
  const totalParsed = Number.isFinite(totalParsedRaw) ? totalParsedRaw : subjects.length;
  const matched = Number.isFinite(matchedRaw)
    ? matchedRaw
    : Number.isFinite(unmatchedRaw)
      ? Math.max(totalParsed - unmatchedRaw, 0)
      : subjects.length;
  const unmatched = Number.isFinite(unmatchedRaw) ? unmatchedRaw : Math.max(totalParsed - matched, 0);
  const creditsMissing = Number.isFinite(creditsMissingRaw)
    ? creditsMissingRaw
    : subjects.filter((subject) => typeof subject.credits !== "number").length;
  const coverage =
    Number.isFinite(coverageRaw) && coverageRaw >= 0
      ? coverageRaw
      : totalParsed > 0
        ? (matched / totalParsed) * 100
        : 0;

  return {
    totalParsed,
    matched,
    unmatched,
    creditsMissing,
    coverage,
    confidence: String(analysis.confidence || "low").toLowerCase(),
  };
};

const renderConfidence = (data) => {
  const analysis = normalizeAnalysis(data);
  confidenceBadgeEl.textContent = `Confidence: ${analysis.confidence.toUpperCase()}`;
  matchBadgeEl.textContent = `Matched: ${analysis.matched}/${analysis.totalParsed} (${formatNumber(
    analysis.coverage,
    1
  )}%)`;
  creditsBadgeEl.textContent = `Credits Missing: ${analysis.creditsMissing}`;
  creditsBadgeEl.classList.toggle("warn", analysis.creditsMissing > 0);
};

const getTrendPoints = (historyResponse) => {
  const trend = safeArray(historyResponse?.trend)
    .filter((item) => typeof item.semester === "number" && typeof item.sgpa === "number")
    .sort((a, b) => a.semester - b.semester);

  const uniqueBySemester = new Map();
  trend.forEach((entry) => {
    if (!uniqueBySemester.has(entry.semester)) {
      uniqueBySemester.set(entry.semester, entry);
    }
  });

  return Array.from(uniqueBySemester.values());
};

const drawTrendChart = (points) => {
  const canvas = trendChartEl;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.clientWidth || 640;
  const height = canvas.clientHeight || 220;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const left = 36;
  const right = width - 24;
  const top = 18;
  const bottom = height - 28;
  const plotWidth = Math.max(right - left, 1);
  const plotHeight = Math.max(bottom - top, 1);
  const chartStyles = getComputedStyle(document.body);
  const gridColor = chartStyles.getPropertyValue("--chart-grid").trim() || "rgba(28, 31, 38, 0.12)";
  const lineColor = chartStyles.getPropertyValue("--chart-line").trim() || "#ff7a59";
  const pointColor = chartStyles.getPropertyValue("--chart-point").trim() || "#2bbf9b";
  const textColor = chartStyles.getPropertyValue("--chart-text").trim() || "#1c1f26";
  const mutedTextColor = chartStyles.getPropertyValue("--chart-muted").trim() || "rgba(28, 31, 38, 0.56)";

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  [0, 2.5, 5, 7.5, 10].forEach((mark) => {
    const y = bottom - (mark / 10) * plotHeight;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  });

  if (!points.length) {
    ctx.fillStyle = mutedTextColor;
    ctx.font = '12px "Bricolage Grotesque", sans-serif';
    ctx.fillText("No trend data available yet.", left, top + 20);
    return;
  }

  const xForIndex = (index) => {
    if (points.length === 1) return left + plotWidth / 2;
    return left + (index / (points.length - 1)) * plotWidth;
  };
  const yForSgpa = (sgpa) => {
    const normalized = Math.max(0, Math.min(10, Number(sgpa) || 0));
    return bottom - (normalized / 10) * plotHeight;
  };

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xForIndex(index);
    const y = yForSgpa(point.sgpa);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  points.forEach((point, index) => {
    const x = xForIndex(index);
    const y = yForSgpa(point.sgpa);
    ctx.fillStyle = pointColor;
    ctx.beginPath();
    ctx.arc(x, y, 4.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = textColor;
    ctx.font = '11px "Bricolage Grotesque", sans-serif';
    ctx.fillText(`S${point.semester}`, x - 10, bottom + 16);
    if (typeof point.sgpa === "number") {
      ctx.fillText(formatNumber(point.sgpa, 2), x - 12, y - 10);
    }
  });
};

const loadTrend = async (rollNo) => {
  if (!rollNo) {
    trendStatusEl.textContent = "Trend available after roll number detection.";
    lastTrendPoints = [];
    drawTrendChart([]);
    return;
  }
  const accessToken = getAccessTokenForRoll(rollNo);
  if (!accessToken) {
    trendStatusEl.textContent = "Trend is locked for privacy. Re-analyze your result to refresh access.";
    lastTrendPoints = [];
    drawTrendChart([]);
    return;
  }

  trendStatusEl.textContent = "Loading trend...";

  try {
    const response = await fetchApiWithFallback("/history", {
      query: `?rollNo=${encodeURIComponent(rollNo)}&limit=8`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      throw new Error(`History request failed (${response.status})`);
    }

    const history = await response.json();
    const points = getTrendPoints(history);
    lastTrendPoints = points;
    drawTrendChart(points);
    trendStatusEl.textContent =
      points.length > 0 ? `Loaded ${points.length} semester points.` : "No stored trend yet.";
  } catch (error) {
    lastTrendPoints = [];
    drawTrendChart([]);
    trendStatusEl.textContent = "Trend unavailable right now.";
  }
};

const normalizeLeaderboardName = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  return raw.replace(/\s+/g, " ").trim().slice(0, 60);
};

const normalizeLeaderboardRollNo = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  return raw.trim().toUpperCase().slice(0, 32);
};

const normalizeLeaderboardBranch = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  const branch = raw.replace(/\s+/g, " ").trim().toUpperCase();
  return branch || null;
};

const normalizeLeaderboardSemester = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 8) return null;
  return parsed;
};

const normalizeLeaderboardTotalMarks = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(2));
};

const sumLeaderboardMarksFromSubjects = (subjects) => {
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
};

const normalizeLeaderboardSgpa = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 10) return null;
  return Number(parsed.toFixed(2));
};

const toLeaderboardEntry = (value) => {
  const sgpa = normalizeLeaderboardSgpa(value?.sgpa);
  if (sgpa === null) return null;
  const name = normalizeLeaderboardName(value?.name || value?.leaderboardName || "Anonymous");
  const totalMarksSum =
    normalizeLeaderboardTotalMarks(value?.totalMarksSum) ??
    sumLeaderboardMarksFromSubjects(value?.subjects);
  return {
    name: name || "Anonymous",
    rollNo: normalizeLeaderboardRollNo(value?.rollNo) || null,
    branch: normalizeLeaderboardBranch(value?.branch),
    semester: normalizeLeaderboardSemester(value?.semester),
    sgpa,
    totalMarksSum,
    updatedAt: value?.updatedAt || new Date().toISOString(),
    rank: Number.isFinite(Number(value?.rank)) ? Number(value.rank) : null,
  };
};

const getLeaderboardIdentity = (entry) => {
  const normalized = toLeaderboardEntry(entry);
  if (!normalized) return "";
  if (normalized.rollNo) {
    return `roll:${normalized.rollNo}`;
  }
  return `anon:${normalized.name.toLowerCase()}|branch:${normalized.branch || "NA"}|semester:${
    normalized.semester || "NA"
  }`;
};

const dedupeLeaderboardEntries = (entries) => {
  const byIdentity = new Map();
  safeArray(entries)
    .map(toLeaderboardEntry)
    .filter(Boolean)
    .forEach((entry) => {
      const identity = getLeaderboardIdentity(entry);
      const existing = byIdentity.get(identity);
      if (!existing) {
        byIdentity.set(identity, entry);
        return;
      }
      const existingTime = new Date(existing.updatedAt || 0).getTime();
      const currentTime = new Date(entry.updatedAt || 0).getTime();
      if (currentTime > existingTime) {
        byIdentity.set(identity, entry);
        return;
      }
      if (currentTime === existingTime) {
        if (entry.sgpa > existing.sgpa) {
          byIdentity.set(identity, entry);
          return;
        }
        if (entry.sgpa === existing.sgpa) {
          const existingMarks = normalizeLeaderboardTotalMarks(existing.totalMarksSum) ?? -1;
          const currentMarks = normalizeLeaderboardTotalMarks(entry.totalMarksSum) ?? -1;
          if (currentMarks > existingMarks) {
            byIdentity.set(identity, entry);
          }
        }
      }
    });

  return Array.from(byIdentity.values());
};

const rankLeaderboardEntries = (entries, limit = Number.POSITIVE_INFINITY) => {
  const sorted = dedupeLeaderboardEntries(entries).sort((a, b) => {
    if (b.sgpa !== a.sgpa) return b.sgpa - a.sgpa;
    const aMarks = normalizeLeaderboardTotalMarks(a.totalMarksSum) ?? -1;
    const bMarks = normalizeLeaderboardTotalMarks(b.totalMarksSum) ?? -1;
    if (bMarks !== aMarks) return bMarks - aMarks;
    return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
  });
  const trimmed = Number.isFinite(limit) ? sorted.slice(0, limit) : sorted;
  return trimmed.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
};

const getUniqueSemesterOptions = (entries) =>
  safeArray(entries)
    .map((entry) => normalizeLeaderboardSemester(entry?.semester))
    .filter((value) => value !== null)
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((a, b) => a - b);

const getUniqueBranchOptions = (entries) =>
  safeArray(entries)
    .map((entry) => normalizeLeaderboardBranch(entry?.branch))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b));

const loadLeaderboardLocal = () => {
  return safeArray(leaderboardFallbackEntriesCache);
};

const saveLeaderboardLocal = (entries) => {
  leaderboardFallbackEntriesCache = dedupeLeaderboardEntries(safeArray(entries));
};

const upsertLeaderboardLocal = (entry) => {
  const normalized = toLeaderboardEntry(entry);
  if (!normalized) return dedupeLeaderboardEntries(loadLeaderboardLocal());

  const identity = getLeaderboardIdentity(normalized);
  const existing = loadLeaderboardLocal().map(toLeaderboardEntry).filter(Boolean);
  const next = [
    { ...normalized, updatedAt: new Date().toISOString() },
    ...existing.filter((item) => getLeaderboardIdentity(item) !== identity),
  ];
  const deduped = dedupeLeaderboardEntries(next);
  saveLeaderboardLocal(deduped);
  return deduped;
};

const syncLeaderboardSectionUI = () => {
  leaderboardSectionButtons.forEach((button) => {
    const isActive = button.dataset.section === leaderboardSection;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  if (semesterFilterWrapEl) {
    semesterFilterWrapEl.hidden = leaderboardSection !== "semester";
  }
  if (branchFilterWrapEl) {
    branchFilterWrapEl.hidden = leaderboardSection !== "branch";
  }
};

const setLeaderboardSection = (section) => {
  if (!["semester", "branch"].includes(section)) return;
  leaderboardSection = section;
  syncLeaderboardSectionUI();
  renderLeaderboard(leaderboardEntriesCache);
};

const syncLeaderboardFilters = (entries) => {
  const deduped = dedupeLeaderboardEntries(entries);
  const semesters = getUniqueSemesterOptions(deduped);
  const branches = getUniqueBranchOptions(deduped);

  if (leaderboardSemesterSelectEl) {
    const previous = leaderboardSemesterSelectEl.value;
    leaderboardSemesterSelectEl.innerHTML = '<option value="">Select semester</option>';
    semesters.forEach((semester) => {
      const option = document.createElement("option");
      option.value = String(semester);
      option.textContent = `Semester ${semester}`;
      leaderboardSemesterSelectEl.appendChild(option);
    });

    if (semesters.includes(Number.parseInt(previous, 10))) {
      leaderboardSemesterSelectEl.value = previous;
    } else if (semesters.length) {
      leaderboardSemesterSelectEl.value = String(semesters[0]);
    }
  }

  if (leaderboardBranchSelectEl) {
    const previous = normalizeLeaderboardBranch(leaderboardBranchSelectEl.value);
    leaderboardBranchSelectEl.innerHTML = '<option value="">Select branch</option>';
    branches.forEach((branch) => {
      const option = document.createElement("option");
      option.value = branch;
      option.textContent = branch;
      leaderboardBranchSelectEl.appendChild(option);
    });

    if (previous && branches.includes(previous)) {
      leaderboardBranchSelectEl.value = previous;
    } else if (branches.length) {
      leaderboardBranchSelectEl.value = branches[0];
    }
  }

  syncLeaderboardSectionUI();
};

const getLeaderboardEntriesForCurrentSection = (entries) => {
  const deduped = dedupeLeaderboardEntries(entries);
  if (leaderboardSection === "branch") {
    const branch = normalizeLeaderboardBranch(leaderboardBranchSelectEl?.value);
    if (!branch) return [];
    return deduped.filter((entry) => normalizeLeaderboardBranch(entry.branch) === branch);
  }
  const semester = normalizeLeaderboardSemester(leaderboardSemesterSelectEl?.value);
  if (semester === null) return [];
  return deduped.filter((entry) => entry.semester === semester);
};

const getLeaderboardSectionLabel = () => {
  if (leaderboardSection === "branch") {
    const branch = normalizeLeaderboardBranch(leaderboardBranchSelectEl?.value);
    return branch || "Branch wise";
  }
  const semester = normalizeLeaderboardSemester(leaderboardSemesterSelectEl?.value);
  return semester !== null ? `Semester ${semester}` : "Semester wise";
};

const renderLeaderboardPodium = (ranked) => {
  if (!leaderboardPodiumEl) return;
  const cards = Array.from(leaderboardPodiumEl.querySelectorAll(".podium-card[data-rank]"));
  cards.forEach((card, index) => {
    const rank = index + 1;
    const rankEl = card.querySelector(".podium-rank");
    const nameEl = card.querySelector(".podium-name");
    const sgpaEl = card.querySelector(".podium-sgpa");
    const entry = ranked[index];

    if (rankEl) rankEl.textContent = `#${rank}`;
    if (!entry) {
      if (nameEl) nameEl.textContent = "-";
      if (sgpaEl) sgpaEl.textContent = "SGPA -";
      return;
    }
    if (nameEl) nameEl.textContent = entry.name || "Anonymous";
    if (sgpaEl) sgpaEl.textContent = `SGPA ${formatNumber(entry.sgpa, 2)}`;
  });
};

const renderLeaderboard = (entries, statusMessage = "") => {
  if (!leaderboardBodyEl || !leaderboardStatusEl) return;

  const scopedEntries = getLeaderboardEntriesForCurrentSection(entries);
  const ranked = rankLeaderboardEntries(scopedEntries);
  renderLeaderboardPodium(rankLeaderboardEntries(scopedEntries, LEADERBOARD_TOP_COUNT));
  leaderboardBodyEl.innerHTML = "";

  if (!ranked.length) {
    const requiresFilter =
      (leaderboardSection === "semester" && !normalizeLeaderboardSemester(leaderboardSemesterSelectEl?.value)) ||
      (leaderboardSection === "branch" && !normalizeLeaderboardBranch(leaderboardBranchSelectEl?.value));

    leaderboardBodyEl.innerHTML = `
      <tr class="placeholder">
        <td colspan="3">No leaderboard entries yet.</td>
      </tr>
    `;
    leaderboardStatusEl.textContent =
      statusMessage ||
      (requiresFilter
        ? "Select a filter to view this leaderboard section."
        : `${getLeaderboardSectionLabel()} leaderboard is empty right now.`);
    return;
  }

  ranked.forEach((entry) => {
    const row = document.createElement("tr");
    const cells = [`#${entry.rank}`, entry.name || "Anonymous", formatNumber(entry.sgpa, 2)];
    cells.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    leaderboardBodyEl.appendChild(row);
  });

  leaderboardStatusEl.textContent =
    statusMessage || `${getLeaderboardSectionLabel()} | ${ranked.length} students listed`;
};

const resolveLeaderboardRanksForEntry = (entry, entries) => {
  const normalized = toLeaderboardEntry(entry);
  if (!normalized) {
    return { overallRank: null, sectionRank: null };
  }

  const identity = getLeaderboardIdentity(normalized);
  const overallRank =
    rankLeaderboardEntries(entries, LEADERBOARD_FETCH_LIMIT).find(
      (item) => getLeaderboardIdentity(item) === identity
    )?.rank || null;
  const sectionRank =
    rankLeaderboardEntries(getLeaderboardEntriesForCurrentSection(entries), LEADERBOARD_FETCH_LIMIT).find(
      (item) => getLeaderboardIdentity(item) === identity
    )?.rank || null;

  return { overallRank, sectionRank };
};

const getLeaderboardError = async (response, fallback) => {
  if (!response) return fallback;
  const text = await response.text();
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text);
    return sanitizeErrorMessage(payload?.error || text) || fallback;
  } catch (error) {
    return sanitizeErrorMessage(text) || fallback;
  }
};

const fetchLeaderboardFromApi = async () => {
  const response = await fetchApiWithFallback("/leaderboard");
  if (!response.ok) {
    throw new Error(await getLeaderboardError(response, `Leaderboard request failed (${response.status})`));
  }
  const payload = await response.json();
  return dedupeLeaderboardEntries(payload?.entries || []);
};

const loadLeaderboard = async (options = {}) => {
  const { silent = false } = options;
  if (!silent && leaderboardStatusEl) {
    leaderboardStatusEl.textContent = "Loading leaderboard...";
  }

  try {
    const entries = await fetchLeaderboardFromApi();
    leaderboardEntriesCache = entries;
    saveLeaderboardLocal(entries);
    syncLeaderboardFilters(entries);
    renderLeaderboard(entries);
    return { entries, source: "api" };
  } catch (error) {
    const localEntries = dedupeLeaderboardEntries(loadLeaderboardLocal());
    leaderboardEntriesCache = localEntries;
    syncLeaderboardFilters(localEntries);
    renderLeaderboard(localEntries);
    return { entries: localEntries, source: "local", error };
  }
};

const submitLeaderboardOptIn = async (entry) => {
  const normalized = toLeaderboardEntry(entry);
  if (!normalized) {
    throw new Error("Valid SGPA is required to join leaderboard.");
  }
  const accessToken = getAccessTokenForRoll(normalized.rollNo || entry?.rollNo);
  if (!accessToken) {
    throw new Error("Leaderboard session expired. Re-analyze your result and try again.");
  }

  try {
    const response = await fetchApiWithFallback("/leaderboard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        optIn: true,
        name: normalized.name,
      }),
    });

    if (!response.ok) {
      throw new Error(await getLeaderboardError(response, `Leaderboard update failed (${response.status})`));
    }

    const payload = await response.json();
    const entries = dedupeLeaderboardEntries(payload?.entries || []);
    if (entries.length) {
      saveLeaderboardLocal(entries);
    }
    return {
      rank: Number.isFinite(Number(payload?.rank)) ? Number(payload.rank) : null,
      entries,
      source: "api",
    };
  } catch (error) {
    const entries = upsertLeaderboardLocal(normalized);
    const identity = getLeaderboardIdentity(normalized);
    const rank = rankLeaderboardEntries(entries, LEADERBOARD_FETCH_LIMIT).find(
      (item) => getLeaderboardIdentity(item) === identity
    )?.rank || null;
    return {
      rank,
      entries,
      source: "local",
    };
  }
};

const loadLeaderboardDecisions = () => {
  return leaderboardDecisionCache && typeof leaderboardDecisionCache === "object"
    ? leaderboardDecisionCache
    : {};
};

const saveLeaderboardDecisions = (value) => {
  leaderboardDecisionCache = value && typeof value === "object" ? { ...value } : {};
};

const getLeaderboardDecisionKey = (result) => {
  const rollNo = normalizeLeaderboardRollNo(result?.rollNo);
  if (rollNo) {
    return `roll:${rollNo}`;
  }
  const fallbackName = normalizeLeaderboardName(result?.name || "anonymous").toLowerCase();
  const branch = normalizeLeaderboardBranch(result?.branch) || "NA";
  return `anon:${fallbackName}|branch:${branch}`;
};

const getLeaderboardDecision = (result) => {
  const key = getLeaderboardDecisionKey(result);
  const decisions = loadLeaderboardDecisions();
  const value = decisions[key];
  return value === "yes" || value === "no" ? value : null;
};

const setLeaderboardDecision = (result, decision) => {
  const key = getLeaderboardDecisionKey(result);
  const decisions = loadLeaderboardDecisions();
  decisions[key] = decision;
  saveLeaderboardDecisions(decisions);
};

const isAlreadyInLeaderboard = (result, entries = leaderboardEntriesCache) => {
  const normalized = toLeaderboardEntry(result);
  if (!normalized) return false;
  const identity = getLeaderboardIdentity(normalized);
  return rankLeaderboardEntries(entries, LEADERBOARD_FETCH_LIMIT).some(
    (entry) => getLeaderboardIdentity(entry) === identity
  );
};

const isLeaderboardModalOpen = () => Boolean(leaderboardModalEl && !leaderboardModalEl.hidden);

const closeLeaderboardModal = () => {
  if (!leaderboardModalEl) return;
  leaderboardModalEl.hidden = true;
  document.body.style.removeProperty("overflow");
  pendingLeaderboardResult = null;
};

const openLeaderboardModal = (result) => {
  if (!leaderboardModalEl || !leaderboardNameInputEl || !leaderboardPromptSgpaEl) return;
  pendingLeaderboardResult = result;
  const sgpa = normalizeLeaderboardSgpa(result?.sgpa);
  leaderboardPromptSgpaEl.textContent = `SGPA: ${sgpa !== null ? formatNumber(sgpa, 2) : "-"}`;
  leaderboardNameInputEl.value = normalizeLeaderboardName(result?.name || "");
  leaderboardModalEl.hidden = false;
  document.body.style.overflow = "hidden";
  window.setTimeout(() => leaderboardNameInputEl.focus(), 0);
};

const maybePromptLeaderboardOptIn = (result) => {
  const sgpa = normalizeLeaderboardSgpa(result?.sgpa);
  if (sgpa === null) return;
  if (getLeaderboardDecision(result)) return;
  if (isAlreadyInLeaderboard(result)) {
    setLeaderboardDecision(result, "yes");
    return;
  }
  openLeaderboardModal(result);
};

const buildPdf = (data) => {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("PDF library not loaded. Refresh and try again.");
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFillColor(255, 122, 89);
  doc.rect(0, 0, pageWidth, 90, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.text("RTU Result Summary", 40, 52);
  doc.setFontSize(10);
  doc.text("Generated by RTU Result Analyzer", 40, 72);

  doc.setTextColor(28, 31, 38);
  doc.setFontSize(11);

  const info = [
    ["Roll No", toDisplayString(data.rollNo)],
    ["Name", toDisplayString(data.name)],
    ["Branch", toDisplayString(data.branch)],
    ["Semester", toDisplayString(data.semester)],
  ];

  let infoY = 120;
  const leftX = 40;
  const rightX = pageWidth / 2;
  info.forEach((item, index) => {
    const colX = index % 2 === 0 ? leftX : rightX;
    if (index % 2 === 0 && index > 0) {
      infoY += 24;
    }
    doc.setFont(undefined, "bold");
    doc.text(`${item[0]}:`, colX, infoY);
    doc.setFont(undefined, "normal");
    doc.text(item[1], colX + 70, infoY);
  });

  const metricY = infoY + 34;
  const metricWidth = (pageWidth - 100) / 3;
  const metricHeight = 44;

  const metrics = [
    ["SGPA", formatNumber(data.sgpa, 2)],
    ["Credits", formatNumber(data.totalCredits, 2)],
    ["Grade Points", formatNumber(data.totalGradePoints, 2)],
  ];

  metrics.forEach((metric, index) => {
    const x = 40 + index * (metricWidth + 10);
    doc.setDrawColor(255, 122, 89);
    doc.setFillColor(255, 242, 223);
    doc.roundedRect(x, metricY, metricWidth, metricHeight, 8, 8, "F");
    doc.setFont(undefined, "bold");
    doc.setFontSize(10);
    doc.text(metric[0], x + 12, metricY + 16);
    doc.setFontSize(14);
    doc.text(toDisplayString(metric[1]), x + 12, metricY + 34);
  });

  const tableBody = safeArray(data.subjects).map((subject) => [
    subject.subject || subject.subjectName || "-",
    subject.subjectCode || subject.code || subject.courseCode || "-",
    toDisplayString(subject.credits),
    formatMarks(subject.marks ?? subject.totalMarks ?? subject.score),
    subject.grade ?? "-",
    toDisplayString(subject.gradePoint),
    toDisplayString(subject.contribution),
  ]);

  if (doc.autoTable) {
    doc.autoTable({
      startY: metricY + 70,
      head: [["Subject", "Code", "Credits", "Marks", "Grade", "Point", "Contribution"]],
      body: tableBody,
      theme: "striped",
      headStyles: {
        fillColor: [255, 122, 89],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: {
        0: { cellWidth: 160 },
        1: { cellWidth: 60 },
        2: { cellWidth: 50 },
        3: { cellWidth: 45 },
        4: { cellWidth: 45 },
        5: { cellWidth: 45 },
        6: { cellWidth: 70 },
      },
    });
  } else {
    let y = metricY + 80;
    doc.setFontSize(10);
    doc.text("Subjects:", 40, y);
    y += 16;
    tableBody.forEach((row) => {
      doc.text(row.join(" | "), 40, y);
      y += 12;
      if (y > pageHeight - 40) {
        doc.addPage();
        y = 40;
      }
    });
  }

  doc.setFontSize(9);
  doc.setTextColor(90, 100, 116);
  doc.text("Generated with RTU Result Analyzer", 40, pageHeight - 20);

  const fileName = `${data.rollNo || "rtu-result"}.pdf`;
  doc.save(fileName);
};

const loadHistory = () => {
  return safeArray(historyEntriesCache);
};

const saveHistory = (entries) => {
  historyEntriesCache = safeArray(entries).slice(0, HISTORY_LIMIT);
};

const addToHistory = (data, fileName) => {
  try {
    const entries = loadHistory();
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fileName: fileName || null,
      createdAt: new Date().toISOString(),
      rollNo: data?.rollNo || null,
      semester: data?.semester ?? null,
      sgpa: data?.sgpa ?? null,
      payload: data,
    };
    setAccessTokenForResult(data);

    const nextEntries = [entry, ...entries].slice(0, HISTORY_LIMIT);
    saveHistory(nextEntries);
    return nextEntries;
  } catch (error) {
    return loadHistory();
  }
};

const formatDateTime = (isoValue) => {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

const renderHistory = () => {
  if (!historyListEl) return;
  const entries = loadHistory();
  historyListEl.innerHTML = "";

  if (!entries.length) {
    historyListEl.innerHTML = '<div class="history-empty">No recent analyses yet.</div>';
    return;
  }

  entries.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = "history-item";
    item.dataset.id = entry.id;

    const title = document.createElement("div");
    title.className = "history-title";
    const roll = entry.rollNo || "Unknown Roll";
    const sem = entry.semester ? `Sem ${entry.semester}` : "Sem -";
    title.textContent = `${index + 1}. ${roll} | ${sem}`;

    const meta = document.createElement("div");
    meta.className = "history-meta";
    const filename = entry.fileName || "Uploaded PDF";
    const sgpa = entry.sgpa !== null && entry.sgpa !== undefined ? formatNumber(entry.sgpa, 2) : "-";
    meta.textContent = `${filename} | SGPA ${sgpa} | ${formatDateTime(entry.createdAt)}`;

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "ghost mini-btn";
    loadBtn.dataset.action = "load";
    loadBtn.dataset.id = entry.id;
    loadBtn.textContent = "Load";

    const pdfBtnInner = document.createElement("button");
    pdfBtnInner.type = "button";
    pdfBtnInner.className = "ghost mini-btn";
    pdfBtnInner.dataset.action = "pdf";
    pdfBtnInner.dataset.id = entry.id;
    pdfBtnInner.textContent = "PDF";

    actions.appendChild(loadBtn);
    actions.appendChild(pdfBtnInner);
    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(actions);
    historyListEl.appendChild(item);
  });
};

const renderResult = (data) => {
  lastResponse = data;
  setAccessTokenForResult(data);
  setSummary(data);
  renderSubjects(data?.subjects || []);
  renderConfidence(data);
};

const openHistoryEntry = async (entryId) => {
  const entry = loadHistory().find((item) => item.id === entryId);
  if (!entry || !entry.payload) return;

  renderResult(entry.payload);
  setStatus("Loaded result from history.", "success");
  await loadTrend(entry.payload.rollNo || entry.rollNo || null);
};

const exportHistoryEntryPdf = (entryId) => {
  const entry = loadHistory().find((item) => item.id === entryId);
  if (!entry || !entry.payload) {
    setStatus("Unable to load selected history record.", "error");
    return;
  }
  try {
    buildPdf(entry.payload);
    setStatus("History PDF downloaded.", "success");
  } catch (error) {
    setStatus(error.message || "Unable to generate PDF.", "error");
  }
};

const checkHealth = async () => {
  if (!healthDotEl) return;
  try {
    const response = await fetchApiWithFallback("/health");
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("API route not found (404).");
      }
      throw new Error("Health endpoint failed");
    }
    const payload = await response.json();
    const usingFallback = preferredApiBase !== API_BASES[0];
    healthDotEl.textContent = usingFallback ? "API: Live (Fallback)" : "API: Live";
    healthDotEl.dataset.state = "ok";
    if (buildBadgeEl) {
      const version = payload?.version ? `API ${payload.version}` : "API ?";
      buildBadgeEl.textContent = `Build ${UI_BUILD} | ${version}`;
    }
  } catch (error) {
    const msg = sanitizeErrorMessage(error.message);
    if (msg.includes("route not found")) {
      healthDotEl.textContent = "API: Route 404";
    } else {
      healthDotEl.textContent = "API: Unreachable";
    }
    healthDotEl.dataset.state = "error";
    if (buildBadgeEl) {
      buildBadgeEl.textContent = `Build ${UI_BUILD}`;
    }
  }
};

const handleLeaderboardSkip = () => {
  if (pendingLeaderboardResult) {
    setLeaderboardDecision(pendingLeaderboardResult, "no");
  }
  closeLeaderboardModal();
};

const handleLeaderboardJoin = async () => {
  if (!pendingLeaderboardResult || !leaderboardNameInputEl) {
    closeLeaderboardModal();
    return;
  }

  const displayName = normalizeLeaderboardName(
    leaderboardNameInputEl.value || pendingLeaderboardResult.name || ""
  );
  if (!displayName) {
    setStatus("Enter a display name to join leaderboard.", "error");
    leaderboardNameInputEl.focus();
    return;
  }

  if (leaderboardJoinBtnEl) {
    leaderboardJoinBtnEl.classList.add("is-loading");
    leaderboardJoinBtnEl.disabled = true;
  }
  if (leaderboardSkipBtnEl) {
    leaderboardSkipBtnEl.disabled = true;
  }

  try {
    const joinedEntry = toLeaderboardEntry({
      ...pendingLeaderboardResult,
      name: displayName,
    });
    const submission = await submitLeaderboardOptIn({
      ...pendingLeaderboardResult,
      name: displayName,
    });
    if (submission.source === "api") {
      await loadLeaderboard({ silent: true });
    } else {
      leaderboardEntriesCache = dedupeLeaderboardEntries(submission.entries);
      syncLeaderboardFilters(leaderboardEntriesCache);
      renderLeaderboard(leaderboardEntriesCache, "Showing saved leaderboard");
    }
    setLeaderboardDecision(pendingLeaderboardResult, "yes");
    const { overallRank, sectionRank } = resolveLeaderboardRanksForEntry(
      joinedEntry,
      leaderboardEntriesCache
    );
    if (sectionRank !== null) {
      setStatus(`Added to ${getLeaderboardSectionLabel()} leaderboard at rank #${sectionRank}.`, "success");
    } else if (overallRank !== null || submission.rank) {
      setStatus(`Added to leaderboard. Overall rank #${overallRank || submission.rank}.`, "success");
    } else {
      setStatus("Added to leaderboard.", "success");
    }
  } catch (error) {
    setStatus(sanitizeErrorMessage(error.message) || "Unable to join leaderboard.", "error");
  } finally {
    if (leaderboardJoinBtnEl) {
      leaderboardJoinBtnEl.classList.remove("is-loading");
      leaderboardJoinBtnEl.disabled = false;
    }
    if (leaderboardSkipBtnEl) {
      leaderboardSkipBtnEl.disabled = false;
    }
    closeLeaderboardModal();
  }
};

pickBtn.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  if (!isPdfFile(file)) {
    event.target.value = "";
  }
  setFile(file);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.add("is-dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove("is-dragover");
  });
});

dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) {
    return;
  }
  setFile(file);
});

analyzeBtn.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!currentFile) {
    const fallbackFile = fileInput.files?.[0];
    if (fallbackFile) {
      setFile(fallbackFile);
    }
  }
  if (!currentFile) {
    setStatus("Select a file to analyze.", "error");
    return;
  }

  setStatus("Uploading and analyzing...", "success");
  analyzeBtn.classList.add("is-loading");
  analyzeBtn.disabled = true;

  try {
    const formData = new FormData();
    formData.append("result", currentFile);

    const response = await fetchApiWithFallback("/calculate", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let message = `Request failed with ${response.status}`;
      const text = await response.text();
      if (text) {
        try {
          const errorData = JSON.parse(text);
          if (errorData?.error) {
            message = errorData.error;
          } else {
            message = sanitizeErrorMessage(text) || message;
          }
        } catch (err) {
          message = sanitizeErrorMessage(text) || message;
        }
      }
      throw new Error(message);
    }

    const data = await response.json();
    renderResult(data);
    addToHistory(data, currentFile?.name || null);
    renderHistory();
    await loadTrend(data.rollNo || null);
    await loadLeaderboard();
    setStatus("Result parsed successfully.", "success");
    maybePromptLeaderboardOptIn(data);
  } catch (error) {
    setStatus(sanitizeErrorMessage(error.message) || "Unable to parse the result.", "error");
  } finally {
    analyzeBtn.classList.remove("is-loading");
    analyzeBtn.disabled = false;
  }
});

pdfBtn.addEventListener("click", (event) => {
  event.preventDefault();
  if (!lastResponse) {
    setStatus("No data to export yet.", "error");
    return;
  }
  try {
    buildPdf(lastResponse);
    setStatus("PDF downloaded.", "success");
  } catch (error) {
    setStatus(error.message || "Unable to generate PDF.", "error");
  }
});

if (historyListEl) {
  historyListEl.addEventListener("click", async (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const entryId = target.dataset.id;
    if (!entryId) return;

    if (action === "load") {
      await openHistoryEntry(entryId);
    } else if (action === "pdf") {
      exportHistoryEntryPdf(entryId);
    }
  });
}

if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener("click", () => {
    saveHistory([]);
    rollTokenCache.clear();
    renderHistory();
    setStatus("History cleared.", "success");
  });
}

if (feedbackBtn) {
  feedbackBtn.addEventListener("click", (event) => {
    event.preventDefault();
    openFeedbackEmail();
  });
}

if (leaderboardSectionsEl) {
  leaderboardSectionsEl.addEventListener("click", (event) => {
    const button = event.target.closest(".leaderboard-section-btn[data-section]");
    if (!button) return;
    setLeaderboardSection(button.dataset.section);
  });
}

if (leaderboardSemesterSelectEl) {
  leaderboardSemesterSelectEl.addEventListener("change", () => {
    if (leaderboardSection !== "semester") return;
    renderLeaderboard(leaderboardEntriesCache);
  });
}

if (leaderboardBranchSelectEl) {
  leaderboardBranchSelectEl.addEventListener("change", () => {
    if (leaderboardSection !== "branch") return;
    renderLeaderboard(leaderboardEntriesCache);
  });
}

if (leaderboardSkipBtnEl) {
  leaderboardSkipBtnEl.addEventListener("click", (event) => {
    event.preventDefault();
    handleLeaderboardSkip();
  });
}

if (leaderboardJoinBtnEl) {
  leaderboardJoinBtnEl.addEventListener("click", async (event) => {
    event.preventDefault();
    await handleLeaderboardJoin();
  });
}

if (leaderboardNameInputEl) {
  leaderboardNameInputEl.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    await handleLeaderboardJoin();
  });
}

if (leaderboardModalEl) {
  leaderboardModalEl.addEventListener("click", (event) => {
    if (event.target !== leaderboardModalEl) return;
    handleLeaderboardSkip();
  });
}



document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!isLeaderboardModalOpen()) return;
  handleLeaderboardSkip();
});

window.addEventListener("resize", () => {
  drawTrendChart(lastTrendPoints);
});

clearTable();
renderConfidence(null);
renderHistory();
initThemeToggle();
drawTrendChart([]);
syncLeaderboardSectionUI();
loadLeaderboard();
window.setInterval(() => {
  loadLeaderboard({ silent: true });
}, LEADERBOARD_REFRESH_MS);
checkHealth();
window.setInterval(checkHealth, 60000);
