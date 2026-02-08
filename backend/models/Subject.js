const mongoose = require("mongoose");

const SubjectSchema = new mongoose.Schema(
  {
    subjectName: { type: String, required: true, trim: true },
    branch: { type: String, required: true, uppercase: true, trim: true },
    semester: { type: Number, required: true, min: 1, max: 8 },
    credits: { type: Number, required: true, min: 0.5 },
    isLab: { type: Boolean, required: true },
    subjectCode: { type: String, default: null }
  },
  { timestamps: true }
);

SubjectSchema.index({ branch: 1, semester: 1 });
SubjectSchema.index({ subjectName: 1, branch: 1, semester: 1 }, { unique: true });

module.exports = mongoose.model("Subject", SubjectSchema);
