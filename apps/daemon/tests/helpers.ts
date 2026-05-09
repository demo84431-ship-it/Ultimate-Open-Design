import type { NextFunction, Request, Response } from 'express';
import { vi } from 'vitest';

/**
 * Creates mock Express req, res, next objects for unit testing middleware
 * and route handlers without starting a real HTTP server.
 */
export function createMockExpress(overrides?: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
  params?: Record<string, string>;
}) {
  const headers = { ...(overrides?.headers ?? {}) };

  const req = {
    method: overrides?.method ?? 'GET',
    path: overrides?.path ?? '/',
    headers,
    body: overrides?.body ?? {},
    query: overrides?.query ?? {},
    params: overrides?.params ?? {},
    get(name: string) {
      // Express req.get is case-insensitive
      const lower = name.toLowerCase();
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lower) return (headers as Record<string, string>)[key];
      }
      return undefined;
    },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;

  const headerStore: Record<string, string> = {};
  const jsonBodies: unknown[] = [];

  const res = {
    statusCode: 200,
    status: vi.fn((code: number) => {
      (res as any).statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      jsonBodies.push(body);
      return res;
    }),
    send: vi.fn((body: unknown) => {
      jsonBodies.push(body);
      return res;
    }),
    setHeader: vi.fn((name: string, value: string) => {
      headerStore[name] = value;
      return res;
    }),
    getHeader: vi.fn((name: string) => headerStore[name]),
    end: vi.fn(() => res),
    _headerStore: headerStore,
    _jsonBodies: jsonBodies,
  } as unknown as Response & {
    _headerStore: Record<string, string>;
    _jsonBodies: unknown[];
  };

  const next = vi.fn() as NextFunction;

  return { req, res, next };
}

/**
 * Creates a mock Express request (alias for createMockExpress().req).
 */
export function createMockReq(overrides?: Parameters<typeof createMockExpress>[0]) {
  return createMockExpress(overrides).req;
}

/**
 * Creates a mock Express response with jest-like spies.
 */
export function createMockRes() {
  return createMockExpress().res;
}

/**
 * Creates a mock next function.
 */
export function createMockNext() {
  return vi.fn() as NextFunction;
}
