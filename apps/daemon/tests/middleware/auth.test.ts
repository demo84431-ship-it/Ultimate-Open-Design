import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockExpress } from '../helpers.js';
import {
  validateLocalDaemonRequest,
  requireLocalDaemonRequest,
  bearerTokenFromRequest,
  authorizeToolRequest,
} from '../../src/middleware/auth.js';

describe('auth middleware', () => {
  describe('bearerTokenFromRequest', () => {
    it('extracts token from Bearer authorization header', () => {
      const { req } = createMockExpress({
        headers: { Authorization: 'Bearer my-token-123' },
      });
      expect(bearerTokenFromRequest(req)).toBe('my-token-123');
    });

    it('returns undefined when no Authorization header', () => {
      const { req } = createMockExpress({ headers: {} });
      expect(bearerTokenFromRequest(req)).toBeUndefined();
    });

    it('returns undefined for non-Bearer scheme', () => {
      const { req } = createMockExpress({
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });
      expect(bearerTokenFromRequest(req)).toBeUndefined();
    });

    it('is case-insensitive on the scheme', () => {
      const { req } = createMockExpress({
        headers: { Authorization: 'bearer lower-case-token' },
      });
      expect(bearerTokenFromRequest(req)).toBe('lower-case-token');
    });
  });

  describe('validateLocalDaemonRequest', () => {
    it('accepts request from loopback 127.0.0.1 with localhost host', () => {
      const { req } = createMockExpress({
        headers: { host: 'localhost:3000' },
      });
      (req as any).socket = { remoteAddress: '127.0.0.1' };

      const result = validateLocalDaemonRequest(req);
      expect(result.ok).toBe(true);
    });

    it('accepts request from ::1 with localhost host', () => {
      const { req } = createMockExpress({
        headers: { host: 'localhost' },
      });
      (req as any).socket = { remoteAddress: '::1' };

      const result = validateLocalDaemonRequest(req);
      expect(result.ok).toBe(true);
    });

    it('rejects request from non-loopback address', () => {
      const { req } = createMockExpress({
        headers: { host: 'localhost:3000' },
      });
      (req as any).socket = { remoteAddress: '192.168.1.100' };

      const result = validateLocalDaemonRequest(req);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('loopback');
    });

    it('rejects request with non-loopback host header', () => {
      const { req } = createMockExpress({
        headers: { host: 'example.com' },
      });
      (req as any).socket = { remoteAddress: '127.0.0.1' };

      const result = validateLocalDaemonRequest(req);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('host');
    });

    it('rejects request with malicious origin header', () => {
      const { req } = createMockExpress({
        headers: { host: 'localhost', origin: 'https://evil.com' },
      });
      (req as any).socket = { remoteAddress: '127.0.0.1' };

      const result = validateLocalDaemonRequest(req);
      expect(result.ok).toBe(false);
    });

    it('accepts valid loopback origin header', () => {
      const { req } = createMockExpress({
        headers: { host: 'localhost', origin: 'http://localhost:5173' },
      });
      (req as any).socket = { remoteAddress: '127.0.0.1' };

      const result = validateLocalDaemonRequest(req);
      expect(result.ok).toBe(true);
      expect(result.origin).toBe('http://localhost:5173');
    });
  });

  describe('requireLocalDaemonRequest middleware', () => {
    const sendApiError = vi.fn();

    beforeEach(() => {
      sendApiError.mockClear();
    });

    it('calls next() for valid loopback request', () => {
      const middleware = requireLocalDaemonRequest(sendApiError);
      const { req, res, next } = createMockExpress({
        headers: { host: 'localhost:3000' },
      });
      (req as any).socket = { remoteAddress: '127.0.0.1' };

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(sendApiError).not.toHaveBeenCalled();
    });

    it('returns 403 for non-loopback peer', () => {
      const middleware = requireLocalDaemonRequest(sendApiError);
      const { req, res, next } = createMockExpress({
        headers: { host: 'localhost:3000' },
      });
      (req as any).socket = { remoteAddress: '10.0.0.1' };

      middleware(req, res, next);

      expect(sendApiError).toHaveBeenCalledWith(
        res, 403, 'FORBIDDEN', expect.stringContaining('loopback'), expect.anything()
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('sets CORS headers for valid requests with origin', () => {
      const middleware = requireLocalDaemonRequest(sendApiError);
      const { req, res, next } = createMockExpress({
        headers: { host: 'localhost', origin: 'http://localhost:5173' },
      });
      (req as any).socket = { remoteAddress: '127.0.0.1' };

      middleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Origin');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:5173');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Max-Age', '600');
    });
  });

  describe('authorizeToolRequest', () => {
    const sendApiError = vi.fn();

    beforeEach(() => {
      sendApiError.mockClear();
    });

    it('returns grant when token is valid', () => {
      const mockGrant = { projectId: 'proj-1', scope: 'read' };
      const registry = {
        validate: vi.fn().mockReturnValue({ ok: true, grant: mockGrant }),
      };

      const { req } = createMockExpress({
        headers: { Authorization: 'Bearer valid-token' },
        path: '/api/tools/test',
      });

      const result = authorizeToolRequest(req, {} as any, 'read', registry, sendApiError);

      expect(result).toEqual(mockGrant);
      expect(registry.validate).toHaveBeenCalledWith('valid-token', {
        endpoint: '/api/tools/test',
        operation: 'read',
      });
      expect(sendApiError).not.toHaveBeenCalled();
    });

    it('returns null and sends 401 when token is missing', () => {
      const registry = {
        validate: vi.fn().mockReturnValue({
          ok: false, code: 'TOOL_TOKEN_MISSING', message: 'No token provided'
        }),
      };

      const { req } = createMockExpress({
        headers: {},
        path: '/api/tools/test',
      });

      const result = authorizeToolRequest(req, {} as any, 'read', registry, sendApiError);

      expect(result).toBeNull();
      expect(sendApiError).toHaveBeenCalledWith(
        {}, 401, 'TOOL_TOKEN_MISSING', 'No token provided', expect.anything()
      );
    });

    it('returns 403 for endpoint denial', () => {
      const registry = {
        validate: vi.fn().mockReturnValue({
          ok: false, code: 'TOOL_ENDPOINT_DENIED', message: 'Endpoint not allowed'
        }),
      };

      const { req } = createMockExpress({
        headers: { Authorization: 'Bearer token' },
        path: '/api/admin',
      });

      const result = authorizeToolRequest(req, {} as any, 'write', registry, sendApiError);

      expect(result).toBeNull();
      expect(sendApiError).toHaveBeenCalledWith(
        {}, 403, 'TOOL_ENDPOINT_DENIED', 'Endpoint not allowed', expect.anything()
      );
    });
  });
});
