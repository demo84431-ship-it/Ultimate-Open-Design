// @ts-nocheck
import type { Express, Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  listSkills,
  findSkillById,
  splitDerivedSkillId,
} from '../skills.js';
import { listDesignSystems, readDesignSystem } from '../design-systems.js';
import { listPromptTemplates, readPromptTemplate } from '../prompt-templates.js';
import { renderDesignSystemPreview } from '../design-system-preview.js';
import { renderDesignSystemShowcase } from '../design-system-showcase.js';
import { listCodexPets, readCodexPetSpritesheet } from '../codex-pets.js';
import { syncCommunityPets } from '../community-pets-sync.js';
import { lintArtifact, renderFindingsForAgent } from '../lint-artifact.js';
import { readAppConfig, writeAppConfig } from '../app-config.js';
import { generateMedia } from '../media.js';
import { searchResearch, ResearchError } from '../research/index.js';
import {
  MEDIA_PROVIDERS,
  IMAGE_MODELS,
  VIDEO_MODELS,
  AUDIO_MODELS_BY_KIND,
  MEDIA_ASPECTS,
  VIDEO_LENGTHS_SEC,
  AUDIO_DURATIONS_SEC,
} from '../media-models.js';
import { readMaskedConfig, writeConfig } from '../media-config.js';
import {
  deleteMediaTask,
  getMediaTask,
  insertMediaTask,
  listMediaTasksByProject,
  listRecentMediaTasks,
  reconcileMediaTasksOnBoot,
  updateMediaTask,
} from '../media-tasks.js';
import {
  createLiveArtifact,
  deleteLiveArtifact,
  ensureLiveArtifactPreview,
  getLiveArtifact,
  LiveArtifactRefreshLockError,
  LiveArtifactStoreValidationError,
  listLiveArtifacts,
  listLiveArtifactRefreshLogEntries,
  readLiveArtifactCode,
  recoverStaleLiveArtifactRefreshes,
  updateLiveArtifact,
} from '../live-artifacts/store.js';
import { LiveArtifactRefreshUnavailableError, refreshLiveArtifact } from '../live-artifacts/refresh-service.js';
import { LiveArtifactRefreshAbortError } from '../live-artifacts/refresh.js';
import {
  configureConnectorCredentialStore,
  ConnectorServiceError,
  deleteConnectorCredentialsByProvider,
  FileConnectorCredentialStore,
} from '../connectors/service.js';
import { composioConnectorProvider } from '../connectors/composio.js';
import {
  configureComposioConfigStore,
  readComposioConfig,
  readPublicComposioConfig,
  writeComposioConfig,
} from '../connectors/composio-config.js';
import { registerConnectorRoutes } from '../connectors/routes.js';
import { CHAT_TOOL_ENDPOINTS, CHAT_TOOL_OPERATIONS, toolTokenRegistry } from '../tool-tokens.js';
import {
  buildMcpInstallPayload,
  MCP_TEMPLATES,
  buildClaudeMcpJson,
  buildAcpMcpServers,
  isManagedProjectCwd,
  readMcpConfig,
  writeMcpConfig,
} from '../mcp-config.js';
import {
  beginAuth,
  exchangeCodeForToken,
  PendingAuthCache,
  refreshAccessToken,
} from '../mcp-oauth.js';
import {
  clearToken,
  getToken,
  isTokenExpired,
  readAllTokens,
  setToken,
} from '../mcp-tokens.js';
import { readCurrentAppVersionInfo } from '../app-version.js';
import { validateArtifactManifestInput } from '../artifact-manifest.js';
import { buildDocumentPreview } from '../document-preview.js';
import {
  ensureProject,
  listFiles,
  readProjectFile,
  sanitizeName,
  writeProjectFile,
} from '../projects.js';
import { OrbitService } from '../orbit.js';

/**
 * Context required by the tools routes.
 */
