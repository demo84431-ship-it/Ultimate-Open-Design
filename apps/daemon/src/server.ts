// @ts-nocheck
/**
 * Slim daemon server entry point.
 *
 * This file wires together the extracted route modules, middleware,
 * and shared services. Target: <300 lines.
 *
 * The original monolith (apps-orig/daemon/src/server.ts, 7083 lines)
 * has been decomposed into:
 *   - routes/health.ts     — health + version endpoints
 *   - routes/projects.ts   — project CRUD, conversations, messages, files
 *   - routes/proxy.ts      — LLM provider proxy (Anthropic, OpenAI, Azure, Google, Ollama)
 *   - routes/chat.ts       — chat, runs, connection tests, critique interrupt
 *   - routes/deploy.ts     — Vercel, Cloudflare Pages, finalize
 *   - routes/tools.ts      — agents, skills, design systems, templates, media, live artifacts, MCP, orbit, connectors
 *   - middleware/           — auth, rate-limit, security, validation
 *   - agents/              — agent adapter system
 *   - context.ts           — shared context type
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { openDatabase, getProject, listProjects, updateProject, insertTemplate, getTemplate, deleteTemplate, listTemplates, listDeployments, getDeployment, getDeploymentById, upsertDeployment, listLatestProjectRunStatuses, listProjectsAwaitingInput } from './db.js';
import { createChatRunService } from './runs.js';
import { createSseResponse as _createSseResponse, SSE_KEEPALIVE_INTERVAL_MS } from './server-helpers.js';
import { registerHealthRoutes, registerProjectRoutes, registerProxyRoutes, registerChatRoutes, registerDeployRoutes, registerToolsRoutes } from './routes/index.js';
import { requireLocalDaemonRequest } from './middleware/auth.js';
import { isLocalSameOrigin, allowedBrowserPorts, configuredAllowedOrigins, isAllowedBrowserOrigin } from './origin-validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

export function resolveProjectRoot(moduleDir) {
  const base = path.basename(moduleDir);
  const daemonDir = base === 'dist' || base === 'src' ? path.dirname(moduleDir) : moduleDir;
  return path.resolve(daemonDir, '../..');
}

const PROJECT_ROOT = resolveProjectRoot(__dirname);
const RUNTIME_DATA_DIR = path.join(PROJECT_ROOT, '.od');
const PROJECTS_DIR = path.join(RUNTIME_DATA_DIR, 'projects');
const SKILLS_DIR = path.join(PROJECT_ROOT, 'skills');
const DESIGN_SYSTEMS_DIR = path.join(PROJECT_ROOT, 'design-systems');
const CRAFT_DIR = path.join(PROJECT_ROOT, 'craft');
const FRAMES_DIR = path.join(PROJECT_ROOT, 'assets', 'frames');
const BUNDLED_PETS_DIR = path.join(PROJECT_ROOT, 'assets', 'community-pets');
const PROMPT_TEMPLATES_DIR = path.join(PROJECT_ROOT, 'prompt-templates');
const ARTIFACTS_DIR = path.join(RUNTIME_DATA_DIR, 'artifacts');
const UPLOAD_DIR = path.join(os.tmpdir(), 'od-uploads');
const STATIC_DIR = path.join(PROJECT_ROOT, 'apps', 'web', 'out');

// Ensure directories exist
fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export function createCompatApiErrorResponse(code, message, init = {}) {
  return { error: { code, message, ...init } };
}

export function createSseErrorPayload(code, message, init = {}) {
  return { message, error: { code, message, ...init } };
}

export async function startServer({ port = 7456, host = '127.0.0.1', returnServer = false } = {}) {
  let resolvedPort = port;
  let daemonShuttingDown = false;
  const extraAllowedOrigins = configuredAllowedOrigins();

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // CORS middleware for /api routes
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin == null || origin === '') return next();
    if (origin === 'null') {
      const isSafeReadOnly = req.method === 'GET' && /^\/projects\/[^/]+\/raw\/|^\/codex-pets\/[^/]+\/spritesheet$/.test(req.path);
      if (!isSafeReadOnly) return res.status(403).json({ error: 'Origin: null not allowed' });
      return next();
    }
    if (!resolvedPort) return res.status(403).json({ error: 'Server initializing' });
    const ports = allowedBrowserPorts(resolvedPort);
    if (!isAllowedBrowserOrigin(origin, req.headers.host, ports, host, extraAllowedOrigins)) {
      if (req.method !== 'GET' || !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])$/.test(origin)) {
        return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
      }
    }
    next();
  });

  // Database
  const db = openDatabase(PROJECT_ROOT, { dataDir: RUNTIME_DATA_DIR });

  // Services
  const design = { runs: createChatRunService({ createSseResponse: _createSseResponse, createSseErrorPayload }) };

  // Active context (in-memory, shared with tools routes)
  let activeContext = null;

  // Helper functions
  function sendApiError(res, status, code, message, init = {}) {
    return res.status(status).json(createCompatApiErrorResponse(code, message, init));
  }

  function sendMulterError(res, err) {
    if (err?.code === 'LIMIT_FILE_SIZE') return sendApiError(res, 413, 'PAYLOAD_TOO_LARGE', 'file too large');
    return sendApiError(res, 400, 'BAD_REQUEST', err?.message || 'upload failed');
  }

  function createSseResponse(res, opts) {
    return _createSseResponse(res, opts);
  }

  // Static files
  if (fs.existsSync(STATIC_DIR)) app.use(express.static(STATIC_DIR));
  app.use('/artifacts', express.static(ARTIFACTS_DIR));
  app.use('/frames', express.static(FRAMES_DIR));

  // Shared context for route modules
  const ctx = {
    db, design, sendApiError, sendMulterError, createSseResponse,
    isLocalSameOrigin, resolvedPort: () => resolvedPort,
    getProject, listProjects, updateProject,
    insertTemplate, getTemplate, deleteTemplate, listTemplates,
    listDeployments, getDeployment, getDeploymentById, upsertDeployment,
    listLatestProjectRunStatuses, listProjectsAwaitingInput,
    PROJECT_ROOT, PROJECTS_DIR, RUNTIME_DATA_DIR,
    RUNTIME_DATA_DIR_CANONICAL: RUNTIME_DATA_DIR,
    SKILLS_DIR, DESIGN_SYSTEMS_DIR, CRAFT_DIR, FRAMES_DIR,
    BUNDLED_PETS_DIR, PROMPT_TEMPLATES_DIR, ARTIFACTS_DIR, UPLOAD_DIR,
    daemonUrl: `http://127.0.0.1:${port}`,
    desktopPdfExporter: null,
    requireLocalDaemonRequest,
    activeContext: null,
    OD_BIN: path.join(__dirname, 'cli.js'),
  };

  // Wire active context getter/setter
  Object.defineProperty(ctx, 'activeContext', {
    get: () => activeContext,
    set: (v) => { activeContext = v; },
  });

  // Register all route modules
  registerHealthRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerProxyRoutes(app, ctx);
  registerChatRoutes(app, ctx);
  registerDeployRoutes(app, ctx);
  registerToolsRoutes(app, ctx);

  // Start server
  return await new Promise((resolve, reject) => {
    let server;
    try {
      server = app.listen(port, host, () => {
        const address = server.address();
        const boundPort = address && typeof address === 'object' ? address.port : null;
        if (!boundPort) return reject(new Error('Failed to resolve listening port'));
        resolvedPort = boundPort;
        const reportHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
        const url = `http://${reportHost}:${resolvedPort}`;
        ctx.daemonUrl = url;
        if (!returnServer) console.log(`[od] daemon listening on ${url}`);
        resolve(returnServer ? { url, server, shutdown: async () => { daemonShuttingDown = true; } } : url);
      });
    } catch (error) {
      reject(error);
      return;
    }
    server.on('error', reject);
  });
}
