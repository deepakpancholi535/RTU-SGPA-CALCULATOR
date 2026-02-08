const STOPWORDS = new Set([
  "THE",
  "OF",
  "AND",
  "IN",
  "TO",
  "FOR",
  "A",
  "AN",
  "WITH",
  "ON",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "SEM",
  "SEMESTER"
]);

const ROMAN_SEM = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8
};

function normalizeText(text) {
  if (!text) return "";
  let t = text.replace(/\r/g, "\n");
  t = t.replace(/[–—]/g, "-");
  t = t.replace(/[“”]/g, '"').replace(/[’]/g, "'");
  t = t.replace(/[^\x00-\x7F]/g, " ");
  t = t.replace(/([A-Z])0([A-Z])/gi, "$1O$2");
  t = t.replace(/([A-Z])1([A-Z])/gi, "$1I$2");
  t = t.replace(/\s+\n/g, "\n");
  t = t.replace(/\n{2,}/g, "\n");
  return t;
}

function normalizeSubjectName(name) {
  if (!name) return "";
  let n = name.toUpperCase();
  n = n.replace(/&/g, " AND ");
  n = n.replace(/\bDBMS\b/g, "DATABASE MANAGEMENT SYSTEMS");
  n = n.replace(/\bOOP\b/g, "OBJECT ORIENTED PROGRAMMING");
  n = n.replace(/\bCN\b/g, "COMPUTER NETWORKS");
  n = n.replace(/\bOS\b/g, "OPERATING SYSTEMS");
  n = n.replace(/\bAI\b/g, "ARTIFICIAL INTELLIGENCE");
  n = n.replace(/\bML\b/g, "MACHINE LEARNING");
  n = n.replace(/\bDL\b/g, "DEEP LEARNING");
  n = n.replace(/\bNLP\b/g, "NATURAL LANGUAGE PROCESSING");
  n = n.replace(/\bDSP\b/g, "DIGITAL SIGNAL PROCESSING");
  n = n.replace(/\bIOT\b/g, "INTERNET OF THINGS");
  n = n.replace(/\bSE\b/g, "SOFTWARE ENGINEERING");
  n = n.replace(/\bMACHINES\b/g, "MACHINE");
  n = n.replace(/[^A-Z0-9\s]/g, " ");
  n = n.replace(/\b\d{1,3}\b/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

function tokenize(text) {
  if (!text) return [];
  return text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && !STOPWORDS.has(t));
}

function inferIsLab(name) {
  if (!name) return null;
  const upper = name.toUpperCase();
  return /\b(LAB|LABORATORY|PRACTICAL|WORKSHOP|STUDIO)\b/.test(upper) ? true : false;
}

function parseSemester(value) {
  if (!value) return null;
  const v = value.toString().toUpperCase().trim();
  if (ROMAN_SEM[v]) return ROMAN_SEM[v];
  const num = parseInt(v.replace(/\D/g, ""), 10);
  if (num >= 1 && num <= 8) return num;
  return null;
}

function normalizeBranch(value) {
  if (!value) return null;
  const v = value.toUpperCase().replace(/[^A-Z]/g, "");
  if (!v) return null;
  if (v.startsWith("CSE")) return "CSE";
  if (v.startsWith("IT")) return "IT";
  if (v.startsWith("INFORMATIONTECH")) return "IT";
  if (v.startsWith("INFOTECH")) return "IT";
  if (v.startsWith("FY")) return "COMMON";
  if (v.startsWith("ECE") || v === "EC") return "ECE";
  if (v.startsWith("EE") || v === "EEE") return "EE";
  if (v.startsWith("ME")) return "ME";
  if (v.startsWith("CE")) return "CE";
  if (v.startsWith("AIML")) return "AIML";
  if (v.startsWith("AI")) return "AI";
  if (v.startsWith("DS")) return "DS";
  if (v.startsWith("CS")) return "CS";
  return null;
}

function extractMetadata(text) {
  const raw = text || "";
  const lines = raw.split(/\r?\n/);
  let rollNo = null;
  let name = null;
  let branch = null;
  let semester = null;

  for (const line of lines) {
    const upper = line.toUpperCase();

    if (!rollNo) {
      const m = upper.match(/\bROLL\s*(?:NO|NUMBER)\b\s*[:\-]?\s*([A-Z0-9\/-]+)/);
      if (m) {
        rollNo = m[1].replace(/ENROLL.*$/i, "");
      }
    }

    if (!name && /\bNAME\b/.test(upper) && !/COLLEGE\s*NAME/.test(upper)) {
      const nameIdx = upper.indexOf("NAME");
      const fatherIdx = upper.indexOf("FATHER");
      const motherIdx = upper.indexOf("MOTHER");
      const guardianIdx = upper.indexOf("GUARDIAN");
      const stopIdx = [fatherIdx, motherIdx, guardianIdx].filter((i) => i >= 0);
      const earliestStop = stopIdx.length ? Math.min(...stopIdx) : -1;

      if (earliestStop === -1 || nameIdx < earliestStop) {
        const m = line.match(/NAME\s*[:\-]?\s*(.+)$/i);
        if (m) {
          name = m[1]
            .split(/FATHER|MOTHER|HUSBAND|GUARDIAN/i)[0]
            .replace(/[^A-Za-z\s.]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }
      }
    }

    if (!branch && /\bBRANCH\b/.test(upper)) {
      const m = line.match(/BRANCH\s*[:\-]?\s*(.+)$/i);
      if (m) branch = normalizeBranch(m[1]);
    }

    if (!branch && /\bPROGRAM(ME)?\b/.test(upper)) {
      const m = line.match(/PROGRAM(?:ME)?\s*[:\-]?\s*(.+)$/i);
      if (m) branch = normalizeBranch(m[1]);
    }

    if (!semester && /\bSEM(ESTER)?\b/.test(upper)) {
      const m = line.match(/SEM(?:ESTER)?\s*[:\-]?\s*([IVX]+|\d+)/i);
      if (m) semester = parseSemester(m[1]);
    }
  }

  if (!branch || !semester) {
    const detected = detectFromCourseCode(raw.toUpperCase());
    if (!branch) branch = detected.branch;
    if (!semester) semester = detected.semester;
  }

  return { rollNo, name, branch, semester };
}

function detectFromCourseCode(upperText) {
  const regex = /([1-8I])([A-Z]{2,4})\d-\d{2}/g;
  const branchCounts = {};
  const semesterCounts = {};
  let match = null;

  while ((match = regex.exec(upperText)) !== null) {
    const semToken = match[1] === "I" ? "1" : match[1];
    const sem = parseSemester(semToken);
    const br = normalizeBranch(match[2]);
    if (br) branchCounts[br] = (branchCounts[br] || 0) + 1;
    if (sem) semesterCounts[sem] = (semesterCounts[sem] || 0) + 1;
  }

  const pickMostCommon = (counts) => {
    let maxKey = null;
    let maxVal = 0;
    Object.keys(counts).forEach((key) => {
      if (counts[key] > maxVal) {
        maxVal = counts[key];
        maxKey = key;
      }
    });
    return maxKey;
  };

  const branch = pickMostCommon(branchCounts);
  const semester = parseSemester(pickMostCommon(semesterCounts));
  return { branch, semester };
}

function toTitleCase(str) {
  if (!str) return null;
  return str
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

module.exports = {
  normalizeText,
  normalizeSubjectName,
  tokenize,
  inferIsLab,
  extractMetadata,
  normalizeBranch,
  parseSemester,
  toTitleCase
};
