const mongoose = require("mongoose");

const SubjectResultSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true },
    credits: { type: Number, required: true },
    marks: { type: Number, default: null },
    grade: { type: String, default: null },
    gradePoint: { type: Number, default: null },
    contribution: { type: Number, default: null }
  },
  { _id: false }
);

const StudentResultSchema = new mongoose.Schema(
  {
    rollNo: { type: String, index: true },
    name: { type: String, default: null },
    branch: { type: String, default: null },
    semester: { type: Number, default: null },
    sgpa: { type: Number, default: null },
    cgpa: { type: Number, default: null },
    percentage: { type: Number, default: null },
    division: { type: String, default: null },
    totalCredits: { type: Number, default: null },
    totalGradePoints: { type: Number, default: null },
    subjects: { type: [SubjectResultSchema], default: [] },
    sourceFile: {
      originalName: { type: String, default: null },
      mimeType: { type: String, default: null },
      cloudinary: {
        publicId: { type: String, default: null },
        secureUrl: { type: String, default: null },
        resourceType: { type: String, default: null },
        format: { type: String, default: null },
        bytes: { type: Number, default: null }
      }
    }
  },
  { timestamps: true }
);

StudentResultSchema.index({ rollNo: 1, semester: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("StudentResult", StudentResultSchema);
