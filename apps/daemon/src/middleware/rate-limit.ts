// @ts-nocheck
/**
 * Rate limiting middleware placeholder.
 *
 * Currently a no-op passthrough. In production, swap the body with a real
 * token-bucket or sliding-window implementation backed by the in-memory store
 * or Redis.
 */
export function createRateLimiter({ windowMs = 60_000, max = 100 } = {}) {
  return (_req, _res, next) => {
    // Placeholder: always allow.
    next();
  };
}
