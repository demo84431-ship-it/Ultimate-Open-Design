// @ts-nocheck
import type { Express, Request, Response } from 'express';

/**
 * Context required by the chat/run routes.
 */
export interface ChatRouteContext {
  db: any;
  design: any;
  sendApiError: (res: Response, status: number, code: string, message: string, init?: any) => void;
  createSseResponse: (res: Response, opts?: any) => any;
  daemonShuttingDown: () => boolean;
  startChatRun: (chatBody: any, run: any) => Promise<void>;
  // Connection test
  testProviderConnection: (opts: any) => Promise<any>;
  testAgentConnection: (opts: any) => Promise<any>;
  getAgentDef: (id: string) => any;
  isKnownModel: (def: any, model: string) => boolean;
  sanitizeCustomModel: (model: string) => string | null;
  // Critique
  critiqueRunRegistry: any;
  handleCritiqueInterrupt: (db: any, registry: any) => any;
}

export function registerChatRoutes(app: Express, ctx: ChatRouteContext) {
  const {
    design,
    sendApiError,
    daemonShuttingDown,
    startChatRun,
    testProviderConnection,
    testAgentConnection,
    getAgentDef,
    isKnownModel,
    sanitizeCustomModel,
    db,
    critiqueRunRegistry,
    handleCritiqueInterrupt,
  } = ctx;

  // ---- Runs -----------------------------------------------------------------

  app.post('/api/runs', (req, res) => {
    if (daemonShuttingDown()) {
      return sendApiError(res, 503, 'UPSTREAM_UNAVAILABLE', 'daemon is shutting down');
    }
    const run = design.runs.create(req.body || {});
    const declared = String(req.get('x-od-client') ?? '').toLowerCase();
    if (declared === 'desktop' || declared === 'web') {
      run.clientType = declared;
    } else {
      const ua = String(req.get('user-agent') ?? '');
      run.clientType = ua.includes('Electron/') ? 'desktop' : 'web';
    }
    const body = { runId: run.id };
    res.status(202).json(body);
    design.runs.start(run, () => startChatRun(req.body || {}, run));
  });

  app.get('/api/runs', (req, res) => {
    const { projectId, conversationId, status } = req.query;
    const runs = design.runs.list({ projectId, conversationId, status });
    const body = { runs: runs.map(design.runs.statusBody) };
    res.json(body);
  });

  app.get('/api/runs/:id', (req, res) => {
    const run = design.runs.get(req.params.id);
    if (!run) return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
    res.json(design.runs.statusBody(run));
  });

  app.get('/api/runs/:id/events', (req, res) => {
    const run = design.runs.get(req.params.id);
    if (!run) return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
    design.runs.stream(run, req, res);
  });

  app.post('/api/runs/:id/cancel', (req, res) => {
    const run = design.runs.get(req.params.id);
    if (!run) return sendApiError(res, 404, 'NOT_FOUND', 'run not found');
    design.runs.cancel(run);
    const body = { ok: true };
    res.json(body);
  });

  // ---- Chat (legacy SSE endpoint) ------------------------------------------

  app.post('/api/chat', (req, res) => {
    if (daemonShuttingDown()) {
      return sendApiError(res, 503, 'UPSTREAM_UNAVAILABLE', 'daemon is shutting down');
    }
    const run = design.runs.create();
    design.runs.stream(run, req, res);
    design.runs.start(run, () => startChatRun(req.body || {}, run));
  });

  // ---- Connection tests (single-shot JSON; no SSE) ------------------------

  app.post('/api/test/connection', async (req, res) => {
    const controller = new AbortController();
    const abortIfRequestAborted = () => {
      if ((req.aborted || !req.complete) && !res.writableEnded) {
        controller.abort();
      }
    };
    const abortIfResponseClosed = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.on('close', abortIfRequestAborted);
    res.on('close', abortIfResponseClosed);
    const body = req.body || {};
    try {
      if (body.mode === 'provider') {
        const protocol = body.protocol;
        if (
          typeof protocol !== 'string' ||
          !['anthropic', 'openai', 'azure', 'google', 'ollama'].includes(protocol)
        ) {
          return sendApiError(
            res, 400, 'BAD_REQUEST',
            'protocol must be one of anthropic|openai|azure|google|ollama',
          );
        }
        if (
          typeof body.baseUrl !== 'string' ||
          typeof body.apiKey !== 'string' ||
          typeof body.model !== 'string' ||
          !body.baseUrl.trim() ||
          !body.apiKey.trim() ||
          !body.model.trim()
        ) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'baseUrl, apiKey, and model are required');
        }
        try {
          const result = await testProviderConnection({
            protocol,
            baseUrl: body.baseUrl,
            apiKey: body.apiKey,
            model: body.model,
            apiVersion: typeof body.apiVersion === 'string' ? body.apiVersion : undefined,
            signal: controller.signal,
          });
          return res.json(result);
        } catch (err) {
          console.warn(`[test:provider] uncaught: ${err instanceof Error ? err.message : String(err)}`);
          return sendApiError(res, 500, 'INTERNAL', 'Connection test failed');
        }
      }

      if (body.mode === 'agent') {
        if (typeof body.agentId !== 'string' || !body.agentId.trim()) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'agentId is required');
        }
        try {
          const def = getAgentDef(body.agentId);
          const testStart = Date.now();
          const safeModel =
            def && typeof body.model === 'string'
              ? isKnownModel(def, body.model) ? body.model : sanitizeCustomModel(body.model)
              : undefined;
          if (def && typeof body.model === 'string' && body.model.trim() && !safeModel) {
            return res.json({
              ok: false,
              kind: 'invalid_model_id',
              latencyMs: Date.now() - testStart,
              model: body.model.trim(),
              agentName: def.name,
              detail: 'Invalid custom model id. Use a model id that starts with a letter or number and contains no spaces.',
            });
          }
          const safeReasoning =
            def && typeof body.reasoning === 'string' && Array.isArray(def.reasoningOptions)
              ? (def.reasoningOptions.find((r) => r.id === body.reasoning)?.id ?? undefined)
              : undefined;
          const result = await testAgentConnection({
            agentId: body.agentId,
            model: safeModel ?? undefined,
            reasoning: safeReasoning,
            agentCliEnv: body.agentCliEnv && typeof body.agentCliEnv === 'object' ? body.agentCliEnv : undefined,
            signal: controller.signal,
          });
          return res.json(result);
        } catch (err) {
          console.warn(`[test:agent] uncaught: ${err instanceof Error ? err.message : String(err)}`);
          return sendApiError(res, 500, 'INTERNAL', 'Agent test failed');
        }
      }

      return sendApiError(res, 400, 'BAD_REQUEST', 'mode must be one of provider|agent');
    } finally {
      req.off('close', abortIfRequestAborted);
      res.off('close', abortIfResponseClosed);
    }
  });

  // ---- Critique Theater endpoints ------------------------------------------

  app.post(
    '/api/projects/:projectId/critique/:runId/interrupt',
    handleCritiqueInterrupt(db, critiqueRunRegistry),
  );
}
