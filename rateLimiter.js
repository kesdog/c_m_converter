const RATE_LIMIT_CAPACITY = 20;
const RATE_LIMIT_REFILL_MS = 3 * 1000;

function getClientIp(req, trustProxy) {
  const realIp = trustProxy && req.headers && req.headers["x-real-ip"];
  return typeof realIp === "string" && realIp.trim()
    ? realIp.trim()
    : req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown";
}

function createRateLimiter({ trustProxy = false, now = Date.now } = {}) {
  const buckets = new Map();
  let lastPrunedAt = 0;

  return (req) => {
    const currentTime = now();
    if (currentTime - lastPrunedAt >= RATE_LIMIT_CAPACITY * RATE_LIMIT_REFILL_MS) {
      // Discard full, idle buckets so unauthenticated clients cannot grow this map forever.
      for (const [ip, bucket] of buckets) {
        if (currentTime - bucket.updatedAt >= RATE_LIMIT_CAPACITY * RATE_LIMIT_REFILL_MS) {
          buckets.delete(ip);
        }
      }
      lastPrunedAt = currentTime;
    }

    const ip = getClientIp(req, trustProxy);
    const bucket = buckets.get(ip) || { tokens: RATE_LIMIT_CAPACITY, updatedAt: currentTime };
    const replenished = Math.floor((currentTime - bucket.updatedAt) / RATE_LIMIT_REFILL_MS);
    if (replenished > 0) {
      bucket.tokens = Math.min(RATE_LIMIT_CAPACITY, bucket.tokens + replenished);
      bucket.updatedAt += replenished * RATE_LIMIT_REFILL_MS;
    }
    if (bucket.tokens < 1) {
      buckets.set(ip, bucket);
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((RATE_LIMIT_REFILL_MS - (currentTime - bucket.updatedAt)) / 1000))
      };
    }

    bucket.tokens -= 1;
    buckets.set(ip, bucket);
    return { allowed: true };
  };
}

module.exports = { createRateLimiter };
