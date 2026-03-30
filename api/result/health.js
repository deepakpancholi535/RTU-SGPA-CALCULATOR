const APP_VERSION = process.env.APP_VERSION || "1.0.0";

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function handleHealth(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const hasMongoUri =
    typeof process.env.MONGODB_URI === "string" && process.env.MONGODB_URI.trim().length > 0;
  const hasCloudinary =
    Boolean(process.env.CLOUDINARY_CLOUD_NAME) &&
    Boolean(process.env.CLOUDINARY_API_KEY) &&
    Boolean(process.env.CLOUDINARY_API_SECRET);

  return sendJson(res, 200, {
    status: "ok",
    service: "rtu-result-api",
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    config: {
      mongoConfigured: hasMongoUri,
      cloudinaryConfigured: hasCloudinary
    }
  });
}

module.exports = handleHealth;
