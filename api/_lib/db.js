const mongoose = require("mongoose");

let cached = global.__mongoose;
if (!cached) {
  cached = global.__mongoose = { conn: null, promise: null };
}

function getMongoUri() {
  return (process.env.MONGODB_URI || process.env.MONGO_URI || "").trim();
}

function sanitizeDbErrorMessage(error) {
  const raw = typeof error?.message === "string" ? error.message.trim() : "";
  if (!raw) return "Database unavailable.";
  if (/MONGODB_URI|MONGO_URI/i.test(raw)) return "Database unavailable.";
  return raw;
}

async function connectToDatabase(options = {}) {
  const { required = true } = options;

  if (cached.conn) return cached.conn;

  const uri = getMongoUri();
  if (!uri) {
    if (required) {
      throw new Error("Database unavailable.");
    }
    return null;
  }

  if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
    if (required) {
      throw new Error("Database unavailable.");
    }
    return null;
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, {
      autoIndex: true,
      tls: true,
      tlsAllowInvalidCertificates: false
    });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    cached.conn = null;
    cached.promise = null;
    throw new Error(sanitizeDbErrorMessage(error));
  }
}

module.exports = {
  connectToDatabase,
  getMongoUri
};
