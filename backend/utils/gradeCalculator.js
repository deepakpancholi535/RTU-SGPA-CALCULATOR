const GRADE_BANDS = [
  { min: 90, grade: "A++", point: 10 },
  { min: 85, grade: "A+", point: 9 },
  { min: 80, grade: "A", point: 8.5 },
  { min: 75, grade: "B+", point: 8 },
  { min: 70, grade: "B", point: 7.5 },
  { min: 65, grade: "C+", point: 7 },
  { min: 60, grade: "C", point: 6.5 },
  { min: 55, grade: "D+", point: 6 },
  { min: 50, grade: "D", point: 5.5 },
  { min: 45, grade: "E+", point: 5 },
  { min: 40, grade: "E", point: 4 },
  { min: 0, grade: "F", point: 0 }
];

const GRADE_POINTS = GRADE_BANDS.reduce((acc, band) => {
  acc[band.grade] = band.point;
  return acc;
}, {});

function round2(num) {
  if (typeof num !== "number" || Number.isNaN(num)) return null;
  return Math.round(num * 100) / 100;
}

function gradeFromRelativeMarks(relativeMarks) {
  if (typeof relativeMarks !== "number" || Number.isNaN(relativeMarks)) return null;
  const band = GRADE_BANDS.find((b) => relativeMarks >= b.min);
  if (!band) return null;
  return { grade: band.grade, point: band.point };
}

function gradePointFromGrade(grade) {
  if (!grade) return null;
  const g = grade.toUpperCase().replace(/\s+/g, "");
  if (!Object.prototype.hasOwnProperty.call(GRADE_POINTS, g)) return null;
  return { grade: g, point: GRADE_POINTS[g] };
}

function calculateSgpa(subjects) {
  let totalCredits = 0;
  let totalGradePoints = 0;

  subjects.forEach((s) => {
    if (typeof s.gradePoint !== "number") return;
    if (typeof s.credits !== "number") return;
    totalCredits += s.credits;
    totalGradePoints += s.credits * s.gradePoint;
  });

  const sgpa = totalCredits > 0 ? round2(totalGradePoints / totalCredits) : null;
  return { sgpa, totalCredits: round2(totalCredits), totalGradePoints: round2(totalGradePoints) };
}

function calculateCgpa(subjects) {
  let totalCredits = 0;
  let totalGradePoints = 0;

  subjects.forEach((s) => {
    if (typeof s.gradePoint !== "number") return;
    if (typeof s.credits !== "number") return;
    if (s.gradePoint < 4) return;
    totalCredits += s.credits;
    totalGradePoints += s.credits * s.gradePoint;
  });

  const cgpa = totalCredits > 0 ? round2(totalGradePoints / totalCredits) : null;
  return { cgpa, totalCredits: round2(totalCredits), totalGradePoints: round2(totalGradePoints) };
}

function divisionFromCgpa(cgpa) {
  if (typeof cgpa !== "number") return null;
  if (cgpa >= 7) return "First Division with Distinction";
  if (cgpa >= 6) return "First Division";
  if (cgpa >= 5) return "Second Division";
  if (cgpa >= 4) return "Pass";
  return "Fail";
}

module.exports = {
  gradeFromRelativeMarks,
  gradePointFromGrade,
  calculateSgpa,
  calculateCgpa,
  divisionFromCgpa,
  round2
};
