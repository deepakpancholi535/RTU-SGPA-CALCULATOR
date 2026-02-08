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

const creditCatalog = loadCreditCatalog();

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

exports.calculateResult = async (req, res, next) => {
  const cleanupPath = req.file && req.file.path ? req.file.path : null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "Result file is required" });
    }

    const parsed = await extractResultData(req.file.path, req.file.mimetype);
    const metadata = parsed.metadata || {};

    let rollNo = metadata.rollNo || (req.body.rollNo || "").trim() || null;
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
            originalName: req.file.originalname,
            mimeType: req.file.mimetype
          }
        },
        { upsert: true, new: true }
      );
    }

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
      subjects: computedSubjects
    });
  } catch (err) {
    return next(err);
  } finally {
    if (cleanupPath) {
      fs.unlink(cleanupPath, () => {});
    }
  }
};