export interface ToolsRouteContext {
  db: any;
  sendApiError: (res: Response, status: number, code: string, message: string, init?: any) => void;
  sendMulterError: (res: Response, err: any) => void;
  createSseResponse: (res: Response, opts?: any) => any;
  isLocalSameOrigin: (req: Request, port: number) => boolean;
  resolvedPort: () => number;
  getProject: (db: any, id: string) => any;
  updateProject: (db: any, id: string, patch: any) => any;
  insertTemplate: (db: any, template: any) => any;
  getTemplate: (db: any, id: string) => any;
  deleteTemplate: (db: any, id: string) => void;
  listTemplates: (db: any) => any[];
  // Directories
  PROJECT_ROOT: string;
  PROJECTS_DIR: string;
  SKILLS_DIR: string;
  DESIGN_SYSTEMS_DIR: string;
  CRAFT_DIR: string;
  PROMPT_TEMPLATES_DIR: string;
  BUNDLED_PETS_DIR: string;
  ARTIFACTS_DIR: string;
  UPLOAD_DIR: string;
  RUNTIME_DATA_DIR: string;
  // Services
  orbitService: OrbitService;
  desktopPdfExporter: ((input: any) => Promise<any>) | null;
  daemonUrl: string;
  upload: any;
  handleProjectUpload: any;
  // Media task helpers
  getLiveMediaTask: (db: any, taskId: string) => any;
  createMediaTask: (db: any, taskId: string, projectId: string, info?: any) => any;
  persistMediaTask: (db: any, task: any) => void;
  appendTaskProgress: (db: any, task: any, line: string) => void;
  notifyTaskWaiters: (db: any, task: any) => void;
  mediaTaskSnapshot: (task: any, since?: number) => any;
  MEDIA_TERMINAL_STATUSES: Set<string>;
  // Active event sinks
  activeProjectEventSinks: Map<string, Set<(payload: any) => void>>;
  // Tool token
  authorizeToolRequest: (req: Request, res: Response, operation: string) => any;
  requestProjectOverride: (projectId: string, tokenProjectId: string) => boolean;
  requestRunOverride: (runId: string, tokenRunId: string) => boolean;
  emitLiveArtifactEvent: (grant: any, action: string, artifact: any) => boolean;
  emitLiveArtifactRefreshEvent: (grant: any, payload: any) => boolean;
  emitProjectLiveArtifactEvent: (projectId: string, payload: any) => boolean;
  // Origin
  allowedBrowserPorts: (port: number) => number[];
  configuredAllowedOrigins: () => string[];
  isAllowedBrowserOrigin: (origin: string, host: string, ports: number[], bindHost: string, extra: string[]) => boolean;
  // MCP OAuth
  mcpPendingAuth: PendingAuthCache;
  getPublicBaseUrl: (req: Request) => string;
  refreshAndPersistToken: (dataDir: string, serverId: string, current: any) => Promise<any>;
  renderOAuthResultPage: (opts: { ok: boolean; serverId?: string; message?: string }) => string;
  // Native dialog
  openNativeFolderDialog: () => Promise<string | null>;
  // Project upload bridge
  projectMetadataLookup: (id: string) => Record<string, unknown> | null;
}

