const path = require("path");
const cloudinary = require("cloudinary").v2;

function isConfigured() {
  return (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function configure() {
  if (!isConfigured()) return false;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
  return true;
}

async function uploadResultFile(filePath, originalName) {
  if (!configure()) return null;

  const safeName = originalName
    ? originalName.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "")
    : path.basename(filePath || "result");

  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: "auto",
    folder: "rtu-results",
    public_id: safeName.replace(/\.[^.]+$/, ""),
    use_filename: false,
    unique_filename: true
  });

  return {
    publicId: result.public_id || null,
    secureUrl: result.secure_url || null,
    resourceType: result.resource_type || null,
    format: result.format || null,
    bytes: result.bytes || null
  };
}

module.exports = {
  uploadResultFile
};
