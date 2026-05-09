import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockExpress } from '../helpers.js';
import { createRateLimiter } from '../../src/middleware/rate-limit.js';

describe('rate-limit middleware (createRateLimiter)', () => {
  it('exports createRateLimiter as a function', () => {
    expect(typeof createRateLimiter).toBe('function');
  });

  it('returns a middleware function', () => {
    const middleware = createRateLimiter();
    expect(typeof middleware).toBe('function');
  });

  it('accepts custom windowMs and max options', () => {
    const middleware = createRateLimiter({ windowMs: 30_000, max: 50 });
    expect(typeof middleware).toBe('function');
  });

  describe('current placeholder behavior', () => {
    it('always calls next() (passthrough)', () => {
      const middleware = createRateLimiter();
      const { req, res, next } = createMockExpress();

      middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
    });

    it('does not set rate-limit headers', () => {
      const middleware = createRateLimiter();
      const { req, res, next } = createMockExpress();

      middleware(req as any, res as any, next);

      expect(res.setHeader).not.toHaveBeenCalled();
    });

    it('never returns 429 regardless of request count', () => {
      const middleware = createRateLimiter({ max: 1 });

      // Fire many requests — all should pass through
      for (let i = 0; i < 100; i++) {
        const { req, res, next } = createMockExpress();
        middleware(req as any, res as any, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      }
    });
  });

  describe('different configurations', () => {
    it('accepts global-style config (high max, long window)', () => {
      const middleware = createRateLimiter({ windowMs: 60_000, max: 1000 });
      const { req, res, next } = createMockExpress();
      middleware(req as any, res as any, next);
      expect(next).toHaveBeenCalled();
    });

    it('accepts chat-style config (moderate max)', () => {
      const middleware = createRateLimiter({ windowMs: 60_000, max: 60 });
      const { req, res, next } = createMockExpress();
      middleware(req as any, res as any, next);
      expect(next).toHaveBeenCalled();
    });

    it('accepts proxy-style config (low max, short window)', () => {
      const middleware = createRateLimiter({ windowMs: 10_000, max: 10 });
      const { req, res, next } = createMockExpress();
      middleware(req as any, res as any, next);
      expect(next).toHaveBeenCalled();
    });

    it('works with default options (no args)', () => {
      const middleware = createRateLimiter({} );
      const { req, res, next } = createMockExpress();
      middleware(req as any, res as any, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
