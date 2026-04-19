const fs = require("fs");
const Subject = require("../models/Subject");
const StudentResult = require("../models/StudentResult");
const { extractResultData } = require("../utils/pdfParser");
const { matchSubjects } = require("../utils/subjectMatcher");
const {
  gradeFromRelativeMarks,
  gradePointFromGrade,
  calculateSgpa,
  round2
} = require("../utils/gradeCalculator");
const { normalizeBranch, parseSemester, toTitleCase } = require("../utils/textNormalizer");
const { loadCreditCatalog, normalizeCode, normalizeTitleKey } = require("../utils/creditCatalog");
const { uploadResultFile } = require("../utils/cloudinary");
const {
  createResultAccessToken,
  extractBearerTokenFromHeaders,
  verifyResultAccessToken,
  normalizeRollNo
} = require("../utils/accessToken");

const creditCatalog = loadCreditCatalog();
const APP_VERSION = process.env.APP_VERSION || "1.0.0";

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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function hasPdfMagicNumber(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const fd = fs.openSync(filePath, "r");
    const chunk = Buffer.alloc(5);
    const read = fs.readSync(fd, chunk, 0, 5, 0);
    fs.closeSync(fd);
    if (read < 5) return false;
    return chunk.toString("ascii") === "%PDF-";
  } catch (error) {
    return false;
  }
}

exports.calculateResult = async (req, res, next) => {
  const cleanupPath = req.file && req.file.path ? req.file.path : null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "Result file is required" });
    }
    if (!hasPdfMagicNumber(req.file.path)) {
      return res.status(400).json({ error: "Uploaded file is not a valid PDF." });
    }

    const parsed = await extractResultData(req.file.path, req.file.mimetype);
    const metadata = parsed.metadata || {};

    let rollNo = metadata.rollNo || (req.body.rollNo || "").trim() || null;
    rollNo = normalizeRollNo(rollNo);
    let name = metadata.name || (req.body.name || "").trim() || null;
    if (name) name = toTitleCase(name);

    let branch = normalizeBranch(metadata.branch || req.body.branch || "");
    let semester = parseSemester(metadata.semester || req.body.semester || "");

    const filters = [];
    if (branch && semester) {
      filters.push({ branch, semester });
      filters.push({ branch: "COMMON", semester });
    } else if (semester && !branch) {
      filters.push({ semester });
    }

    let masterSubjects = await Subject.find(filters.length ? { $or: filters } : {});
    let matchResult = matchSubjects(parsed.subjects, masterSubjects);

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

    const { matched, unmatched } = matchResult;

    if (!parsed.subjects.length) {
      return res.status(422).json({ error: "No subjects could be parsed from the result file" });
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
        gradePoint !== null && typeof credits === "number" ? round2(credits * gradePoint) : null;

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

    let sgpa = sgpaCalc.sgpa;
    let totalCredits = sgpaCalc.totalCredits;
    let totalGradePoints = sgpaCalc.totalGradePoints;

    // Per request: only SGPA is returned; CGPA/percentage/division are not computed.
    const cgpa = null;
    const percentage = null;
    const division = null;
    const analysis = buildAnalysis(parsed.subjects, matched, unmatched, computedSubjects);
    const unmatchedDetails = buildUnmatchedDetails(unmatched);

    let cloudinaryInfo = null;
    try {
      cloudinaryInfo = await uploadResultFile(req.file.path, req.file.originalname);
    } catch (err) {
      cloudinaryInfo = null;
    }

    if (rollNo && semester) {
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
            originalName: null,
            mimeType: req.file.mimetype,
            cloudinary: cloudinaryInfo
          }
        },
        { upsert: true, new: true }
      );
    }

    const tokenInfo = createResultAccessToken({
      rollNo,
      semester,
      branch,
      sgpa
    });

    return res.json({
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
      fileUploaded: Boolean(cloudinaryInfo?.publicId),
      accessToken: tokenInfo ? tokenInfo.token : null,
      accessTokenExpiresAt: tokenInfo ? tokenInfo.expiresAt : null
    });
  } catch (err) {
    return next(err);
  } finally {
    if (cleanupPath) {
      fs.unlink(cleanupPath, () => {});
    }
  }
};

exports.getHistory = async (req, res, next) => {
  try {
    const rollNoRaw = normalizeRollNo((req.query.rollNo || "").toString().trim());
    if (!rollNoRaw) {
      return res.status(400).json({ error: "rollNo query parameter is required" });
    }
    const token = extractBearerTokenFromHeaders(req.headers || {});
    const claims = verifyResultAccessToken(token);
    if (!claims || !claims.rollNo) {
      return res.status(401).json({ error: "Unauthorized history request" });
    }
    if (claims.rollNo !== rollNoRaw) {
      return res.status(403).json({ error: "History access denied for this roll number" });
    }

    const limitRaw = parseInt(req.query.limit, 10);
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

    return res.json({
      rollNo: rollNoRaw,
      count: trend.length,
      trend
    });
  } catch (err) {
    return next(err);
  }
};

exports.getHealth = async (req, res) => {
  return res.json({
    status: "ok",
    service: "rtu-result-api",
    version: APP_VERSION,
    timestamp: new Date().toISOString()
  });
};
