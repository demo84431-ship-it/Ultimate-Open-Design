import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockExpress } from '../helpers.js';
import { validateBody, validateQuery, validateParams } from '../../src/middleware/validate.js';

/**
 * Create a mock schema that matches the Schema interface used by validate.ts.
 * Returns { success: true, data } or { success: false, error: { issues } }.
 */
function createMockSchema<T>(opts: {
  parse: (data: unknown) => T;
  shouldFail?: boolean;
  issues?: Array<{ path: (string | number)[]; message: string }>;
}) {
  return {
    safeParse(data: unknown) {
      if (opts.shouldFail) {
        return {
          success: false as const,
          error: { issues: opts.issues ?? [{ path: [], message: 'Invalid' }] },
        };
      }
      try {
        return { success: true as const, data: opts.parse(data) as T };
      } catch (err) {
        return {
          success: false as const,
          error: { issues: [{ path: [], message: (err as Error).message }] },
        };
      }
    },
  };
}

describe('validateBody middleware', () => {
  it('calls next() with valid data', () => {
    const schema = createMockSchema({ parse: (d) => d });
    const middleware = validateBody(schema as any);
    const { req, res, next } = createMockExpress({ body: { name: 'test' } });

    middleware(req as any, res as any, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('replaces req.body with parsed data', () => {
    const transformed = { name: 'TEST', normalized: true };
    const schema = createMockSchema({ parse: () => transformed });
    const middleware = validateBody(schema as any);
    const { req, res, next } = createMockExpress({ body: { name: 'test' } });

    middleware(req as any, res as any, next);

    expect(req.body).toEqual(transformed);
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 with invalid data', () => {
    const schema = createMockSchema({
      parse: () => { throw new Error('bad'); },
      shouldFail: true,
      issues: [{ path: ['body', 'email'], message: 'Invalid email' }],
    });
    const middleware = validateBody(schema as any);
    const { req, res, next } = createMockExpress({ body: { email: 'not-an-email' } });

    middleware(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns structured error details on failure', () => {
    const schema = createMockSchema({
      parse: () => { throw new Error('bad'); },
      shouldFail: true,
      issues: [
        { path: ['name'], message: 'Required' },
        { path: ['age'], message: 'Must be positive' },
      ],
    });
    const middleware = validateBody(schema as any);
    const { req, res, next } = createMockExpress({ body: {} });

    middleware(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const jsonBody = (res as any)._jsonBodies[0] as any;
    expect(jsonBody.error).toBe('Validation failed');
    expect(jsonBody.details).toHaveLength(2);
    expect(jsonBody.details[0]).toEqual({ path: ['name'], message: 'Required' });
    expect(jsonBody.details[1]).toEqual({ path: ['age'], message: 'Must be positive' });
  });
});

describe('validateQuery middleware', () => {
  it('calls next() with valid query', () => {
    const schema = createMockSchema({ parse: (d) => d });
    const middleware = validateQuery(schema as any);
    const { req, res, next } = createMockExpress({ query: { page: '1' } });

    middleware(req as any, res as any, next);

    expect(next).toHaveBeenCalled();
  });

  it('stores validated data as validatedQuery', () => {
    const parsed = { page: 1, limit: 20 };
    const schema = createMockSchema({ parse: () => parsed });
    const middleware = validateQuery(schema as any);
    const { req, res, next } = createMockExpress({ query: { page: '1' } });

    middleware(req as any, res as any, next);

    expect((req as any).validatedQuery).toEqual(parsed);
  });

  it('returns 400 for invalid query params', () => {
    const schema = createMockSchema({
      parse: () => { throw new Error('bad'); },
      shouldFail: true,
      issues: [{ path: ['query', 'page'], message: 'Expected number' }],
    });
    const middleware = validateQuery(schema as any);
    const { req, res, next } = createMockExpress({ query: { page: 'abc' } });

    middleware(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('validateParams middleware', () => {
  it('calls next() with valid params', () => {
    const schema = createMockSchema({ parse: (d) => d });
    const middleware = validateParams(schema as any);
    const { req, res, next } = createMockExpress({ params: { id: '123' } });

    middleware(req as any, res as any, next);

    expect(next).toHaveBeenCalled();
  });

  it('stores validated data as validatedParams', () => {
    const parsed = { id: 'proj-abc' };
    const schema = createMockSchema({ parse: () => parsed });
    const middleware = validateParams(schema as any);
    const { req, res, next } = createMockExpress({ params: { id: 'proj-abc' } });

    middleware(req as any, res as any, next);

    expect((req as any).validatedParams).toEqual(parsed);
  });

  it('returns 400 for invalid params', () => {
    const schema = createMockSchema({
      parse: () => { throw new Error('bad'); },
      shouldFail: true,
      issues: [{ path: ['params', 'id'], message: 'Invalid UUID' }],
    });
    const middleware = validateParams(schema as any);
    const { req, res, next } = createMockExpress({ params: { id: 'not-uuid' } });

    middleware(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
