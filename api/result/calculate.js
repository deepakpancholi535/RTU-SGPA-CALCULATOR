// =======================
// Vercel API config
// =======================
export const config = {
  api: {
    bodyParser: false, // REQUIRED for formidable
  },
};

// =======================
// Node & libs (ESM)
// =======================
import fs from "fs";
import os from "os";
import path from "path";
import formidable from "formidable";

// =======================
// Internal imports (ESM)
// =======================
import Subject from "../../backend/models/Subject.js";
import StudentResult from "../../backend/models/StudentResult.js";

import { extractResultData } from "../../backend/utils/pdfParser.js";
import { matchSubjects } from "../../backend/utils/subjectMatcher.js";
import {
  gradeFromRelativeMarks,
  gradePointFromGrade,
  calculateSgpa,
  round2,
} from "../../backend/utils/gradeCalculator.js";
import {
  normalizeBranch,
  parseSemester,
  toTitleCase,
} from "../../backend/utils/textNormalizer.js";
import {
  loadCreditCatalog,
  normalizeCode,
  normalizeTitleKey,
} from "../../backend/utils/creditCatalog.js";
import { uploadResultFile } from "../../backend/utils/cloudinary.js";
import { connectToDatabase } from "../_lib/db.js";

// =======================
// Preload catalog (cold start safe)
// =======================
const creditCatalog = loadCreditCatalog();

// =======================
// Helpers
// =======================
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
  for (const key of Object.keys(counts)) {
    if (counts[key] > maxVal) {
      maxVal = counts[key];
      maxKey = key;
    }
  }
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

// =======================
// MAIN HANDLER (Vercel)
// =======================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    await connectToDatabase();
  } catch (err) {
    return sendJson(res, 500, { error: "Database connection failed" });
  }

  const form = formidable({
    multiples: false,
    keepExtensions: true,
    uploadDir: os.tmpdir(),
    maxFileSize: 12 * 1024 * 1024,
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
    const originalname =
      file.originalFilename || file.name || path.basename(filePath);

    try {
      // =======================
      // Parse PDF / Image
      // =======================
      const parsed = await extractResultData(filePath, mimetype);
      const metadata = parsed.metadata || {};

      let rollNo = metadata.rollNo || getFieldValue(fields, "rollNo").trim() || null;
      let name = metadata.name || getFieldValue(fields, "name").trim() || null;
      if (name) name = toTitleCase(name);

      let branch = normalizeBranch(
        metadata.branch || getFieldValue(fields, "branch")
      );
      let semester = parseSemester(
        metadata.semester || getFieldValue(fields, "semester")
      );

      // =======================
      // Subject matching
      // =======================
      const filters = [];
      if (branch && semester) {
        filters.push({ branch, semester });
        filters.push({ branch: "COMMON", semester });
      } else if (semester) {
        filters.push({ semester });
      }

      let masterSubjects = await Subject.find(
        filters.length ? { $or: filters } : {}
      );

      let matchResult = matchSubjects(parsed.subjects, masterSubjects);

      if (!parsed.subjects.length) {
        return sendJson(res, 422, {
          error: "No subjects could be parsed from the result file",
        });
      }

      // Infer branch/semester if missing
      if (!branch || !semester) {
        const branchCounts = {};
        const semesterCounts = {};

        matchResult.matched.forEach((m) => {
          if (m.subject.branch && m.subject.branch !== "COMMON") {
            branchCounts[m.subject.branch] =
              (branchCounts[m.subject.branch] || 0) + 1;
          }
          if (m.subject.semester) {
            semesterCounts[m.subject.semester] =
              (semesterCounts[m.subject.semester] || 0) + 1;
          }
        });

        if (!branch) branch = pickMostCommon(branchCounts);
        if (!semester) semester = parseSemester(pickMostCommon(semesterCounts));
      }

      // =======================
      // Compute SGPA
      // =======================
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
          marks:
            typeof extracted.totalMarks === "number"
              ? extracted.totalMarks
              : null,
          grade,
          gradePoint,
          contribution,
        });
      };

      matchResult.matched.forEach((m) =>
        addComputed(m.extracted, m.subject)
      );
      matchResult.unmatched.forEach((u) => addComputed(u, null));

      const sgpaCalc = calculateSgpa(
        computedSubjects.map((s) => ({
          credits: s.credits,
          gradePoint: s.gradePoint,
        }))
      );

      // =======================
      // Persist (optional)
      // =======================
      if (rollNo && semester) {
        await StudentResult.findOneAndUpdate(
          { rollNo, semester },
          {
            rollNo,
            name,
            branch,
            semester,
            sgpa: sgpaCalc.sgpa,
            totalCredits: sgpaCalc.totalCredits,
            totalGradePoints: sgpaCalc.totalGradePoints,
            subjects: computedSubjects,
          },
          { upsert: true, new: true }
        );
      }

      // =======================
      // Response
      // =======================
      return sendJson(res, 200, {
        rollNo,
        name,
        branch,
        semester,
        sgpa: sgpaCalc.sgpa,
        totalCredits: sgpaCalc.totalCredits,
        totalGradePoints: sgpaCalc.totalGradePoints,
        subjects: computedSubjects,
      });
    } catch (error) {
      return sendJson(res, 500, {
        error: error.message || "Server error",
      });
    } finally {
      if (filePath) {
        fs.unlink(filePath, () => {});
      }
    }
  });
}