function sanitizeSlug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function rewriteSkillAssetUrls(html, skillId) {
  if (typeof html !== 'string' || html.length === 0) return html;
  return html.replace(
    /(\s(?:src|href)\s*=\s*)(['"])((?:\.\.\/([^/'"#?]+)\/)?(?:\.\/)?assets\/([^'"#?]+))(\2)/gi,
    (_match, attr, openQuote, _fullPath, siblingSkillId, relPath, closeQuote) => {
      const resolvedSkillId = siblingSkillId || skillId;
      const prefix = `/api/skills/${encodeURIComponent(resolvedSkillId)}/assets/`;
      return `${attr}${openQuote}${prefix}${relPath}${closeQuote}`;
    },
  );
}

function assembleExample(templateHtml, slidesHtml, title) {
  return templateHtml
    .replace('<!-- SLIDES_HERE -->', slidesHtml)
    .replace(/<title>.*?<\/title>/, `<title>${title} | Open Design Example</title>`);
}

export function registerToolsRoutes(app: Express, ctx: ToolsRouteContext) {
  const {
    db,
    sendApiError,
    sendMulterError,
    createSseResponse,
    isLocalSameOrigin,
    resolvedPort,
    getProject,
    updateProject,
    insertTemplate,
    getTemplate,
    deleteTemplate,
    listTemplates,
    PROJECT_ROOT,
    PROJECTS_DIR,
    SKILLS_DIR,
    DESIGN_SYSTEMS_DIR,
    CRAFT_DIR,
    PROMPT_TEMPLATES_DIR,
    BUNDLED_PETS_DIR,
    ARTIFACTS_DIR,
    UPLOAD_DIR,
    RUNTIME_DATA_DIR,
    orbitService,
    desktopPdfExporter,
    daemonUrl,
    upload,
    handleProjectUpload,
    getLiveMediaTask,
    createMediaTask,
    persistMediaTask,
    appendTaskProgress,
    notifyTaskWaiters,
    mediaTaskSnapshot,
    MEDIA_TERMINAL_STATUSES,
    activeProjectEventSinks,
    authorizeToolRequest,
    requestProjectOverride,
    requestRunOverride,
    emitLiveArtifactEvent,
    emitLiveArtifactRefreshEvent,
    emitProjectLiveArtifactEvent,
    mcpPendingAuth,
    getPublicBaseUrl,
    refreshAndPersistToken,
    renderOAuthResultPage,
    openNativeFolderDialog,
    projectMetadataLookup,
  } = ctx;

  // ---- Templates ------------------------------------------------------------

  app.get('/api/templates', (_req, res) => {
    res.json({ templates: listTemplates(db) });
  });

  app.get('/api/templates/:id', (req, res) => {
    const t = getTemplate(db, req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    res.json({ template: t });
  });

  app.post('/api/templates', async (req, res) => {
    try {
      const { name, description, sourceProjectId } = req.body || {};
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name required' });
      }
      if (typeof sourceProjectId !== 'string') {
        return res.status(400).json({ error: 'sourceProjectId required' });
      }
      const sourceProject = getProject(db, sourceProjectId);
      if (!sourceProject) {
        return res.status(404).json({ error: 'source project not found' });
      }
      const files = await listFiles(PROJECTS_DIR, sourceProjectId, { metadata: sourceProject.metadata });
      const snapshot = [];
      for (const f of files) {
        if (f.kind !== 'html' && f.kind !== 'text' && f.kind !== 'code') continue;
        const entry = await readProjectFile(PROJECTS_DIR, sourceProjectId, f.name, sourceProject.metadata);
        if (entry && Buffer.isBuffer(entry.buffer)) {
          snapshot.push({ name: f.name, content: entry.buffer.toString('utf8') });
        }
      }
      const t = insertTemplate(db, {
        id: randomUUID(),
        name: name.trim(),
        description: typeof description === 'string' ? description : null,
        sourceProjectId,
        files: snapshot,
        createdAt: Date.now(),
      });
      res.json({ template: t });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.delete('/api/templates/:id', (req, res) => {
    deleteTemplate(db, req.params.id);
    res.json({ ok: true });
  });

  // ---- Agents ---------------------------------------------------------------

  app.get('/api/agents', async (_req, res) => {
    try {
      const config = await readAppConfig(RUNTIME_DATA_DIR);
      const { detectAgents } = await import('../agents.js');
      const list = await detectAgents(config.agentCliEnv ?? {});
      res.json({ agents: list });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ---- Skills ---------------------------------------------------------------

  app.get('/api/skills', async (_req, res) => {
    try {
      const skills = await listSkills(SKILLS_DIR);
      res.json({
        skills: skills.map(({ body, dir: _dir, ...rest }) => ({
          ...rest,
          hasBody: typeof body === 'string' && body.length > 0,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/skills/:id', async (req, res) => {
    try {
      const skills = await listSkills(SKILLS_DIR);
      const skill = findSkillById(skills, req.params.id);
      if (!skill) return res.status(404).json({ error: 'skill not found' });
      const { dir: _dir, ...serializable } = skill;
      res.json(serializable);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/skills/:id/example', async (req, res) => {
    try {
      const skills = await listSkills(SKILLS_DIR);
      const derived = splitDerivedSkillId(req.params.id);
      if (derived) {
        const parent = findSkillById(skills, derived.parentId);
        if (!parent) return res.status(404).type('text/plain').send('skill not found');
        const candidate = path.join(parent.dir, 'examples', `${derived.childKey}.html`);
        if (fs.existsSync(candidate)) {
          const html = await fs.promises.readFile(candidate, 'utf8');
          return res.type('text/html').send(rewriteSkillAssetUrls(html, parent.id));
        }
        return res.status(404).type('text/plain').send('derived example not found');
      }
      const skill = findSkillById(skills, req.params.id);
      if (!skill) return res.status(404).type('text/plain').send('skill not found');
      const baked = path.join(skill.dir, 'example.html');
      if (fs.existsSync(baked)) {
        const html = await fs.promises.readFile(baked, 'utf8');
        return res.type('text/html').send(rewriteSkillAssetUrls(html, skill.id));
      }
      const tpl = path.join(skill.dir, 'assets', 'template.html');
      const slides = path.join(skill.dir, 'assets', 'example-slides.html');
      if (fs.existsSync(tpl) && fs.existsSync(slides)) {
        try {
          const tplHtml = await fs.promises.readFile(tpl, 'utf8');
          const slidesHtml = await fs.promises.readFile(slides, 'utf8');
          const assembled = assembleExample(tplHtml, slidesHtml, skill.name);
          return res.type('text/html').send(rewriteSkillAssetUrls(assembled, skill.id));
        } catch { /* fall through */ }
      }
      if (fs.existsSync(tpl)) {
        const html = await fs.promises.readFile(tpl, 'utf8');
        return res.type('text/html').send(rewriteSkillAssetUrls(html, skill.id));
      }
      const idx = path.join(skill.dir, 'assets', 'index.html');
      if (fs.existsSync(idx)) {
        const html = await fs.promises.readFile(idx, 'utf8');
        return res.type('text/html').send(rewriteSkillAssetUrls(html, skill.id));
      }
      const examplesDir = path.join(skill.dir, 'examples');
      if (fs.existsSync(examplesDir)) {
        let entries = [];
        try { entries = await fs.promises.readdir(examplesDir); } catch { entries = []; }
        entries.sort();
        for (const name of entries) {
          if (name.startsWith('.') || !name.toLowerCase().endsWith('.html')) continue;
          try {
            const html = await fs.promises.readFile(path.join(examplesDir, name), 'utf8');
            return res.type('text/html').send(rewriteSkillAssetUrls(html, skill.id));
          } catch { continue; }
        }
      }
      res.status(404).type('text/plain').send('no example for this skill');
    } catch (err) {
      res.status(500).type('text/plain').send(String(err));
    }
  });

  app.get('/api/skills/:id/assets/*', async (req, res) => {
    try {
      const skills = await listSkills(SKILLS_DIR);
      const skill = findSkillById(skills, req.params.id);
      if (!skill) return res.status(404).type('text/plain').send('skill not found');
      const relPath = String(req.params[0] || '');
      const assetsRoot = path.resolve(skill.dir, 'assets');
      const target = path.resolve(assetsRoot, relPath);
      if (target !== assetsRoot && !target.startsWith(assetsRoot + path.sep)) {
        return res.status(400).type('text/plain').send('invalid asset path');
      }
      if (!fs.existsSync(target)) return res.status(404).type('text/plain').send('asset not found');
      if (req.headers.origin === 'null') res.header('Access-Control-Allow-Origin', '*');
      const ext = path.extname(target).toLowerCase();
      const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript' };
      res.type(mimeMap[ext] || 'application/octet-stream').sendFile(target);
    } catch (err) {
      res.status(500).type('text/plain').send(String(err));
    }
  });

  // ---- Codex Pets -----------------------------------------------------------

  app.get('/api/codex-pets', async (_req, res) => {
    try {
      const result = await listCodexPets({ baseUrl: '', bundledRoot: BUNDLED_PETS_DIR });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/codex-pets/sync', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const sourceRaw = typeof body.source === 'string' ? body.source : 'all';
      const source = sourceRaw === 'petshare' || sourceRaw === 'hatchery' ? sourceRaw : 'all';
      const result = await syncCommunityPets({ source, force: Boolean(body.force) });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String((err && err.message) || err) });
    }
  });

  app.get('/api/codex-pets/:id/spritesheet', async (req, res) => {
    try {
      const sheet = await readCodexPetSpritesheet(req.params.id, { bundledRoot: BUNDLED_PETS_DIR });
      if (!sheet) return res.status(404).type('text/plain').send('not found');
      const mime = sheet.ext === 'webp' ? 'image/webp' : sheet.ext === 'gif' ? 'image/gif' : 'image/png';
      res.type(mime);
      if (req.headers.origin === 'null') res.setHeader('Access-Control-Allow-Origin', 'null');
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(sheet.absPath);
    } catch (err) {
      res.status(500).type('text/plain').send(String(err));
    }
  });

  // ---- Design Systems -------------------------------------------------------

  app.get('/api/design-systems', async (_req, res) => {
    try {
      const systems = await listDesignSystems(DESIGN_SYSTEMS_DIR);
      res.json({ designSystems: systems.map(({ body, ...rest }) => rest) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/design-systems/:id', async (req, res) => {
    try {
      const body = await readDesignSystem(DESIGN_SYSTEMS_DIR, req.params.id);
      if (body === null) return res.status(404).json({ error: 'not found' });
      res.json({ id: req.params.id, body });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/design-systems/:id/preview', async (req, res) => {
    try {
      const body = await readDesignSystem(DESIGN_SYSTEMS_DIR, req.params.id);
      if (body === null) return res.status(404).type('text/plain').send('not found');
      const html = renderDesignSystemPreview(req.params.id, body);
      res.type('text/html').send(html);
    } catch (err) {
      res.status(500).type('text/plain').send(String(err));
    }
  });

  app.get('/api/design-systems/:id/showcase', async (req, res) => {
    try {
      const body = await readDesignSystem(DESIGN_SYSTEMS_DIR, req.params.id);
      if (body === null) return res.status(404).type('text/plain').send('not found');
      const html = renderDesignSystemShowcase(req.params.id, body);
      res.type('text/html').send(html);
    } catch (err) {
      res.status(500).type('text/plain').send(String(err));
    }
  });

  // ---- Prompt Templates -----------------------------------------------------

  app.get('/api/prompt-templates', async (_req, res) => {
    try {
      const templates = await listPromptTemplates(PROMPT_TEMPLATES_DIR);
      res.json({ promptTemplates: templates.map(({ prompt: _prompt, ...rest }) => rest) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/prompt-templates/:surface/:id', async (req, res) => {
    try {
      const tpl = await readPromptTemplate(PROMPT_TEMPLATES_DIR, req.params.surface, req.params.id);
      if (!tpl) return res.status(404).json({ error: 'not found' });
      res.json({ promptTemplate: tpl });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ---- Upload ---------------------------------------------------------------

  app.post('/api/upload', upload.array('images', 8), (req, res) => {
    const files = (req.files || []).map((f) => ({ name: f.originalname, path: f.path, size: f.size }));
    res.json({ files });
  });

  // ---- Artifacts ------------------------------------------------------------

  app.post('/api/artifacts/save', (req, res) => {
    try {
      const { identifier, title, html } = req.body || {};
      if (typeof html !== 'string' || html.length === 0) {
        return res.status(400).json({ error: 'html required' });
      }
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const slug = sanitizeSlug(identifier || title || 'artifact');
      const dir = path.join(ARTIFACTS_DIR, `${stamp}-${slug}`);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'index.html');
      fs.writeFileSync(file, html, 'utf8');
      const findings = lintArtifact(html);
      res.json({ path: file, url: `/artifacts/${path.basename(dir)}/index.html`, lint: findings });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/artifacts/lint', (req, res) => {
    try {
      const { html } = req.body || {};
      if (typeof html !== 'string' || html.length === 0) {
        return res.status(400).json({ error: 'html required' });
      }
      const findings = lintArtifact(html);
      res.json({ findings, agentMessage: renderFindingsForAgent(findings) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ---- Live Artifacts -------------------------------------------------------

  app.get('/api/live-artifacts', async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      if (!projectId) return sendApiError(res, 400, 'BAD_REQUEST', 'projectId required');
      const artifacts = await listLiveArtifacts({ projectsRoot: PROJECTS_DIR, projectId });
      res.json({ artifacts });
    } catch (err) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.get('/api/live-artifacts/:artifactId', async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      if (!projectId) return sendApiError(res, 400, 'BAD_REQUEST', 'projectId required');
      const record = await getLiveArtifact({ projectsRoot: PROJECTS_DIR, projectId, artifactId: req.params.artifactId });
      res.json({ artifact: record.artifact });
    } catch (err) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.get('/api/live-artifacts/:artifactId/refreshes', async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      if (!projectId) return sendApiError(res, 400, 'BAD_REQUEST', 'projectId required');
      const refreshes = await listLiveArtifactRefreshLogEntries({ projectsRoot: PROJECTS_DIR, projectId, artifactId: req.params.artifactId });
      res.json({ refreshes });
    } catch (err) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.patch('/api/live-artifacts/:artifactId', async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      if (!projectId) return sendApiError(res, 400, 'BAD_REQUEST', 'projectId required');
      const record = await updateLiveArtifact({ projectsRoot: PROJECTS_DIR, projectId, artifactId: req.params.artifactId, input: req.body ?? {} });
      emitProjectLiveArtifactEvent(projectId, { type: 'live_artifact', action: 'updated', projectId, artifactId: record.artifact.id });
      res.json({ artifact: record.artifact });
    } catch (err) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.delete('/api/live-artifacts/:artifactId', async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      if (!projectId) return sendApiError(res, 400, 'BAD_REQUEST', 'projectId required');
      const existing = await getLiveArtifact({ projectsRoot: PROJECTS_DIR, projectId, artifactId: req.params.artifactId });
      await deleteLiveArtifact({ projectsRoot: PROJECTS_DIR, projectId, artifactId: req.params.artifactId });
      updateProject(db, projectId, {});
      emitProjectLiveArtifactEvent(projectId, { type: 'live_artifact', action: 'deleted', projectId, artifactId: existing.artifact.id });
      res.json({ ok: true });
    } catch (err) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  // ---- App Config -----------------------------------------------------------

  app.get('/api/app-config', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    try {
      const config = await readAppConfig(RUNTIME_DATA_DIR);
      res.json({ config });
    } catch (err) {
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.put('/api/app-config', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    try {
      const config = await writeAppConfig(RUNTIME_DATA_DIR, req.body);
      orbitService.configure(config.orbit);
      res.json({ config });
    } catch (err) {
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  // ---- Orbit ----------------------------------------------------------------

  app.get('/api/orbit/status', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    try { res.json(await orbitService.status()); } catch (err) { res.status(500).json({ error: String(err && err.message ? err.message : err) }); }
  });

  app.post('/api/orbit/run', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    try { res.json(await orbitService.start('manual')); } catch (err) { res.status(500).json({ error: String(err && err.message ? err.message : err) }); }
  });

  // ---- Dialog ---------------------------------------------------------------

  app.post('/api/dialog/open-folder', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    try { res.json({ path: await openNativeFolderDialog() }); } catch (err) { res.status(500).json({ error: String(err && err.message ? err.message : err) }); }
  });

  // ---- Media ----------------------------------------------------------------

  app.get('/api/media/models', (_req, res) => {
    res.json({
      providers: MEDIA_PROVIDERS, image: IMAGE_MODELS, video: VIDEO_MODELS,
      audio: AUDIO_MODELS_BY_KIND, aspects: MEDIA_ASPECTS,
      videoLengthsSec: VIDEO_LENGTHS_SEC, audioDurationsSec: AUDIO_DURATIONS_SEC,
    });
  });

  app.get('/api/media/config', async (_req, res) => {
    try { res.json(await readMaskedConfig(PROJECT_ROOT)); } catch (err) { res.status(500).json({ error: String(err && err.message ? err.message : err) }); }
  });

  app.put('/api/media/config', async (req, res) => {
    try { res.json(await writeConfig(PROJECT_ROOT, req.body)); } catch (err) { res.status(typeof err?.status === 'number' ? err.status : 400).json({ error: String(err && err.message ? err.message : err) }); }
  });

  app.post('/api/projects/:id/media/generate', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    try {
      const projectId = req.params.id;
      const project = getProject(db, projectId);
      if (!project) return res.status(404).json({ error: 'project not found' });
      const taskId = randomUUID();
      const task = createMediaTask(db, taskId, projectId, { surface: req.body?.surface, model: req.body?.model });
      task.status = 'running';
      persistMediaTask(db, task);
      generateMedia({
        projectRoot: PROJECT_ROOT, projectsRoot: PROJECTS_DIR, projectId,
        surface: req.body?.surface, model: req.body?.model, prompt: req.body?.prompt,
        output: req.body?.output, aspect: req.body?.aspect,
        length: typeof req.body?.length === 'number' ? req.body.length : undefined,
        duration: typeof req.body?.duration === 'number' ? req.body.duration : undefined,
        voice: req.body?.voice, audioKind: req.body?.audioKind,
        language: typeof req.body?.language === 'string' ? req.body.language : undefined,
        compositionDir: req.body?.compositionDir, image: req.body?.image,
        onProgress: (line) => appendTaskProgress(db, task, line),
      })
        .then((meta) => { task.status = 'done'; task.file = meta; task.endedAt = Date.now(); persistMediaTask(db, task); notifyTaskWaiters(db, task); })
        .catch((err) => { task.status = 'failed'; task.error = { message: String(err?.message || err), status: typeof err?.status === 'number' ? err.status : 400, code: err?.code }; task.endedAt = Date.now(); persistMediaTask(db, task); notifyTaskWaiters(db, task); });
      res.status(202).json({ taskId, status: task.status, startedAt: task.startedAt });
    } catch (err) {
      res.status(typeof err?.status === 'number' ? err.status : 400).json({ error: String(err?.message || err) });
    }
  });

  app.post('/api/media/tasks/:id/wait', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    const task = getLiveMediaTask(db, req.params.id);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const since = Number.isFinite(req.body?.since) ? Number(req.body.since) : 0;
    const timeoutMs = Math.min(Math.max(Number.isFinite(req.body?.timeoutMs) ? Number(req.body.timeoutMs) : 25000, 0), 25000);
    const respond = () => { if (!res.writableEnded) res.json(mediaTaskSnapshot(task, since)); };
    if (MEDIA_TERMINAL_STATUSES.has(task.status) || task.progress.length > since) return respond();
    let done = false;
    const wake = () => { if (done) return; done = true; task.waiters.delete(wake); clearTimeout(timer); respond(); };
    task.waiters.add(wake);
    const timer = setTimeout(wake, timeoutMs);
    res.on('close', wake);
  });

  app.get('/api/projects/:id/media/tasks', (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    const includeDone = req.query.includeDone === '1' || req.query.includeDone === 'true';
    const tasks = listMediaTasksByProject(db, req.params.id, { includeTerminal: includeDone }).map((t) => ({
      taskId: t.id, status: t.status, startedAt: t.startedAt, endedAt: t.endedAt,
      elapsed: Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000),
      surface: t.surface, model: t.model, progress: t.progress.slice(-3), progressCount: t.progress.length,
      ...(t.status === 'done' ? { file: t.file } : {}),
      ...(t.status === 'failed' || t.status === 'interrupted' ? { error: t.error } : {}),
    }));
    tasks.sort((a, b) => b.startedAt - a.startedAt);
    res.json({ tasks });
  });

  // ---- Research -------------------------------------------------------------

  app.post('/api/research/search', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    try {
      const result = await searchResearch({ projectRoot: PROJECT_ROOT, query: req.body?.query, maxSources: typeof req.body?.maxSources === 'number' ? req.body.maxSources : undefined, providers: Array.isArray(req.body?.providers) ? req.body.providers : undefined });
      res.json(result);
    } catch (err) {
      if (err instanceof ResearchError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
      res.status(500).json({ error: { code: 'RESEARCH_FAILED', message: String(err?.message || err) } });
    }
  });

  // ---- Connectors -----------------------------------------------------------

  registerConnectorRoutes(app, { sendApiError, authorizeToolRequest, projectsRoot: PROJECTS_DIR, requireLocalDaemonRequest: ctx.requireLocalDaemonRequest });

  app.get('/api/connectors/composio/config', (_req, res) => {
    try { res.json(readPublicComposioConfig()); } catch (err) { res.status(500).json({ error: String(err?.message || err) }); }
  });

  app.put('/api/connectors/composio/config', ctx.requireLocalDaemonRequest, (req, res) => {
    try {
      const before = readComposioConfig();
      const cfg = writeComposioConfig(req.body);
      const after = readComposioConfig();
      composioConnectorProvider.clearDiscoveryCache();
      if (!cfg.configured || (before.apiKey && before.apiKey !== after.apiKey)) deleteConnectorCredentialsByProvider('composio');
      res.json(cfg);
    } catch (err) { res.status(400).json({ error: String(err?.message || err) }); }
  });

  // ---- MCP ------------------------------------------------------------------

  app.get('/api/mcp/install-info', (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    try {
      const payload = buildMcpInstallPayload({
        cliPath: ctx.OD_BIN, cliExists: fs.existsSync(ctx.OD_BIN),
        execPath: process.execPath, nodeExists: fs.existsSync(process.execPath),
        port: resolvedPort(), platform: process.platform, dataDir: RUNTIME_DATA_DIR,
        electronAsNode: process.env.ELECTRON_RUN_AS_NODE === '1',
        isSidecarMode: false, sidecarEnv: {},
      });
      res.json(payload);
    } catch (err) { res.status(500).json({ error: String(err?.message || err) }); }
  });

  app.get('/api/mcp/servers', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    try {
      const cfg = await readMcpConfig(RUNTIME_DATA_DIR);
      res.json({ servers: cfg.servers, templates: MCP_TEMPLATES });
    } catch (err) { res.status(500).json({ error: String(err?.message || err) }); }
  });

  app.put('/api/mcp/servers', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    try {
      const cfg = await writeMcpConfig(RUNTIME_DATA_DIR, req.body);
      res.json({ servers: cfg.servers, templates: MCP_TEMPLATES });
    } catch (err) { res.status(400).json({ error: String(err?.message || err) }); }
  });

  // ---- MCP OAuth ------------------------------------------------------------

  app.post('/api/mcp/oauth/start', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    const serverId = typeof req.body?.serverId === 'string' ? req.body.serverId.trim() : '';
    if (!serverId) return res.status(400).json({ error: 'serverId is required' });
    try {
      const cfg = await readMcpConfig(RUNTIME_DATA_DIR);
      const server = cfg.servers.find((s) => s.id === serverId);
      if (!server) return res.status(404).json({ error: 'unknown serverId' });
      if (server.transport !== 'http' && server.transport !== 'sse') return res.status(400).json({ error: 'OAuth only for http/sse' });
      if (!server.url) return res.status(400).json({ error: 'server has no URL' });
      const redirectUri = `${getPublicBaseUrl(req)}/api/mcp/oauth/callback`;
      const result = await beginAuth({ serverId, serverUrl: server.url, redirectUri, dataDir: RUNTIME_DATA_DIR, fetchImpl: fetch });
      mcpPendingAuth.put(result.state, result.pending);
      res.json({ authorizeUrl: result.authorizeUrl, state: result.state, redirectUri });
    } catch (err) { res.status(502).json({ error: err?.message || String(err) }); }
  });

  app.get('/api/mcp/oauth/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const error = typeof req.query.error === 'string' ? req.query.error : '';
    if (error) return res.status(400).type('html').send(renderOAuthResultPage({ ok: false, message: `Auth error: ${error}` }));
    if (!code || !state) return res.status(400).type('html').send(renderOAuthResultPage({ ok: false, message: 'Missing code or state' }));
    const pending = mcpPendingAuth.consume(state);
    if (!pending) return res.status(400).type('html').send(renderOAuthResultPage({ ok: false, message: 'State expired or already used' }));
    try {
      const tokenResp = await exchangeCodeForToken({ tokenEndpoint: pending.tokenEndpoint, clientId: pending.clientId, clientSecret: pending.clientSecret, redirectUri: pending.redirectUri, code, codeVerifier: pending.codeVerifier, resource: pending.resourceUrl });
      const stored = {
        accessToken: tokenResp.access_token, refreshToken: tokenResp.refresh_token,
        tokenType: tokenResp.token_type ?? 'Bearer', scope: tokenResp.scope ?? pending.scope,
        expiresAt: typeof tokenResp.expires_in === 'number' ? Date.now() + tokenResp.expires_in * 1000 : undefined,
        savedAt: Date.now(), tokenEndpoint: pending.tokenEndpoint, clientId: pending.clientId,
        clientSecret: pending.clientSecret, authServerIssuer: pending.authServerIssuer,
        redirectUri: pending.redirectUri, resourceUrl: pending.resourceUrl,
      };
      await setToken(RUNTIME_DATA_DIR, pending.serverId, stored);
      res.type('html').send(renderOAuthResultPage({ ok: true, serverId: pending.serverId }));
    } catch (err) { res.status(502).type('html').send(renderOAuthResultPage({ ok: false, message: String(err?.message || err) })); }
  });

  app.get('/api/mcp/oauth/status', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    const serverId = typeof req.query.serverId === 'string' ? req.query.serverId.trim() : '';
    if (!serverId) return res.status(400).json({ error: 'serverId is required' });
    try {
      const tok = await getToken(RUNTIME_DATA_DIR, serverId);
      if (!tok) return res.json({ connected: false });
      res.json({ connected: true, expiresAt: tok.expiresAt ?? null, scope: tok.scope ?? null, savedAt: tok.savedAt });
    } catch (err) { res.status(500).json({ error: String(err?.message || err) }); }
  });

  app.post('/api/mcp/oauth/disconnect', async (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    const serverId = typeof req.body?.serverId === 'string' ? req.body.serverId.trim() : '';
    if (!serverId) return res.status(400).json({ error: 'serverId is required' });
    try { await clearToken(RUNTIME_DATA_DIR, serverId); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: String(err?.message || err) }); }
  });

  // ---- Active Context -------------------------------------------------------

  app.post('/api/active', (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    try {
      const body = req.body || {};
      if (body.active === false) { ctx.activeContext = null; return res.json({ active: false }); }
      const projectId = typeof body.projectId === 'string' ? body.projectId : '';
      if (!projectId) return sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required');
      const fileName = typeof body.fileName === 'string' && body.fileName.length > 0 ? body.fileName : null;
      ctx.activeContext = { projectId, fileName, ts: Date.now() };
      res.json({ active: true, ...ctx.activeContext });
    } catch (err) { sendApiError(res, 400, 'BAD_REQUEST', String(err)); }
  });

  app.get('/api/active', (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) return res.status(403).json({ error: 'cross-origin request rejected' });
    if (!ctx.activeContext || Date.now() - ctx.activeContext.ts > 300000) { ctx.activeContext = null; return res.json({ active: false }); }
    res.json({ active: true, ...ctx.activeContext });
  });

  // Helper for live artifact route errors
  function sendLiveArtifactRouteError(res, err) {
    if (err instanceof LiveArtifactStoreValidationError) return sendApiError(res, 400, 'LIVE_ARTIFACT_INVALID', err.message, { details: { kind: 'validation', issues: err.issues } });
    if (err instanceof LiveArtifactRefreshLockError) return sendApiError(res, 409, 'REFRESH_LOCKED', err.message, { details: { artifactId: err.artifactId } });
    if (err instanceof LiveArtifactRefreshUnavailableError) return sendApiError(res, 400, 'LIVE_ARTIFACT_REFRESH_UNAVAILABLE', err.message);
    if (err instanceof LiveArtifactRefreshAbortError) return sendApiError(res, err.kind === 'cancelled' ? 499 : 504, 'LIVE_ARTIFACT_REFRESH_TIMEOUT', err.message, { details: { kind: err.kind } });
    if (err instanceof ConnectorServiceError) return sendApiError(res, err.status, err.code, err.message, err.details ? { details: err.details } : {});
    if (err?.code === 'ENOENT') return sendApiError(res, 404, 'LIVE_ARTIFACT_NOT_FOUND', 'not found');
    return sendApiError(res, 500, 'LIVE_ARTIFACT_STORAGE_FAILED', String(err));
  }
}
