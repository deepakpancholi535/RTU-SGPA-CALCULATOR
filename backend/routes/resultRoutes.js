const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const resultController = require("../controllers/resultController");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const unique = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}_${safe}`);
  }
});

function fileFilter(req, file, cb) {
  const mime = file.mimetype || "";
  const isPdf = mime === "application/pdf" || /\.pdf$/i.test(file.originalname || "");
  if (isPdf) {
    return cb(null, true);
  }
  return cb(new Error("Only PDF files are allowed"));
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.post("/calculate", upload.single("result"), resultController.calculateResult);

module.exports = router;
