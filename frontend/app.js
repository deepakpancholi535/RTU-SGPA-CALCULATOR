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
const healthDotEl = document.getElementById("healthDot");
const buildBadgeEl = document.getElementById("buildBadge");
const themeSwitchEl = document.getElementById("themeSwitch");
const themeButtons = Array.from(document.querySelectorAll("[data-theme-choice]"));

const HISTORY_KEY = "rtu_result_history_v1";
const HISTORY_LIMIT = 10;
const UI_BUILD = "v15";
const THEME_KEY = "rtu_ui_theme_v1";
const THEME_CHOICES = ["light", "mid", "dark"];
const DEFAULT_REMOTE_API_BASE = "";

let currentFile = null;
let lastResponse = null;
let lastTrendPoints = [];

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

window.__rtuDebug = {
  getCurrentFile: () => currentFile,
  getFileInputCount: () => (fileInput.files ? fileInput.files.length : 0),
  getHistoryCount: () => loadHistory().length,
  getPreferredApiBase: () => preferredApiBase,
  getApiBases: () => [...API_BASES],
  getFallbackApiBase: () => CONFIGURED_FALLBACK_API_BASE || null,
  getTheme: () => document.body.dataset.theme || null,
};

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
    return "API route not found (404). Redeploy using the latest Vercel routing config.";
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

  trendStatusEl.textContent = "Loading trend...";

  try {
    const response = await fetchApiWithFallback("/history", {
      query: `?rollNo=${encodeURIComponent(rollNo)}&limit=8`,
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
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const saveHistory = (entries) => {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
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
    if (!response.ok) throw new Error("Health endpoint failed");
    const payload = await response.json();
    const usingFallback = preferredApiBase !== API_BASES[0];
    healthDotEl.textContent = usingFallback ? "API: Live (Fallback)" : "API: Live";
    healthDotEl.dataset.state = "ok";
    if (buildBadgeEl) {
      const version = payload?.version ? `API ${payload.version}` : "API ?";
      buildBadgeEl.textContent = `Build ${UI_BUILD} | ${version}`;
    }
  } catch (error) {
    healthDotEl.textContent = "API: Unreachable";
    healthDotEl.dataset.state = "error";
    if (buildBadgeEl) {
      buildBadgeEl.textContent = `Build ${UI_BUILD}`;
    }
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
    setStatus("Result parsed successfully.", "success");
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
    localStorage.removeItem(HISTORY_KEY);
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

window.addEventListener("resize", () => {
  drawTrendChart(lastTrendPoints);
});

clearTable();
renderConfidence(null);
renderHistory();
initThemeToggle();
drawTrendChart([]);
checkHealth();
window.setInterval(checkHealth, 60000);
