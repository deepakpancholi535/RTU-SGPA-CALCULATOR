const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const resultRoutes = require("./routes/resultRoutes");

const app = express();

/* ===========================
   🔐 ENV VALIDATION
=========================== */

const REQUIRED_ENV = [
  "MONGODB_URI",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET"
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(
    `❌ Missing required environment variables: ${missing.join(", ")}`
  );
  process.exit(1);
}

if (!process.env.MONGODB_URI.startsWith("mongodb+srv://")) {
  console.error("❌ MONGODB_URI must start with mongodb+srv://");
  process.exit(1);
}

/* ===========================
   🧠 MIDDLEWARE
=========================== */

app.use(cors({
  origin: "*", // You can restrict to your Vercel domain later
}));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ===========================
   🚀 ROUTES
=========================== */
app.get("/", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "RTU SGPA Backend Running"
  });
});

app.use("/api/result", resultRoutes);

/* ===========================
   🌍 HEALTH CHECK
=========================== */

app.get("/", (req, res) => {
  res.json({
    status: "RTU SGPA Backend Running 🚀",
    timestamp: new Date().toISOString()
  });
});

/* ===========================
   🔎 LOADER.IO VERIFY
=========================== */

app.get("/loaderio-f44f56fedc1505e62553adba25478423.txt", (req, res) => {
  res.status(200).send("loaderio-f44f56fedc1505e62553adba25478423");
});

/* ===========================
   ❌ GLOBAL ERROR HANDLER
=========================== */

app.use((err, req, res, next) => {
  console.error("Global Error:", err);

  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error"
  });
});

/* ===========================
   🟢 START SERVER FIRST
=========================== */

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

/* ===========================
   🗄 CONNECT MONGODB (NON-BLOCKING)
=========================== */

mongoose
  .connect(process.env.MONGODB_URI, {
    autoIndex: true
  })
  .then(() => {
    console.log("✅ MongoDB Connected");
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err.message);
  });
