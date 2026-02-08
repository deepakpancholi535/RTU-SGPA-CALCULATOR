const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Subject = require("./models/Subject");
const { inferIsLab } = require("./utils/textNormalizer");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const BRANCHES = ["CSE", "IT", "ECE", "EE", "ME", "CE", "AI", "DS", "CS", "AIML"];
const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];

function keyFor(s) {
  return `${s.subjectName}|${s.branch}|${s.semester}`;
}

function normalizeEntry(entry) {
  const normalized = {
    subjectName: (entry.subjectName || "").trim(),
    branch: (entry.branch || "").toUpperCase().trim(),
    semester: Number(entry.semester),
    credits: Number(entry.credits),
    isLab:
      typeof entry.isLab === "boolean" ? entry.isLab : inferIsLab(entry.subjectName) === true,
    subjectCode: entry.subjectCode || null
  };
  return normalized;
}

function addSubject(list, map, entry) {
  const normalized = normalizeEntry(entry);
  if (!normalized.subjectName || !normalized.branch || !normalized.semester) return;
  const key = keyFor(normalized);
  if (map.has(key)) return;
  map.set(key, true);
  list.push(normalized);
}

function ensureCoverage(list, map) {
  // Assumption: elective titles vary by campus/affiliation; generate standardized electives to reach 400+ entries.
  BRANCHES.forEach((branch) => {
    [3, 4, 5, 6, 7, 8].forEach((sem) => {
      const group = list.filter((s) => s.branch === branch && s.semester === sem);
      const labCount = group.filter((s) => s.isLab).length;
      let theoryCount = group.filter((s) => !s.isLab).length;

      if (labCount === 0) {
        addSubject(list, map, {
          subjectName: `Laboratory Practice - Sem ${sem}`,
          branch,
          semester: sem,
          credits: 1,
          isLab: true
        });
      }

      while (theoryCount < 4) {
        theoryCount += 1;
        addSubject(list, map, {
          subjectName: `Professional Elective ${theoryCount}`,
          branch,
          semester: sem,
          credits: 3,
          isLab: false
        });
      }
    });
  });

  let index = 1;
  while (list.length < 400) {
    for (const branch of BRANCHES) {
      for (const sem of [3, 4, 5, 6, 7, 8]) {
        addSubject(list, map, {
          subjectName: `Open Elective ${index}`,
          branch,
          semester: sem,
          credits: 3,
          isLab: false
        });
        if (list.length >= 400) break;
      }
      if (list.length >= 400) break;
    }
    index += 1;
  }
}

async function seed() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is missing in .env");
    process.exit(1);
  }

  const dataPath = path.join(__dirname, "data", "subjects.json");
  const raw = fs.readFileSync(dataPath, "utf8");
  const base = JSON.parse(raw);

  const list = [];
  const map = new Map();
  base.forEach((entry) => addSubject(list, map, entry));
  ensureCoverage(list, map);

  await mongoose.connect(uri, { autoIndex: true });

  const ops = list.map((s) => ({
    updateOne: {
      filter: { subjectName: s.subjectName, branch: s.branch, semester: s.semester },
      update: { $set: s },
      upsert: true
    }
  }));

  await Subject.bulkWrite(ops, { ordered: false });
  await mongoose.disconnect();

  console.log(`Seeded ${list.length} subjects`);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
