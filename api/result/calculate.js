const fs = require("fs");
const os = require("os");
const path = require("path");
const formidable = require("formidable");
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
const { connectToDatabase } = require("../_lib/db");

const creditCatalog = loadCreditCatalog();

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
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

  await connectToDatabase();

  const form = formidable({
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

      const cgpa = null;
      const percentage = null;
      const division = null;

      let cloudinaryInfo = null;
      try {
        cloudinaryInfo = await uploadResultFile(filePath, originalname);
      } catch (error) {
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
              originalName: originalname,
              mimeType: mimetype,
              cloudinary: cloudinaryInfo
            }
          },
          { upsert: true, new: true }
        );
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
        fileUrl: cloudinaryInfo ? cloudinaryInfo.secureUrl : null
      });
    } catch (error) {
      const status = error.status || 500;
      return sendJson(res, status, { error: error.message || "Server error" });
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
