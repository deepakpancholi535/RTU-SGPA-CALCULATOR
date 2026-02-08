const fs = require("fs");
const path = require("path");
const os = require("os");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const { fromPath } = require("pdf2pic");
const { normalizeText, extractMetadata } = require("./textNormalizer");

const MIN_TEXT_LENGTH = parseInt(process.env.MIN_TEXT_LENGTH, 10) || 120;
const OCR_LANG = process.env.OCR_LANG || "eng";
const OCR_DEBUG = process.env.OCR_DEBUG === "1";

function getFileType(mime) {
  if (!mime) return "unknown";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "unknown";
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function extractPdfText(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(buffer);
  return data.text || "";
}

function getOcrOutputDir() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), "rtu-ocr");
  }
  return path.join(__dirname, "..", "uploads", "ocr");
}

async function convertPdfToImage(pdfPath) {
  const outputDir = getOcrOutputDir();
  ensureDir(outputDir);

  const converter = fromPath(pdfPath, {
    density: 200,
    format: "png",
    savePath: outputDir,
    saveFilename: `page_${Date.now()}`
  });

  const result = await converter(1); // Assumption: subject table is on the first page for RTU results.
  return result.path;
}

async function runOCR(imagePath) {
  const { data } = await Tesseract.recognize(imagePath, OCR_LANG);
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
  const gradeMatch = normalizedLine.match(/(A\+\+|A\+|A|B\+|B|C\+|C|D\+|D|E\+|E|F)\s*$/);
  const grade = gradeMatch ? gradeMatch[1] : null;
  const workingLine = gradeMatch ? normalizedLine.slice(0, gradeMatch.index).trim() : normalizedLine;

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
      .replace(/\b\d{1,3}\b/g, " ")
      .replace(/\b[A-Z]{1,3}\d{2,4}\b/g, " ")
      .replace(/\b\d{1,2}[A-Z]{2,4}\d?[- ]?\d{2}\b/g, " ")
      .replace(/[|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (!subjectName || subjectName.length < 3) return null;

  return {
    subjectName,
    subjectCode,
    totalMarks,
    maxMarks,
    grade,
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

  lines.forEach((line) => {
    const hasLetter = /[A-Za-z]/.test(line);
    const hasDigit = /\d/.test(line);

    if (!hasDigit && hasLetter) {
      buffer = buffer ? `${buffer} ${line}` : line;
      return;
    }

    if (buffer) {
      if (codeRegex.test(line) || gradeRegex.test(line)) {
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
  let text = "";
  let usedOcr = false;

  if (fileType === "pdf") {
    text = await extractPdfText(filePath);

    if (!text || text.trim().length < MIN_TEXT_LENGTH) {
      const imagePath = await convertPdfToImage(filePath);
      text = await runOCR(imagePath);
      usedOcr = true;
    }
  } else if (fileType === "image") {
    text = await runOCR(filePath);
    usedOcr = true;
  } else {
    throw new Error("Unsupported file type");
  }

  if (OCR_DEBUG && usedOcr) {
    console.log("===== OCR TEXT START =====");
    console.log(text);
    console.log("===== OCR TEXT END =====");
  }

  const normalizedText = normalizeText(text);
  const metadata = extractMetadata(normalizedText);
  const subjects = parseSubjects(normalizedText);

  return { text: normalizedText, metadata, subjects };
}

module.exports = { extractResultData };
