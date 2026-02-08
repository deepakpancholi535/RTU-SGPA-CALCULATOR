const mongoose = require("mongoose");

let cached = global.__mongoose;
if (!cached) {
  cached = global.__mongoose = { conn: null, promise: null };
}

async function connectToDatabase() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      throw new Error("MONGO_URI is missing");
    }
    cached.promise = mongoose.connect(uri, { autoIndex: true });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = { connectToDatabase };
