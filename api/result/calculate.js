const fs = require("fs");
const os = require("os");
const path = require("path");
const formidableLib = require("formidable");
const Subject = require("../../backend/models/Subject");
const StudentResult = require("../../backend/models/StudentResult");
const { extractResultData } = require("../../backend/utils/pdfParser");
const { matchSubjects } = require("../../backend/utils/subjectMatcher");
const {
  gradeFromRelativeMarks,
  gradePointFromGrade,
  calculateSgpa,
  round2
} = require("../../backend/utils/gradeCalculator");
const {
  normalizeBranch,
  parseSemester,
  toTitleCase
} = require("../../backend/utils/textNormalizer");
const {
  loadCreditCatalog,
  normalizeCode,
  normalizeTitleKey
} = require("../../backend/utils/creditCatalog");
const { uploadResultFile } = require("../../backend/utils/cloudinary");
const { connectToDatabase, getMongoUri } = require("../_lib/db");

const creditCatalog = loadCreditCatalog();
const createFormidable =
  typeof formidableLib === "function"
    ? formidableLib
    : formidableLib.formidable || formidableLib.default;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function safeMessage(error, fallback = "Server error") {
  if (!error) return fallback;
  if (typeof error.message === "string" && error.message.trim()) {
    const message = error.message.trim();
    if (/MONGODB_URI|MONGO_URI/i.test(message)) {
      return "Database unavailable";
    }
    return message;
  }
  return fallback;
}

function computeRelativeMarks(extracted) {
  if (typeof extracted.totalMarks !== "number") return null;
  if (typeof extracted.maxMarks === "number" && extracted.maxMarks > 0) {
    return (extracted.totalMarks / extracted.maxMarks) * 100;
  }
  if (extracted.isPercentage === true) {
    return extracted.totalMarks;
  }
  return null;
}

function pickMostCommon(counts) {
  let maxKey = null;
  let maxVal = 0;
  Object.keys(counts).forEach((key) => {
    if (counts[key] > maxVal) {
      maxVal = counts[key];
      maxKey = key;
    }
  });
  return maxKey;
}

function buildConfidenceLabel(coverage, creditsMissing, totalParsed) {
  if (!totalParsed) return "low";
  const coverageScore = coverage / 100;
  const creditsPenalty = creditsMissing / totalParsed;
  const score = coverageScore - creditsPenalty * 0.5;

  if (score >= 0.85) return "high";
  if (score >= 0.65) return "medium";
  return "low";
}

function buildAnalysis(parsedSubjects, matched, unmatched, computedSubjects) {
  const totalParsed = parsedSubjects.length;
  const matchedCount = matched.length;
  const unmatchedCount = unmatched.length;
  const coverage = totalParsed > 0 ? round2((matchedCount / totalParsed) * 100) : 0;
  const creditsMissing = computedSubjects.filter((s) => typeof s.credits !== "number").length;
  const gradePointMissing = computedSubjects.filter((s) => typeof s.gradePoint !== "number").length;

  return {
    totalParsed,
    matched: matchedCount,
    unmatched: unmatchedCount,
    coverage,
    creditsMissing,
    gradePointMissing,
    confidence: buildConfidenceLabel(coverage, creditsMissing, totalParsed)
  };
}

function buildUnmatchedDetails(unmatched) {
  return unmatched.map((item) => ({
    subject: item.subjectName || null,
    subjectCode: item.subjectCode || null,
    rawLine: item.rawLine || null
  }));
}

