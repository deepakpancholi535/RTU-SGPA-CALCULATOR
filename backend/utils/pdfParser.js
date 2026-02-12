const fs = require("fs");
const pdfParse = require("pdf-parse");
const { normalizeText, extractMetadata } = require("./textNormalizer");

const MIN_TEXT_LENGTH = parseInt(process.env.MIN_TEXT_LENGTH, 10) || 120;

function getFileType(mime) {
  if (!mime) return "unknown";
  if (mime === "application/pdf") return "pdf";
  return "unknown";
}

async function extractPdfText(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(buffer);
  return data.text || "";
}

function isNoiseLine(line) {
  const upper = line.toUpperCase();
  if (upper.length < 6) return true;
  if (!/[A-Z]/.test(upper)) return true;
  if (/^\d+\./.test(upper)) return true;
  if (/^\d+\s/.test(upper)) return true;
  return /RAJASTHAN|UNIVERSITY|RESULT|ROLL|NAME|BRANCH|SEMESTER|SGPA|CGPA|TOTAL|STATUS|COLLEGE|EXAM|INSTITUTE|COURSE|TITLE|CODE|MARKS|GRADE|REMARKS|INSTRUCTION|PAGE/.test(
    upper
  );
}

function parseSubjectLine(line) {
  const hasLetter = /[A-Za-z]/.test(line);
  const hasNumber = /\d/.test(line);
  if (!hasLetter || !hasNumber) return null;

  const normalizedLine = line.replace(/I(?=[A-Z]{2,4}\d-\d{2})/g, "1");
  const gradeTokenRegex = /(?:^|[^A-Z])((?:A\+\+|A\+|A|B\+|B|C\+|C|D\+|D|E\+|E|F))(?=\s*\d|$)/g;
  let grade = null;
  let gradeIndex = -1;
  let gradeToken = null;
  while ((gradeToken = gradeTokenRegex.exec(normalizedLine)) !== null) {
    grade = gradeToken[1].toUpperCase();
    gradeIndex = gradeToken.index + (gradeToken[0].length - gradeToken[1].length);
  }
  const workingLine = gradeIndex >= 0 ? normalizedLine.slice(0, gradeIndex).trim() : normalizedLine;

  let trailingPoint = null;
  let trailingContribution = null;
  if (grade && gradeIndex >= 0) {
    const tail = normalizedLine.slice(gradeIndex + grade.length).replace(/\s+/g, "");
    const gradePointMap = {
      "A++": 10,
      "A+": 9,
      A: 8.5,
      "B+": 8,
      B: 7.5,
      "C+": 7,
      C: 6.5,
      "D+": 6,
      D: 5.5,
      "E+": 5,
      E: 4,
      F: 0
    };
    const expectedPoint = Object.prototype.hasOwnProperty.call(gradePointMap, grade)
      ? gradePointMap[grade]
      : null;

    if (expectedPoint !== null) {
      const pointStr = expectedPoint.toString();
      if (tail.startsWith(pointStr)) {
        trailingPoint = expectedPoint;
        const contribStr = tail.slice(pointStr.length);
        if (contribStr) {
          const contribVal = parseFloat(contribStr);
          if (!Number.isNaN(contribVal)) trailingContribution = contribVal;
        }
      }
    }

    if (expectedPoint !== null && trailingPoint === null) {
      const tailNum = tail.match(/^\d+$/) ? parseInt(tail, 10) : null;
      if (typeof tailNum === "number" && !Number.isNaN(tailNum) && tailNum > 0) {
        if (tailNum <= expectedPoint * 6) {
          trailingPoint = expectedPoint;
          trailingContribution = tailNum;
        }
      }
    }

    if (trailingPoint === null) {
      const tailMatch = tail.match(/^(\d{1,2}(?:\.\d)?)(\d{1,3}(?:\.\d{1,2})?)?$/);
      if (tailMatch) {
        const pointVal = parseFloat(tailMatch[1]);
        const contribVal = tailMatch[2] ? parseFloat(tailMatch[2]) : null;
        if (!Number.isNaN(pointVal)) trailingPoint = pointVal;
        if (contribVal !== null && !Number.isNaN(contribVal)) trailingContribution = contribVal;
      }
    }
  }

  let creditsHint = null;
  if (typeof trailingPoint === "number" && typeof trailingContribution === "number") {
    const rawCredits = trailingContribution / trailingPoint;
    if (!Number.isNaN(rawCredits) && rawCredits > 0) {
      creditsHint = Math.round(rawCredits * 2) / 2;
    }
  }

  let totalMarks = null;
  let maxMarks = null;
  let isPercentage = false;

  const percentMatch = workingLine.match(/\b(\d{1,3})\s*%\b/);
  if (percentMatch) {
    totalMarks = parseInt(percentMatch[1], 10);
    isPercentage = true;
  }

  const totalMaxMatch = workingLine.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
  if (totalMaxMatch) {
    totalMarks = parseInt(totalMaxMatch[1], 10);
    maxMarks = parseInt(totalMaxMatch[2], 10);
  }

  const codeRegex = /([1-8I][A-Z]{2,4}\d-\d{2}|FEC\d{2})/;
  const codeMatch = workingLine.match(codeRegex);
  const subjectCode = codeMatch ? codeMatch[1].replace(/^I/, "1") : null;

  let subjectName = null;

  if (codeMatch) {
    const subjectPart = workingLine.slice(0, codeMatch.index).trim();
    subjectName = subjectPart.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();

    if (totalMarks === null) {
      const tail = workingLine.slice(codeMatch.index + codeMatch[0].length);
      const tailDigits = tail.replace(/\D/g, "");
      if (tailDigits.length >= 4) {
        const last4 = tailDigits.slice(-4);
        const mid = parseInt(last4.slice(0, 2), 10);
        const end = parseInt(last4.slice(2), 10);
        if (!Number.isNaN(mid) && !Number.isNaN(end)) {
          totalMarks = mid + end;
        }
      } else if (tailDigits.length >= 2) {
        totalMarks = parseInt(tailDigits, 10);
      }
    }
  }

  if (!subjectName) {
    const nums = workingLine.match(/\b\d{1,3}\b/g) || [];
    const numVals = nums.map((n) => parseInt(n, 10));

    if (totalMarks === null && numVals.length) {
      totalMarks = numVals[numVals.length - 1];
    }

    if (maxMarks === null && numVals.length >= 2) {
      const maxCandidate = Math.max(...numVals);
      const minCandidate = Math.min(...numVals);
      const upper = workingLine.toUpperCase();

      if (/\b(OUT\s*OF|MAX|MM)\b/.test(upper)) {
        maxMarks = maxCandidate;
        if (maxCandidate === totalMarks) totalMarks = minCandidate;
      } else if (numVals.length === 2) {
        const [a, b] = numVals;
        if (b > a && [50, 75, 80, 100, 150, 200].includes(b)) {
          totalMarks = a;
          maxMarks = b;
        }
      } else if ([100, 150, 200].includes(maxCandidate) && maxCandidate > totalMarks) {
        maxMarks = maxCandidate;
      }
    }
    subjectName = workingLine
      .replace(codeRegex, " ")
      .replace(/\b\d{1,3}\s*\/\s*\d{1,3}\b/g, " ")
      .replace(/\b\d+(?:\.\d+)?\b/g, " ")
      .replace(/\b[A-Z]*\d+[A-Z]*\b/g, " ")
      .replace(/\b[A-Z]{1,3}\d{2,4}\b/g, " ")
      .replace(/\b\d{1,2}[A-Z]{2,4}\d?[- ]?\d{2}\b/g, " ")
      .replace(/[|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (grade && gradeIndex >= 0) {
    let marksCandidate = null;
    let creditsCandidate = null;

    const decimalPack = workingLine.match(/(\d{1,2}\.\d)(\d{2,3})$/);
    if (decimalPack) {
      const creditVal = parseFloat(decimalPack[1]);
      const markVal = parseInt(decimalPack[2], 10);
      if (!Number.isNaN(creditVal)) creditsCandidate = creditVal;
      if (!Number.isNaN(markVal)) marksCandidate = markVal;
    } else {
      const trailingDigits = workingLine.match(/(\d{3,4})$/);
      if (trailingDigits) {
        const digits = trailingDigits[1];
        marksCandidate = parseInt(digits.slice(-2), 10);
        creditsCandidate = parseInt(digits.slice(0, -2), 10);

        if (marksCandidate === 0 && digits.length >= 3) {
          const marks3 = parseInt(digits.slice(-3), 10);
          const credits3 = parseInt(digits.slice(0, -3), 10);
          if (!Number.isNaN(marks3) && marks3 > 0 && marks3 <= 100 && credits3 > 0) {
            marksCandidate = marks3;
            creditsCandidate = credits3;
          }
        }
      }
    }

    if (
      (totalMarks === null || totalMarks > 100) &&
      typeof marksCandidate === "number" &&
      !Number.isNaN(marksCandidate) &&
      marksCandidate >= 0 &&
      marksCandidate <= 100
    ) {
      totalMarks = marksCandidate;
    }

    if (
      creditsHint === null &&
      typeof creditsCandidate === "number" &&
      !Number.isNaN(creditsCandidate) &&
      creditsCandidate > 0 &&
      creditsCandidate <= 6
    ) {
      creditsHint = creditsCandidate;
    }
  }

  if (subjectName) {
    subjectName = subjectName.replace(/[-\s]+$/g, "").trim();
  }

  if (!subjectName || subjectName.length < 3) return null;

  return {
    subjectName,
    subjectCode,
    totalMarks,
    maxMarks,
    grade,
    creditsHint,
    isPercentage,
    rawLine: line
  };
}

function parseSubjects(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const combined = [];
  let buffer = "";

  const codeRegex = /([1-8][A-Z]{2,4}\d-\d{2}|FEC\d{2})/;
  const gradeRegex = /(A\+\+|A\+|A|B\+|B|C\+|C|D\+|D|E\+|E|F)\s*$/;
  const gradeInlineRegex = /(A\+\+|A\+|A|B\+|B|C\+|C|D\+|D|E\+|E|F)/;

  lines.forEach((line) => {
    const hasLetter = /[A-Za-z]/.test(line);
    const hasDigit = /\d/.test(line);

    if (!hasDigit && hasLetter) {
      buffer = buffer ? `${buffer} ${line}` : line;
      return;
    }

    if (buffer) {
      const bufferIsNoise = isNoiseLine(buffer);
      if (bufferIsNoise) {
        combined.push(line);
      } else if (codeRegex.test(line) || gradeRegex.test(line) || gradeInlineRegex.test(line)) {
        combined.push(`${buffer} ${line}`.trim());
      } else {
        combined.push(line);
      }
      buffer = "";
      return;
    }

    combined.push(line);
  });

  const subjects = [];
  const seen = new Set();

  combined.forEach((line) => {
    if (isNoiseLine(line)) return;
    const parsed = parseSubjectLine(line);
    if (!parsed) return;

    const key = parsed.subjectCode ? parsed.subjectCode.toUpperCase() : parsed.subjectName.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    subjects.push(parsed);
  });

  return subjects;
}

async function extractResultData(filePath, mimeType) {
  const fileType = getFileType(mimeType);
  const isPdf = fileType === "pdf" || /\.pdf$/i.test(filePath || "");
  if (!isPdf) {
    const err = new Error("Only PDF files are supported");
    err.status = 400;
    throw err;
  }

  const text = await extractPdfText(filePath);
  const normalizedText = normalizeText(text);
  const metadata = extractMetadata(normalizedText);
  const subjects = parseSubjects(normalizedText);

  if (!subjects.length && (!text || text.trim().length < MIN_TEXT_LENGTH)) {
    const err = new Error("Scanned PDFs are not supported. Please upload a text-based PDF.");
    err.status = 422;
    throw err;
  }

  return { text: normalizedText, metadata, subjects };
}

module.exports = { extractResultData };
