// @ts-nocheck
import type { Express, Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  buildProjectArchive,
  buildBatchArchive,
  deleteProjectFile,
  ensureProject,
  isSafeId,
  listFiles,
  readProjectFile,
  removeProjectDir,
  sanitizeName,
  searchProjectFiles,
  writeProjectFile,
} from '../projects.js';
import { validateArtifactManifestInput } from '../artifact-manifest.js';
import { buildDocumentPreview } from '../document-preview.js';
import { subscribe as subscribeFileEvents } from '../project-watchers.js';
import { importClaudeDesignZip } from '../claude-design-import.js';
import { validateLinkedDirs } from '../linked-dirs.js';
import { detectEntryFile } from '../projects.js';
import {
  deleteConversation,
  deletePreviewComment,
  deleteProject as dbDeleteProject,
  deleteTemplate,
  getConversation,
  getDeployment,
  getProject,
  getTemplate,
  insertConversation,
  insertProject,
  insertTemplate,
  listProjectsAwaitingInput,
  listConversations,
  listLatestProjectRunStatuses,
  listMessages,
  listPreviewComments,
  listProjects,
  listTabs,
  listTemplates,
  setTabs,
  updateConversation,
  updatePreviewCommentStatus,
  updateProject,
  upsertMessage,
  upsertPreviewComment,
} from '../db.js';

// Helpers that were defined in the original server.ts — we'll receive them via context.
// These are: sendApiError, sendMulterError, createSseResponse, normalizeProjectDisplayStatus,
// composeProjectDisplayStatus, shouldReportRunCompletedFromMessage, telemetryPromptFromRunRequest,
// reportRunCompletedFromDaemon, readCurrentAppVersionInfo, normalizeCommentAttachments,
// renderCommentAttachmentHint, buildDesktopPdfExportInput, sanitizeArchiveFilename,
// isLocalSameOrigin, randomId

/**
 * Context required by the project routes.
 */
export interface ProjectRouteContext {
  db: any;
  design: any;
  sendApiError: (res: Response, status: number, code: string, message: string, init?: any) => void;
  sendMulterError: (res: Response, err: any) => void;
  createSseResponse: (res: Response, opts?: any) => any;
  normalizeProjectDisplayStatus: (status: any) => string;
  composeProjectDisplayStatus: (status: any, awaitingInputProjects: any, projectId: string) => any;
  shouldReportRunCompletedFromMessage: (saved: any, body?: any) => boolean;
  telemetryPromptFromRunRequest: (message: any, currentPrompt: any) => string | undefined;
  reportRunCompletedFromDaemon: (opts: any) => Promise<void>;
  readCurrentAppVersionInfo: () => Promise<{ version: string }>;
  normalizeCommentAttachments: (input: any) => any[];
  renderCommentAttachmentHint: (attachments: any[]) => string;
  buildDesktopPdfExportInput: (opts: any) => Promise<any>;
  sanitizeArchiveFilename: (raw: any) => string;
  isLocalSameOrigin: (req: Request, port: number) => boolean;
  randomId: () => string;
  PROJECTS_DIR: string;
  PROJECT_ROOT: string;
  RUNTIME_DATA_DIR: string;
  RUNTIME_DATA_DIR_CANONICAL: string;
  UPLOAD_DIR: string;
  ARTIFACTS_DIR: string;
  desktopPdfExporter: ((input: any) => Promise<any>) | null;
  daemonUrl: string;
  resolvedPort: () => number;
  activeProjectEventSinks: Map<string, Set<(payload: any) => void>>;
  reportedRuns: Set<string>;
  cachedAppVersion: any;
  upload: any;
  importUpload: any;
  handleProjectUpload: any;
}

function randomIdFn() {
  return randomUUID();
}

