const mongoose = require("mongoose");

let cached = global.__mongoose;
if (!cached) {
  cached = global.__mongoose = { conn: null, promise: null };
}

async function connectToDatabase() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    const uri = (process.env.MONGODB_URI || process.env.MONGO_URI || "").trim();
    if (!uri) {
      throw new Error("Mongo URI missing. Set MONGODB_URI or MONGO_URI.");
    }
    if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
      throw new Error("Mongo URI must start with mongodb:// or mongodb+srv://");
    }
    cached.promise = mongoose.connect(uri, {
      autoIndex: true,
      tls: true,
      tlsAllowInvalidCertificates: false
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = { connectToDatabase };
