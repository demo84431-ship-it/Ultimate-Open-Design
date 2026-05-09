/**
 * Zod-compatible request validation middleware factory for Express 4.x.
 *
 * Works with any schema object that exposes a `safeParse(data)` method
 * (Zod, Zod-like, or custom validators). No Zod dependency required —
 * just pass objects that match the `Schema` interface.
 *
 * On validation failure returns HTTP 400 with a structured error body:
 * ```json
 * {
 *   "error": "Validation failed",
 *   "details": [
 *     { "path": ["body", "email"], "message": "Invalid email" }
 *   ]
 * }
 * ```
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * Minimal interface that a schema must satisfy.
 * Zod schemas (`.parse()`, `.safeParse()`) and most validation libraries
 * expose a compatible `.safeParse()`.
 */
interface Schema<T = unknown> {
  safeParse(data: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } };
}

interface ValidationErrorIssue {
  path: (string | number)[];
  message: string;
}

function sendValidationError(res: Response, issues: ValidationErrorIssue[]): void {
  res.status(400).json({
    error: 'Validation failed',
    details: issues.map((issue) => ({
      path: issue.path.map(String),
      message: issue.message,
    })),
  });
}

/**
 * Validate `req.body` against the given schema.
 */
export function validateBody(schema: Schema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      sendValidationError(res, result.error.issues);
      return;
    }
    // Replace with the parsed (potentially coerced/transformed) value
    req.body = result.data;
    next();
  };
}

/**
 * Validate `req.query` against the given schema.
 */
export function validateQuery(schema: Schema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      sendValidationError(res, result.error.issues);
      return;
    }
    (req as any).validatedQuery = result.data;
    next();
  };
}

/**
 * Validate `req.params` against the given schema.
 */
export function validateParams(schema: Schema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      sendValidationError(res, result.error.issues);
      return;
    }
    (req as any).validatedParams = result.data;
    next();
  };
}
