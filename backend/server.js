const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const resultRoutes = require("./routes/resultRoutes");

const app = express();

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAllowedOrigins() {
  const fromEnv = parseOrigins(process.env.CORS_ALLOWED_ORIGINS || process.env.FRONTEND_ORIGIN);
  const defaults = [
    "http://localhost:3000",
    "http://localhost:5500",
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5500",
    "http://127.0.0.1:8080"
  ];
  if (process.env.VERCEL_URL) {
    defaults.push(`https://${process.env.VERCEL_URL}`);
  }
  return Array.from(new Set([...fromEnv, ...defaults]));
}

function applySecurityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  );
  const isHttps =
    req.secure ||
    String(req.headers["x-forwarded-proto"] || "")
      .toLowerCase()
      .includes("https");
  if (isHttps) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
}

const mongoUri = (process.env.MONGODB_URI || "").trim();
if (!mongoUri) {
  console.error("Missing required environment variable: MONGODB_URI");
  process.exit(1);
}
if (!/^mongodb(\+srv)?:\/\//i.test(mongoUri)) {
  console.error("MONGODB_URI must start with mongodb:// or mongodb+srv://");
  process.exit(1);
}

const allowedOrigins = getAllowedOrigins();

app.use(applySecurityHeaders);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isDev = process.env.NODE_ENV !== "production";
      if (allowedOrigins.includes(origin) || (isDev && /localhost|127\.0\.0\.1/.test(origin))) {
        return callback(null, true);
      }
      const corsError = new Error("Origin not allowed by CORS");
      corsError.status = 403;
      return callback(corsError);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "rtu-result-backend",
    timestamp: new Date().toISOString()
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "rtu-result-backend",
    timestamp: new Date().toISOString()
  });
});

app.use("/api/result", resultRoutes);

app.use((err, req, res, next) => {
  const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) {
    console.error("Global Error:", err);
  }
  const message = status >= 500 ? "Internal server error" : err.message || "Request failed";
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 8080;

async function startServer() {
  try {
    await mongoose.connect(mongoUri, {
      autoIndex: true,
      tls: true,
      tlsAllowInvalidCertificates: false
    });
    console.log("MongoDB connected");
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to MongoDB. Server aborted.");
    process.exit(1);
  }
}

startServer();