function getFieldValue(fields, key) {
  const value = fields[key];
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function getUploadedFile(files) {
  const file = files.result || files.file || files.upload;
  if (Array.isArray(file)) return file[0];
  return file;
}

async function handleCalculate(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const dbState = {
    ready: false,
    error: null
  };

  try {
    const hasMongoUri = Boolean(getMongoUri());
    if (hasMongoUri) {
      const conn = await connectToDatabase({ required: false });
      dbState.ready = Boolean(conn);
      if (!dbState.ready) {
        dbState.error = "Database unavailable";
      }
    } else {
      dbState.error = "Database unavailable";
    }
  } catch (error) {
    dbState.error = safeMessage(error, "Database unavailable");
  }

  if (typeof createFormidable !== "function") {
    return sendJson(res, 500, { error: "Upload parser is unavailable on this runtime" });
  }

  const form = createFormidable({
    multiples: false,
    keepExtensions: true,
    uploadDir: os.tmpdir(),
    maxFileSize: 10 * 1024 * 1024
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      return sendJson(res, 400, { error: err.message || "Invalid upload" });
    }

    const file = getUploadedFile(files);
    if (!file) {
      return sendJson(res, 400, { error: "Result file is required" });
    }

    const filePath = file.filepath || file.path;
    const mimetype = file.mimetype || file.type || "";
    const originalname = file.originalFilename || file.name || path.basename(filePath);

    const isPdf = mimetype === "application/pdf" || /\.pdf$/i.test(originalname || "");
    if (!isPdf) {
      return sendJson(res, 400, { error: "Only PDF files are allowed" });
    }

    try {
      const parsed = await extractResultData(filePath, mimetype);
      const metadata = parsed.metadata || {};
      const warnings = [];

      if (!dbState.ready) {
        warnings.push(
          "Database is unavailable. Results are computed in parser-only mode (no DB matching/history save)."
        );
      }

      let rollNo = metadata.rollNo || getFieldValue(fields, "rollNo").trim() || null;
      let name = metadata.name || getFieldValue(fields, "name").trim() || null;
      if (name) name = toTitleCase(name);

      let branch = normalizeBranch(metadata.branch || getFieldValue(fields, "branch"));
      let semester = parseSemester(metadata.semester || getFieldValue(fields, "semester"));

      const filters = [];
      if (branch && semester) {
        filters.push({ branch, semester });
        filters.push({ branch: "COMMON", semester });
      } else if (semester && !branch) {
        filters.push({ semester });
      }

      let masterSubjects = [];
      let matchResult = { matched: [], unmatched: parsed.subjects };

      if (dbState.ready) {
        try {
          masterSubjects = await Subject.find(filters.length ? { $or: filters } : {});
          matchResult = matchSubjects(parsed.subjects, masterSubjects);

          const coverage =
            parsed.subjects.length > 0 ? matchResult.matched.length / parsed.subjects.length : 0;

          if (filters.length && coverage < 0.8) {
            let fallbackSubjects = [];
            if (branch && semester) {
              fallbackSubjects = await Subject.find({
                $and: [{ semester }, { $or: [{ branch }, { branch: "COMMON" }] }]
              });
            } else if (semester) {
              fallbackSubjects = await Subject.find({ semester });
            } else if (branch) {
              fallbackSubjects = await Subject.find({ $or: [{ branch }, { branch: "COMMON" }] });
            } else {
              fallbackSubjects = await Subject.find({});
            }
            const fallbackResult = matchSubjects(parsed.subjects, fallbackSubjects);
            if (fallbackResult.matched.length > matchResult.matched.length) {
              matchResult = fallbackResult;
              masterSubjects = fallbackSubjects;
            }
          }
        } catch (error) {
          dbState.ready = false;
          dbState.error = safeMessage(error, "Database query failed");
          matchResult = matchSubjects(parsed.subjects, []);
          warnings.push(
            "Database lookup failed during subject matching. Continued with parser-only mode."
          );
        }
      } else {
        matchResult = matchSubjects(parsed.subjects, []);
      }

      const { matched, unmatched } = matchResult;

      if (!parsed.subjects.length) {
        return sendJson(res, 422, { error: "No subjects could be parsed from the result file" });
      }

      if (!branch || !semester) {
        const branchCounts = {};
        const semesterCounts = {};
        matched.forEach((m) => {
          if (m.subject.branch && m.subject.branch !== "COMMON") {
            branchCounts[m.subject.branch] = (branchCounts[m.subject.branch] || 0) + 1;
          }
          if (m.subject.semester) {
            semesterCounts[m.subject.semester] = (semesterCounts[m.subject.semester] || 0) + 1;
          }
        });
        if (!branch) branch = pickMostCommon(branchCounts);
        if (!semester) semester = parseSemester(pickMostCommon(semesterCounts));
      }

      const computedSubjects = [];
      const seen = new Set();

      const resolveCredits = (extracted, subject) => {
        const codeKey = normalizeCode(extracted.subjectCode);
        if (codeKey && creditCatalog.byCode.has(codeKey)) {
          return creditCatalog.byCode.get(codeKey);
        }

        const titleKey = normalizeTitleKey(extracted.subjectName);
        if (titleKey && creditCatalog.byTitle.has(titleKey)) {
          return creditCatalog.byTitle.get(titleKey);
        }

        if (codeKey && codeKey.startsWith("FEC")) {
          return 0.5;
        }

        if (typeof extracted.creditsHint === "number") {
          return extracted.creditsHint;
        }

        if (subject && typeof subject.credits === "number") {
          return subject.credits;
        }

        return null;
      };

      const addComputed = (extracted, subject) => {
        const codeKey = normalizeCode(extracted.subjectCode);
        const titleKey = normalizeTitleKey(extracted.subjectName);
        const dedupeKey = codeKey || titleKey;
        if (dedupeKey && seen.has(dedupeKey)) return;
        if (dedupeKey) seen.add(dedupeKey);

        const relativeMarks = computeRelativeMarks(extracted);
        let gradeInfo = null;
        if (extracted.grade) {
          gradeInfo = gradePointFromGrade(extracted.grade);
        } else if (relativeMarks !== null) {
          gradeInfo = gradeFromRelativeMarks(relativeMarks);
        }

        const grade = gradeInfo ? gradeInfo.grade : "NA";
        const gradePoint = gradeInfo ? gradeInfo.point : null;
        const credits = resolveCredits(extracted, subject);
        const contribution =
          gradePoint !== null && typeof credits === "number"
            ? round2(credits * gradePoint)
            : null;

        computedSubjects.push({
          subject: subject ? subject.subjectName : extracted.subjectName,
          subjectCode: extracted.subjectCode || null,
          credits,
          marks: typeof extracted.totalMarks === "number" ? extracted.totalMarks : null,
          grade,
          gradePoint,
          contribution
        });
      };

      matched.forEach((m) => addComputed(m.extracted, m.subject));
      unmatched.forEach((u) => addComputed(u, null));

      const sgpaCalc = calculateSgpa(
        computedSubjects.map((s) => ({ credits: s.credits, gradePoint: s.gradePoint }))
      );

      const sgpa = sgpaCalc.sgpa;
      const totalCredits = sgpaCalc.totalCredits;
      const totalGradePoints = sgpaCalc.totalGradePoints;
      const analysis = buildAnalysis(parsed.subjects, matched, unmatched, computedSubjects);
      const unmatchedDetails = buildUnmatchedDetails(unmatched);

      const cgpa = null;
      const percentage = null;
      const division = null;

      let cloudinaryInfo = null;
      try {
        cloudinaryInfo = await uploadResultFile(filePath, originalname);
      } catch (error) {
        cloudinaryInfo = null;
      }

      if (dbState.ready && rollNo && semester) {
        try {
          await StudentResult.findOneAndUpdate(
            { rollNo, semester },
            {
              rollNo,
              name,
              branch,
              semester,
              sgpa,
              cgpa,
              percentage,
              division,
              totalCredits,
              totalGradePoints,
              subjects: computedSubjects,
              sourceFile: {
                originalName: originalname,
                mimeType: mimetype,
                cloudinary: cloudinaryInfo
              }
            },
            { upsert: true, new: true }
          );
        } catch (error) {
          warnings.push("Result parsed but could not be saved to history.");
        }
      }

      return sendJson(res, 200, {
        rollNo: rollNo || null,
        name: name || null,
        branch: branch || null,
        semester: semester || null,
        sgpa,
        cgpa,
        percentage,
        division,
        totalCredits,
        totalGradePoints,
        subjects: computedSubjects,
        analysis,
        unmatchedSubjects: unmatchedDetails,
        fileUrl: cloudinaryInfo ? cloudinaryInfo.secureUrl : null,
        runtime: {
          database: dbState.ready ? "connected" : "unavailable",
          databaseError: dbState.error || null
        },
        warnings
      });
    } catch (error) {
      const status = error.status || 500;
      return sendJson(res, status, { error: safeMessage(error, "Server error") });
    } finally {
      if (filePath) {
        fs.unlink(filePath, () => {});
      }
    }
  });
}

module.exports = handleCalculate;
module.exports.config = {
  api: {
    bodyParser: false
  }
};