export function registerProjectRoutes(
  app: Express,
  ctx: ProjectRouteContext,
) {
  const {
    db,
    design,
    sendApiError,
    sendMulterError,
    createSseResponse,
    normalizeProjectDisplayStatus,
    composeProjectDisplayStatus,
    shouldReportRunCompletedFromMessage,
    reportRunCompletedFromDaemon,
    readCurrentAppVersionInfo,
    normalizeCommentAttachments,
    renderCommentAttachmentHint,
    buildDesktopPdfExportInput,
    sanitizeArchiveFilename,
    isLocalSameOrigin,
    PROJECTS_DIR,
    PROJECT_ROOT,
    RUNTIME_DATA_DIR,
    RUNTIME_DATA_DIR_CANONICAL,
    UPLOAD_DIR,
    ARTIFACTS_DIR,
    desktopPdfExporter,
    daemonUrl,
    resolvedPort,
    activeProjectEventSinks,
    reportedRuns,
    cachedAppVersion,
    upload,
    importUpload,
    handleProjectUpload,
  } = ctx;

  const randomId = ctx.randomId || randomIdFn;

  // ---- Projects (DB-backed) -------------------------------------------------

  // Soft "what is the user looking at right now in Open Design?" channel.
  let activeContext = null;
  const ACTIVE_CONTEXT_TTL_MS = 5 * 60 * 1000;

  app.post('/api/active', (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const body = req.body || {};
      if (body.active === false) {
        activeContext = null;
        res.json({ active: false });
        return;
      }
      const projectId = typeof body.projectId === 'string' ? body.projectId : '';
      if (!projectId) {
        sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required');
        return;
      }
      const fileName =
        typeof body.fileName === 'string' && body.fileName.length > 0
          ? body.fileName
          : null;
      activeContext = { projectId, fileName, ts: Date.now() };
      res.json({ active: true, ...activeContext });
    } catch (err) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/active', (req, res) => {
    if (!isLocalSameOrigin(req, resolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    if (!activeContext || Date.now() - activeContext.ts > ACTIVE_CONTEXT_TTL_MS) {
      activeContext = null;
      return res.json({ active: false });
    }
    res.json({ active: true, ...activeContext });
  });

  app.get('/api/projects', (_req, res) => {
    try {
      const latestRunStatuses = listLatestProjectRunStatuses(db);
      const awaitingInputProjects = listProjectsAwaitingInput(db);
      const activeRunStatuses = new Map();
      for (const run of design.runs.list()) {
        if (!run.projectId) continue;
        const runStatus = projectStatusFromRun(run);
        if (design.runs.isTerminal(run.status)) {
          const existing = latestRunStatuses.get(run.projectId);
          if (!existing || run.updatedAt > (existing.updatedAt ?? 0)) {
            latestRunStatuses.set(run.projectId, runStatus);
          }
        } else {
          const existing = activeRunStatuses.get(run.projectId);
          if (!existing || run.updatedAt > (existing.updatedAt ?? 0)) {
            activeRunStatuses.set(run.projectId, runStatus);
          }
        }
      }
      /** @type {import('@open-design/contracts').ProjectsResponse} */
      const body = {
        projects: listProjects(db).map((project) => ({
          ...project,
          status: composeProjectDisplayStatus(
            activeRunStatuses.get(project.id) ??
              latestRunStatuses.get(project.id) ?? { value: 'not_started' },
            awaitingInputProjects,
            project.id,
          ),
        })),
      };
      res.json(body);
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });

  function projectStatusFromRun(run) {
    return {
      value: normalizeProjectDisplayStatus(run.status),
      updatedAt: run.updatedAt,
      runId: run.id,
    };
  }

  app.post('/api/projects', async (req, res) => {
    try {
      const { id, name, skillId, designSystemId, pendingPrompt, metadata } =
        req.body || {};
      if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(id)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'invalid project id');
      }
      if (typeof name !== 'string' || !name.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'name required');
      }
      if (metadata && typeof metadata === 'object') {
        if ('baseDir' in metadata) {
          return sendApiError(
            res, 400, 'BAD_REQUEST',
            'baseDir can only be set via POST /api/import/folder',
          );
        }
      }
      const now = Date.now();
      const project = insertProject(db, {
        id,
        name: name.trim(),
        skillId: skillId ?? null,
        designSystemId: designSystemId ?? null,
        pendingPrompt: pendingPrompt || null,
        metadata:
          metadata && typeof metadata === 'object'
            ? {
                ...metadata,
                ...(Array.isArray(metadata.linkedDirs)
                  ? (() => {
                      const v = validateLinkedDirs(metadata.linkedDirs);
                      return v.error ? {} : { linkedDirs: v.dirs };
                    })()
                  : {}),
              }
            : null,
        createdAt: now,
        updatedAt: now,
      });
      const cid = randomId();
      insertConversation(db, {
        id: cid,
        projectId: id,
        title: null,
        createdAt: now,
        updatedAt: now,
      });
      if (
        metadata &&
        typeof metadata === 'object' &&
        metadata.kind === 'template' &&
        typeof metadata.templateId === 'string'
      ) {
        const tpl = getTemplate(db, metadata.templateId);
        if (tpl && Array.isArray(tpl.files) && tpl.files.length > 0) {
          await ensureProject(PROJECTS_DIR, id);
          for (const f of tpl.files) {
            if (
              !f ||
              typeof f.name !== 'string' ||
              typeof f.content !== 'string'
            ) {
              continue;
            }
            try {
              await writeProjectFile(
                PROJECTS_DIR,
                id,
                f.name,
                Buffer.from(f.content, 'utf8'),
              );
            } catch {
              // Skip individual file failures
            }
          }
        }
      }
      /** @type {import('@open-design/contracts').CreateProjectResponse} */
      const body = { project, conversationId: cid };
      res.json(body);
    } catch (err) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.post(
    '/api/import/claude-design',
    importUpload.single('file'),
    async (req, res) => {
      try {
        if (!req.file)
          return res.status(400).json({ error: 'zip file required' });
        const originalName =
          req.file.originalname || 'Claude Design export.zip';
        if (!/\.zip$/i.test(originalName)) {
          fs.promises.unlink(req.file.path).catch(() => {});
          return res.status(400).json({ error: 'expected a .zip file' });
        }
        const id = randomId();
        const now = Date.now();
        const baseName =
          originalName.replace(/\.zip$/i, '').trim() || 'Claude Design import';
        const imported = await importClaudeDesignZip(
          req.file.path,
          (await import('../projects.js')).projectDir(PROJECTS_DIR, id),
        );
        fs.promises.unlink(req.file.path).catch(() => {});

        const project = insertProject(db, {
          id,
          name: baseName,
          skillId: null,
          designSystemId: null,
          pendingPrompt: `Imported from Claude Design ZIP: ${originalName}. Continue editing ${imported.entryFile}.`,
          metadata: {
            kind: 'prototype',
            importedFrom: 'claude-design',
            entryFile: imported.entryFile,
            sourceFileName: originalName,
          },
          createdAt: now,
          updatedAt: now,
        });
        const cid = randomId();
        insertConversation(db, {
          id: cid,
          projectId: id,
          title: 'Imported Claude Design project',
          createdAt: now,
          updatedAt: now,
        });
        setTabs(db, id, [imported.entryFile], imported.entryFile);
        res.json({
          project,
          conversationId: cid,
          entryFile: imported.entryFile,
          files: imported.files,
        });
      } catch (err) {
        if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
        res.status(400).json({ error: String(err) });
      }
    },
  );

  app.post('/api/import/folder', async (req, res) => {
    try {
      const { baseDir, name, skillId, designSystemId } = req.body || {};
      if (typeof baseDir !== 'string' || !baseDir.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'baseDir required');
      }
      const trimmedInput = baseDir.trim();
      if (!path.isAbsolute(path.normalize(trimmedInput))) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'baseDir must be absolute');
      }
      let normalizedPath: string;
      try {
        normalizedPath = await fs.promises.realpath(trimmedInput);
      } catch {
        return sendApiError(res, 400, 'BAD_REQUEST', 'folder not found');
      }
      let dirStat;
      try {
        dirStat = await fs.promises.lstat(normalizedPath);
      } catch {
        return sendApiError(res, 400, 'BAD_REQUEST', 'folder not found');
      }
      if (!dirStat.isDirectory()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'path must be a directory');
      }
      if (
        normalizedPath === RUNTIME_DATA_DIR_CANONICAL ||
        normalizedPath.startsWith(RUNTIME_DATA_DIR_CANONICAL + path.sep)
      ) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'cannot import the data directory');
      }

      const id = randomId();
      const now = Date.now();
      const projectName =
        typeof name === 'string' && name.trim()
          ? name.trim()
          : path.basename(normalizedPath);
      const entryFile = await detectEntryFile(normalizedPath);

      const project = insertProject(db, {
        id,
        name: projectName,
        skillId: skillId ?? null,
        designSystemId: designSystemId ?? null,
        pendingPrompt: null,
        metadata: {
          kind: 'prototype',
          baseDir: normalizedPath,
          importedFrom: 'folder',
          entryFile,
        },
        createdAt: now,
        updatedAt: now,
      });

      const cid = randomId();
      insertConversation(db, {
        id: cid,
        projectId: id,
        title: `Imported from ${projectName}`,
        createdAt: now,
        updatedAt: now,
      });
      if (entryFile) setTabs(db, id, [entryFile], entryFile);
      /** @type {import('@open-design/contracts').ImportFolderResponse} */
      const body = { project, conversationId: cid, entryFile };
      res.json(body);
    } catch (err) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/projects/:id', (req, res) => {
    const project = getProject(db, req.params.id);
    if (!project)
      return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
    /** @type {import('@open-design/contracts').ProjectResponse} */
    const body = { project };
    res.json(body);
  });

  app.patch('/api/projects/:id', (req, res) => {
    try {
      const patch = req.body || {};
      if (patch.metadata && typeof patch.metadata === 'object') {
        const existing = getProject(db, req.params.id);
        const existingMeta = existing?.metadata;
        if (existingMeta?.baseDir) {
          if ('baseDir' in patch.metadata && patch.metadata.baseDir !== existingMeta.baseDir) {
            return sendApiError(
              res, 400, 'BAD_REQUEST',
              'baseDir is immutable after import; use a new import to change it',
            );
          }
          patch.metadata = {
            ...patch.metadata,
            baseDir: existingMeta.baseDir,
            ...(existingMeta.importedFrom === 'folder'
              ? { importedFrom: 'folder' }
              : {}),
          };
        } else if ('baseDir' in patch.metadata) {
          return sendApiError(
            res, 400, 'BAD_REQUEST',
            'baseDir can only be set via POST /api/import/folder',
          );
        }
      }
      if (patch.metadata?.linkedDirs) {
        const validated = validateLinkedDirs(patch.metadata.linkedDirs);
        if (validated.error) {
          return sendApiError(res, 400, 'INVALID_LINKED_DIR', validated.error);
        }
        patch.metadata.linkedDirs = validated.dirs;
      }
      const project = updateProject(db, req.params.id, patch);
      if (!project)
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      /** @type {import('@open-design/contracts').ProjectResponse} */
      const body = { project };
      res.json(body);
    } catch (err) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.delete('/api/projects/:id', async (req, res) => {
    try {
      dbDeleteProject(db, req.params.id);
      await removeProjectDir(PROJECTS_DIR, req.params.id).catch(() => {});
      /** @type {import('@open-design/contracts').OkResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  // SSE stream of file-changed events for a project. Drives preview live-reload.
  app.get('/api/projects/:id/events', (req, res) => {
    if (!getProject(db, req.params.id)) {
      return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
    }
    let sub;
    try {
      const sse = createSseResponse(res);
      const projectEventSink = (payload) => {
        sse.send(payload.type, payload);
      };
      let sinks = activeProjectEventSinks.get(req.params.id);
      if (!sinks) {
        sinks = new Set();
        activeProjectEventSinks.set(req.params.id, sinks);
      }
      sinks.add(projectEventSink);
      const watchProject = getProject(db, req.params.id);
      sub = subscribeFileEvents(PROJECTS_DIR, req.params.id, (evt) => {
        sse.send('file-changed', evt);
      }, { metadata: watchProject?.metadata });
      sub.ready.then(() => sse.send('ready', { projectId: req.params.id })).catch(() => {});
      const cleanup = () => {
        if (sub) {
          const { unsubscribe } = sub;
          sub = null;
          Promise.resolve(unsubscribe()).catch(() => {});
        }
        const currentSinks = activeProjectEventSinks.get(req.params.id);
        currentSinks?.delete(projectEventSink);
        if (currentSinks?.size === 0) activeProjectEventSinks.delete(req.params.id);
      };
      res.on('close', cleanup);
      res.on('finish', cleanup);
    } catch (err) {
      if (sub) Promise.resolve(sub.unsubscribe()).catch(() => {});
      if (!res.headersSent) sendApiError(res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  });

  // ---- Conversations --------------------------------------------------------

  app.get('/api/projects/:id/conversations', (req, res) => {
    if (!getProject(db, req.params.id)) {
      return res.status(404).json({ error: 'project not found' });
    }
    res.json({ conversations: listConversations(db, req.params.id) });
  });

  app.post('/api/projects/:id/conversations', (req, res) => {
    if (!getProject(db, req.params.id)) {
      return res.status(404).json({ error: 'project not found' });
    }
    const { title } = req.body || {};
    const now = Date.now();
    const conv = insertConversation(db, {
      id: randomId(),
      projectId: req.params.id,
      title: typeof title === 'string' ? title.trim() || null : null,
      createdAt: now,
      updatedAt: now,
    });
    res.json({ conversation: conv });
  });

  app.patch('/api/projects/:id/conversations/:cid', (req, res) => {
    const conv = getConversation(db, req.params.cid);
    if (!conv || conv.projectId !== req.params.id) {
      return res.status(404).json({ error: 'not found' });
    }
    const updated = updateConversation(db, req.params.cid, req.body || {});
    res.json({ conversation: updated });
  });

  app.delete('/api/projects/:id/conversations/:cid', (req, res) => {
    const conv = getConversation(db, req.params.cid);
    if (!conv || conv.projectId !== req.params.id) {
      return res.status(404).json({ error: 'not found' });
    }
    deleteConversation(db, req.params.cid);
    res.json({ ok: true });
  });

  // ---- Messages -------------------------------------------------------------

  app.get('/api/projects/:id/conversations/:cid/messages', (req, res) => {
    const conv = getConversation(db, req.params.cid);
    if (!conv || conv.projectId !== req.params.id) {
      return res.status(404).json({ error: 'conversation not found' });
    }
    res.json({ messages: listMessages(db, req.params.cid) });
  });

  app.put('/api/projects/:id/conversations/:cid/messages/:mid', (req, res) => {
    const conv = getConversation(db, req.params.cid);
    if (!conv || conv.projectId !== req.params.id) {
      return res.status(404).json({ error: 'conversation not found' });
    }
    const m = req.body || {};
    if (m.id && m.id !== req.params.mid) {
      return res.status(400).json({ error: 'id mismatch' });
    }
    const saved = upsertMessage(db, req.params.cid, {
      ...m,
      id: req.params.mid,
    });
    updateProject(db, req.params.id, {});
    if (
      shouldReportRunCompletedFromMessage(saved, m) &&
      !reportedRuns.has(saved.runId)
    ) {
      const run = design.runs.get(saved.runId);
      if (run) {
        reportedRuns.add(saved.runId);
        setTimeout(() => reportedRuns.delete(saved.runId), 30 * 60 * 1000).unref?.();
        void reportRunCompletedFromDaemon({
          db,
          dataDir: RUNTIME_DATA_DIR,
          run,
          persistedRunStatus: saved.runStatus,
          persistedEndedAt:
            typeof saved.endedAt === 'number' ? saved.endedAt : undefined,
          appVersion: cachedAppVersion,
        });
      }
    }
    res.json({ message: saved });
  });

  // ---- Preview comments ----------------------------------------------------

  app.get('/api/projects/:id/conversations/:cid/comments', (req, res) => {
    const conv = getConversation(db, req.params.cid);
    if (!conv || conv.projectId !== req.params.id) {
      return res.status(404).json({ error: 'conversation not found' });
    }
    res.json({
      comments: listPreviewComments(db, req.params.id, req.params.cid),
    });
  });

  app.post('/api/projects/:id/conversations/:cid/comments', (req, res) => {
    const conv = getConversation(db, req.params.cid);
    if (!conv || conv.projectId !== req.params.id) {
      return res.status(404).json({ error: 'conversation not found' });
    }
    try {
      const comment = upsertPreviewComment(
        db,
        req.params.id,
        req.params.cid,
        req.body || {},
      );
      updateProject(db, req.params.id, {});
      res.json({ comment });
    } catch (err) {
      res.status(400).json({ error: String(err?.message || err) });
    }
  });

  app.patch(
    '/api/projects/:id/conversations/:cid/comments/:commentId',
    (req, res) => {
      const conv = getConversation(db, req.params.cid);
      if (!conv || conv.projectId !== req.params.id) {
        return res.status(404).json({ error: 'conversation not found' });
      }
      try {
        const comment = updatePreviewCommentStatus(
          db,
          req.params.id,
          req.params.cid,
          req.params.commentId,
          req.body?.status,
        );
        if (!comment)
          return res.status(404).json({ error: 'comment not found' });
        updateProject(db, req.params.id, {});
        res.json({ comment });
      } catch (err) {
        res.status(400).json({ error: String(err?.message || err) });
      }
    },
  );

  app.delete(
    '/api/projects/:id/conversations/:cid/comments/:commentId',
    (req, res) => {
      const conv = getConversation(db, req.params.cid);
      if (!conv || conv.projectId !== req.params.id) {
        return res.status(404).json({ error: 'conversation not found' });
      }
      const ok = deletePreviewComment(
        db,
        req.params.id,
        req.params.cid,
        req.params.commentId,
      );
      if (!ok) return res.status(404).json({ error: 'comment not found' });
      updateProject(db, req.params.id, {});
      res.json({ ok: true });
    },
  );

  // ---- Tabs -----------------------------------------------------------------

  app.get('/api/projects/:id/tabs', (req, res) => {
    if (!getProject(db, req.params.id)) {
      return res.status(404).json({ error: 'project not found' });
    }
    res.json(listTabs(db, req.params.id));
  });

  app.put('/api/projects/:id/tabs', (req, res) => {
    if (!getProject(db, req.params.id)) {
      return res.status(404).json({ error: 'project not found' });
    }
    const { tabs = [], active = null } = req.body || {};
    if (!Array.isArray(tabs) || !tabs.every((t) => typeof t === 'string')) {
      return res.status(400).json({ error: 'tabs must be string[]' });
    }
    const result = setTabs(
      db,
      req.params.id,
      tabs,
      typeof active === 'string' ? active : null,
    );
    res.json(result);
  });

  // ---- Project files --------------------------------------------------------

  // Project-scoped multi-file upload
  app.post(
    '/api/projects/:id/upload',
    handleProjectUpload,
    async (req, res) => {
      try {
        const incoming = Array.isArray(req.files) ? req.files : [];
        const out = [];
        for (const f of incoming) {
          try {
            const stat = await fs.promises.stat(f.path);
            out.push({
              name: f.filename,
              path: f.filename,
              size: stat.size,
              mtime: stat.mtimeMs,
              originalName: f.originalname,
            });
          } catch {
            // skip files that vanished mid-flight
          }
        }
        /** @type {import('@open-design/contracts').UploadProjectFilesResponse} */
        const body = { files: out };
        res.json(body);
      } catch (err) {
        sendApiError(res, 500, 'INTERNAL_ERROR', 'upload failed');
      }
    },
  );

  app.get('/api/projects/:id/files', async (req, res) => {
    try {
      const since = Number(req.query?.since);
      const project = getProject(db, req.params.id);
      const files = await listFiles(PROJECTS_DIR, req.params.id, {
        since: Number.isFinite(since) ? since : undefined,
        metadata: project?.metadata,
      });
      /** @type {import('@open-design/contracts').ProjectFilesResponse} */
      const body = { files };
      res.json(body);
    } catch (err) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/projects/:id/search', async (req, res) => {
    try {
      const query = String(req.query.q ?? '');
      if (!query) {
        sendApiError(res, 400, 'BAD_REQUEST', 'q query parameter is required');
        return;
      }
      const pattern = req.query.pattern ? String(req.query.pattern) : null;
      const max = Math.min(Number(req.query.max) || 200, 1000);
      const searchProject = getProject(db, req.params.id);
      const matches = await searchProjectFiles(PROJECTS_DIR, req.params.id, query, {
        pattern,
        max,
        metadata: searchProject?.metadata,
      });
      res.json({ query, matches });
    } catch (err) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/projects/:id/archive', async (req, res) => {
    try {
      const root = typeof req.query?.root === 'string' ? req.query.root : '';
      const project = getProject(db, req.params.id);
      const { buffer, baseName } = await buildProjectArchive(
        PROJECTS_DIR,
        req.params.id,
        root,
        project?.metadata,
      );
      const fallbackName = project?.name || req.params.id;
      const fileSlug = sanitizeArchiveFilename(baseName || fallbackName) || 'project';
      const filename = `${fileSlug}.zip`;
      const asciiFallback =
        filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_') || 'project.zip';
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      res.send(buffer);
    } catch (err) {
      const code = err && err.code;
      const status = code === 'ENOENT' || code === 'ENOTDIR' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err?.message || err),
      );
    }
  });

  app.post('/api/projects/:id/archive/batch', async (req, res) => {
    try {
      const { files } = req.body || {};
      if (!Array.isArray(files) || files.length === 0) {
        sendApiError(res, 400, 'BAD_REQUEST', 'files must be a non-empty array');
        return;
      }
      const project = getProject(db, req.params.id);
      const { buffer } = await buildBatchArchive(
        PROJECTS_DIR,
        req.params.id,
        files,
        project?.metadata,
      );
      const fileSlug = sanitizeArchiveFilename(project?.name || req.params.id) || 'project';
      const filename = `${fileSlug}.zip`;
      const asciiFallback =
        filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_') || 'project.zip';
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      res.send(buffer);
    } catch (err) {
      const code = err && err.code;
      const status = code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err?.message || err),
      );
    }
  });

  app.options('/api/projects/:id/raw/*', (req, res) => {
    if (req.headers.origin === 'null') {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
    }
    res.sendStatus(204);
  });

  app.get('/api/projects/:id/raw/*', async (req, res) => {
    try {
      const relPath = req.params[0];
      const project = getProject(db, req.params.id);
      const file = await readProjectFile(PROJECTS_DIR, req.params.id, relPath, project?.metadata);
      if (req.headers.origin === 'null') {
        res.header('Access-Control-Allow-Origin', '*');
      }
      res.type(file.mime).send(file.buffer);
    } catch (err) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  app.post('/api/projects/:id/export/pdf', async (req, res) => {
    if (typeof desktopPdfExporter !== 'function') {
      return sendApiError(
        res,
        501,
        'UPSTREAM_UNAVAILABLE',
        'desktop PDF export is only available in the desktop runtime',
      );
    }
    try {
      const { fileName, title, deck } = req.body || {};
      if (typeof fileName !== 'string' || fileName.length === 0) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'fileName required');
      }
      const input = await buildDesktopPdfExportInput({
        daemonUrl,
        deck: deck === true,
        fileName,
        projectId: req.params.id,
        projectsRoot: PROJECTS_DIR,
        title: typeof title === 'string' ? title : undefined,
      });
      const result = await desktopPdfExporter(input);
      res.json(result);
    } catch (err) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err?.message || err),
      );
    }
  });

  app.delete('/api/projects/:id/raw/*', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      await deleteProjectFile(PROJECTS_DIR, req.params.id, req.params[0], project?.metadata);
      /** @type {import('@open-design/contracts').DeleteProjectFileResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  app.get('/api/projects/:id/files/:name/preview', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      const file = await readProjectFile(
        PROJECTS_DIR,
        req.params.id,
        req.params.name,
        project?.metadata,
      );
      const preview = await buildDocumentPreview(file);
      res.json(preview);
    } catch (err) {
      const status =
        err && err.statusCode
          ? err.statusCode
          : err && err.code === 'ENOENT'
            ? 404
            : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        err?.message || 'preview unavailable',
      );
    }
  });

  app.get('/api/projects/:id/files/*', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      const file = await readProjectFile(
        PROJECTS_DIR,
        req.params.id,
        req.params[0],
        project?.metadata,
      );
      res.type(file.mime).send(file.buffer);
    } catch (err) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  // Two ways to upload: multipart for binary files (images), and JSON
  // {name, content, encoding} for sketches and pasted text.
  app.post(
    '/api/projects/:id/files',
    (req, res, next) => {
      upload.single('file')(req, res, (err) => {
        if (err) return sendMulterError(res, err);
        next();
      });
    },
    async (req, res) => {
      try {
        const uploadProject = getProject(db, req.params.id);
        await ensureProject(PROJECTS_DIR, req.params.id, uploadProject?.metadata);
        if (req.file) {
          const buf = await fs.promises.readFile(req.file.path);
          const desiredName = sanitizeName(
            req.body?.name || req.file.originalname,
          );
          const meta = await writeProjectFile(
            PROJECTS_DIR,
            req.params.id,
            desiredName,
            buf,
            {},
            uploadProject?.metadata,
          );
          fs.promises.unlink(req.file.path).catch(() => {});
          /** @type {import('@open-design/contracts').ProjectFileResponse} */
          const body = { file: meta };
          return res.json(body);
        }
        const { name, content, encoding, artifactManifest } = req.body || {};
        if (typeof name !== 'string' || typeof content !== 'string') {
          return sendApiError(
            res,
            400,
            'BAD_REQUEST',
            'name and content required',
          );
        }
        if (artifactManifest !== undefined && artifactManifest !== null) {
          const validated = validateArtifactManifestInput(
            artifactManifest,
            name,
          );
          if (!validated.ok) {
            return sendApiError(
              res,
              400,
              'BAD_REQUEST',
              `invalid artifactManifest: ${validated.error}`,
            );
          }
        }
        const buf =
          encoding === 'base64'
            ? Buffer.from(content, 'base64')
            : Buffer.from(content, 'utf8');
        const meta = await writeProjectFile(
          PROJECTS_DIR,
          req.params.id,
          name,
          buf,
          { artifactManifest },
          uploadProject?.metadata,
        );
        /** @type {import('@open-design/contracts').ProjectFileResponse} */
        const body = { file: meta };
        res.json(body);
      } catch (err) {
        sendApiError(res, 500, 'INTERNAL_ERROR', 'upload failed');
      }
    },
  );

  app.delete('/api/projects/:id/files/:name', async (req, res) => {
    try {
      const delProject = getProject(db, req.params.id);
      await deleteProjectFile(PROJECTS_DIR, req.params.id, req.params.name, delProject?.metadata);
      /** @type {import('@open-design/contracts').DeleteProjectFileResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });
}
