const fileInput = document.getElementById("fileInput");
const dropzone = document.getElementById("dropzone");
const pickBtn = document.getElementById("pickBtn");
const analyzeBtn = document.getElementById("analyzeBtn");
const statusEl = document.getElementById("status");
const fileMeta = document.getElementById("fileMeta");
const subjectsBody = document.getElementById("subjectsBody");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const pdfBtn = document.getElementById("pdfBtn");

const rollNoEl = document.getElementById("rollNo");
const nameEl = document.getElementById("studentName");
const branchEl = document.getElementById("branch");
const semesterEl = document.getElementById("semester");
const sgpaEl = document.getElementById("sgpa");
const creditsEl = document.getElementById("credits");
const gradePointsEl = document.getElementById("gradePoints");

let currentFile = null;
let lastResponse = null;

const STORAGE_KEY = "rtu-last-response";
const STORAGE_TS_KEY = "rtu-last-response-ts";


const API_URL =
  window.location.hostname.includes("localhost")
    ? "http://localhost:5000/api/result/calculate"
    : "https://rtu-sgpa-calculator-production.up.railway.app/api/result/calculate";


document.addEventListener("submit", (event) => {
  event.preventDefault();
  event.stopPropagation();
});

window.__rtuDebug = {
  getCurrentFile: () => currentFile,
  getFileInputCount: () => (fileInput.files ? fileInput.files.length : 0),
  dumpStorage: () => ({
    session: sessionStorage.getItem(STORAGE_KEY),
    local: localStorage.getItem(STORAGE_KEY),
  }),
};

const setStatus = (message, state = "") => {
  statusEl.textContent = message;
  if (state) {
    statusEl.dataset.state = state;
  } else {
    statusEl.removeAttribute("data-state");
  }
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

const setFile = (file) => {
  currentFile = file || null;
  if (!currentFile) {
    fileMeta.textContent = "No file selected.";
    return;
  }
  fileMeta.textContent = `${currentFile.name} (${formatFileSize(
    currentFile.size
  )})`;
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

const renderResult = (data) => {
  lastResponse = data;
  try {
    const payload = JSON.stringify(data);
    sessionStorage.setItem(STORAGE_KEY, payload);
    sessionStorage.setItem(STORAGE_TS_KEY, String(Date.now()));
    localStorage.setItem(STORAGE_KEY, payload);
  } catch (error) {
    // ignore storage issues
  }
  setSummary(data);
  renderSubjects(data?.subjects || []);
};

const toDisplayString = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
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

  const tableBody = (data.subjects || []).map((subject) => [
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
      head: [[
        "Subject",
        "Code",
        "Credits",
        "Marks",
        "Grade",
        "Point",
        "Contribution",
      ]],
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
  doc.text(
    "Generated with RTU Result Analyzer",
    40,
    pageHeight - 20
  );

  const fileName = `${data.rollNo || "rtu-result"}.pdf`;
  doc.save(fileName);
};

pickBtn.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
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

    const response = await fetch(API_URL, {
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
            message = text;
          }
        } catch (err) {
          message = text;
        }
      }
      throw new Error(message);
    }

    const data = await response.json();
    renderResult(data);
    setStatus("Result parsed successfully.", "success");
  } catch (error) {
    setStatus(error.message || "Unable to parse the result.", "error");
  } finally {
    analyzeBtn.classList.remove("is-loading");
    analyzeBtn.disabled = false;
  }
});

copyBtn.addEventListener("click", async (event) => {
  event.preventDefault();
  if (!lastResponse) {
    setStatus("No data to copy yet.", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastResponse, null, 2));
    setStatus("JSON copied to clipboard.", "success");
  } catch (error) {
    setStatus("Copy failed. Try download instead.", "error");
  }
});

downloadBtn.addEventListener("click", (event) => {
  event.preventDefault();
  if (!lastResponse) {
    setStatus("No data to download yet.", "error");
    return;
  }
  const blob = new Blob([JSON.stringify(lastResponse, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${lastResponse.rollNo || "rtu-result"}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setStatus("JSON downloaded.", "success");
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

clearTable();

(() => {
  try {
    const cached =
      sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
    if (!cached) return;
    const parsed = JSON.parse(cached);
    renderResult(parsed);
    const ts = sessionStorage.getItem(STORAGE_TS_KEY);
    if (ts) {
      const when = new Date(Number(ts));
      setStatus(`Restored last result from ${when.toLocaleString()}.`, "success");
    }
  } catch (error) {
    // ignore
  }
})();
