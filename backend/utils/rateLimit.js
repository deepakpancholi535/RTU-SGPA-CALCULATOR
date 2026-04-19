const WINDOW_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const globalState =
  global.__rtuRateLimitState ||
  (global.__rtuRateLimitState = {
    buckets: new Map(),
    lastSweep: 0
  });

function maybeSweep(now) {
  if (now - globalState.lastSweep < WINDOW_SWEEP_INTERVAL_MS) return;
  globalState.lastSweep = now;
  globalState.buckets.forEach((value, key) => {
    if (!value || value.resetAt <= now) {
      globalState.buckets.delete(key);
    }
  });
}

function getClientIp(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (forwarded) return forwarded;
  return req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown";
}

function consumeRateLimit({ key, windowMs, max }) {
  const now = Date.now();
  maybeSweep(now);
  const safeWindow = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60 * 1000;
  const safeMax = Number.isFinite(max) && max > 0 ? max : 60;
  const bucketKey = String(key || "global");

  const existing = globalState.buckets.get(bucketKey);
  if (!existing || existing.resetAt <= now) {
    const next = {
      count: 1,
      resetAt: now + safeWindow
    };
    globalState.buckets.set(bucketKey, next);
    return { allowed: true, remaining: safeMax - 1, resetAt: next.resetAt };
  }

  if (existing.count >= safeMax) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(safeMax - existing.count, 0),
    resetAt: existing.resetAt
  };
}

function createExpressRateLimiter(options = {}) {
  const {
    windowMs = 60 * 1000,
    max = 60,
    keyPrefix = "global",
    message = "Too many requests. Please try again shortly."
  } = options;

  return (req, res, next) => {
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;
    const result = consumeRateLimit({ key, windowMs, max });
    if (result.allowed) {
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));
      res.setHeader("X-RateLimit-Reset", String(result.resetAt));
      return next();
    }

    const retryAfterSeconds = Math.max(Math.ceil((result.resetAt - Date.now()) / 1000), 1);
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({ error: message });
  };
}

module.exports = {
  getClientIp,
  consumeRateLimit,
  createExpressRateLimiter
};
