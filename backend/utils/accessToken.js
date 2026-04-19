const crypto = require("crypto");

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const TOKEN_ALG = "HS256";

function normalizeRollNo(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

function normalizeSemester(value) {
  if (value === null || value === undefined || value === "") return null;
  const sem = Number.parseInt(value, 10);
  if (!Number.isFinite(sem) || sem < 1 || sem > 8) return null;
  return sem;
}

function normalizeSgpa(value) {
  const sgpa = Number(value);
  if (!Number.isFinite(sgpa)) return null;
  if (sgpa < 0 || sgpa > 10) return null;
  return Number(sgpa.toFixed(2));
}

function normalizeBranch(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, " ");
  return normalized || null;
}

function getSecret() {
  const secret =
    process.env.ACCESS_TOKEN_SECRET ||
    process.env.APP_SECRET ||
    process.env.CLOUDINARY_API_SECRET ||
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    "";
  return String(secret).trim();
}

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = normalized + (pad ? "=".repeat(4 - pad) : "");
  return Buffer.from(padded, "base64").toString("utf8");
}

function createSignature(payloadEncoded, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadEncoded)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseTtlSeconds() {
  const raw = Number.parseInt(process.env.ACCESS_TOKEN_TTL_SECONDS, 10);
  if (!Number.isFinite(raw) || raw < 60) return DEFAULT_TTL_SECONDS;
  return raw;
}

function createResultAccessToken(payload) {
  const secret = getSecret();
  if (!secret) {
    return null;
  }

  const rollNo = normalizeRollNo(payload?.rollNo);
  if (!rollNo) return null;

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + parseTtlSeconds();

  const claims = {
    alg: TOKEN_ALG,
    iat: issuedAt,
    exp: expiresAt,
    rollNo,
    semester: normalizeSemester(payload?.semester),
    branch: normalizeBranch(payload?.branch),
    sgpa: normalizeSgpa(payload?.sgpa)
  };

  const payloadEncoded = encodeBase64Url(JSON.stringify(claims));
  const signature = createSignature(payloadEncoded, secret);

  return {
    token: `${payloadEncoded}.${signature}`,
    expiresAt: new Date(expiresAt * 1000).toISOString()
  };
}

function verifyResultAccessToken(token) {
  const secret = getSecret();
  if (!secret || typeof token !== "string" || !token.includes(".")) return null;

  const [payloadEncoded, signature] = token.split(".");
  if (!payloadEncoded || !signature) return null;

  const expected = createSignature(payloadEncoded, secret);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (signatureBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(signatureBuf, expectedBuf)) return null;

  let parsed = null;
  try {
    parsed = JSON.parse(decodeBase64Url(payloadEncoded));
  } catch (error) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!parsed || parsed.alg !== TOKEN_ALG) return null;
  if (typeof parsed.exp !== "number" || parsed.exp < now) return null;

  const claims = {
    rollNo: normalizeRollNo(parsed.rollNo),
    semester: normalizeSemester(parsed.semester),
    branch: normalizeBranch(parsed.branch),
    sgpa: normalizeSgpa(parsed.sgpa),
    iat: typeof parsed.iat === "number" ? parsed.iat : null,
    exp: parsed.exp
  };

  if (!claims.rollNo) return null;
  return claims;
}

function extractBearerTokenFromHeaders(headers) {
  const value = headers?.authorization || headers?.Authorization || "";
  const match = String(value).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

module.exports = {
  createResultAccessToken,
  verifyResultAccessToken,
  extractBearerTokenFromHeaders,
  normalizeRollNo
};
