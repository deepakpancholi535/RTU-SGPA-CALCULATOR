const { normalizeSubjectName, tokenize, inferIsLab } = require("./textNormalizer");

const BOOST_KEYWORDS = new Set([
  "DATABASE",
  "NETWORKS",
  "OPERATING",
  "COMPILER",
  "ALGORITHMS",
  "MACHINE",
  "LEARNING",
  "CIRCUITS",
  "SIGNALS",
  "THERMODYNAMICS",
  "STRUCTURES",
  "ANALYSIS",
  "CONTROL",
  "POWER",
  "COMMUNICATION",
  "DESIGN",
  "SOFTWARE",
  "MICROPROCESSOR",
  "ELECTRICAL",
  "MECHANICS",
  "MINING",
  "CLOUD",
  "SECURITY",
  "VISION",
  "NATURAL",
  "LANGUAGE",
  "ENVIRONMENTAL",
  "GEOTECHNICAL",
  "TRANSPORTATION",
  "HYDROLOGY",
  "VLSI",
  "EMBEDDED",
  "WIRELESS",
  "DSP",
  "REFRIGERATION",
  "CONSTRUCTION",
  "VISUALIZATION"
]);

function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map();
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2);
    bigrams.set(gram, (bigrams.get(gram) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const count = bigrams.get(gram) || 0;
    if (count > 0) {
      bigrams.set(gram, count - 1);
      intersection += 1;
    }
  }

  return (2 * intersection) / (a.length + b.length - 2);
}

function scoreName(aNorm, bNorm, aTokens, bTokens) {
  if (!aNorm || !bNorm) return 0;

  const setA = new Set(aTokens);
  const setB = new Set(bTokens);

  let overlapScore = 0;
  setA.forEach((t) => {
    if (setB.has(t)) {
      let w = t.length >= 6 ? 1.2 : 1;
      if (BOOST_KEYWORDS.has(t)) w += 0.6;
      overlapScore += w;
    }
  });

  const unionSize = new Set([...setA, ...setB]).size || 1;
  const tokenScore = overlapScore / unionSize;

  const strScore = diceCoefficient(aNorm.replace(/\s+/g, ""), bNorm.replace(/\s+/g, ""));
  let score = tokenScore * 0.7 + strScore * 0.3;

  if (aNorm === bNorm) score += 0.2;
  return Math.min(score, 1);
}

function matchSubjects(extractedSubjects, masterSubjects) {
  const master = masterSubjects.map((s) => {
    const norm = normalizeSubjectName(s.subjectName);
    return {
      subject: s,
      norm,
      tokens: tokenize(norm),
      isLab: !!s.isLab,
      key: `${s.subjectName}|${s.branch}|${s.semester}`
    };
  });

  const matched = [];
  const unmatched = [];
  const used = new Set();
  const MIN_SCORE = 0.55;

  extractedSubjects.forEach((ext) => {
    const extNorm = normalizeSubjectName(ext.subjectName);
    if (!extNorm) {
      unmatched.push(ext);
      return;
    }

    const extTokens = tokenize(extNorm);
    const extLab = inferIsLab(ext.subjectName);

    let best = null;
    let bestScore = 0;

    master.forEach((candidate) => {
      if (used.has(candidate.key)) return;

      if (extLab === true && !candidate.isLab) return;
      if (extLab === false && candidate.isLab) return;
      if (extLab === null && candidate.isLab) return;

      const score = scoreName(extNorm, candidate.norm, extTokens, candidate.tokens);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    });

    if (best && bestScore >= MIN_SCORE) {
      used.add(best.key);
      matched.push({ extracted: ext, subject: best.subject, score: bestScore });
    } else {
      unmatched.push(ext);
    }
  });

  return { matched, unmatched };
}

module.exports = { matchSubjects };
