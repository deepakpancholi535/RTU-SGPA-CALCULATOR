const fs = require("fs");
const path = require("path");

let cache = null;

function normalizeCode(code) {
  if (!code) return null;
  return code.toString().toUpperCase().replace(/\s+/g, "");
}

function normalizeTitleKey(title) {
  if (!title) return null;
  return title
    .toString()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadCreditCatalog() {
  if (cache) return cache;

  const filePath = path.join(__dirname, "..", "data", "creditCatalog.json");
  const byCode = new Map();
  const byTitle = new Map();

  if (!fs.existsSync(filePath)) {
    cache = { byCode, byTitle };
    return cache;
  }

  let raw = [];
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    cache = { byCode, byTitle };
    return cache;
  }

  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      const credits =
        typeof item.credits === "number"
          ? item.credits
          : typeof item.Credits === "number"
            ? item.Credits
            : null;

      if (credits === null) return;

      const code = normalizeCode(item.code || item.Code || item.Subject_Code);
      if (code && !byCode.has(code)) {
        byCode.set(code, credits);
      }

      const title = item.Course_Title || item.course_title || item.Subject_Name;
      const titleKey = normalizeTitleKey(title);
      if (titleKey && !byTitle.has(titleKey)) {
        byTitle.set(titleKey, credits);
      }
    });
  }

  cache = { byCode, byTitle };
  return cache;
}

module.exports = {
  loadCreditCatalog,
  normalizeCode,
  normalizeTitleKey
};
