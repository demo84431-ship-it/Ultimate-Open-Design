// @ts-nocheck
import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  aggregateCloudflarePagesStatus,
  buildDeployFileSet,
  checkDeploymentUrl,
  CLOUDFLARE_PAGES_PROVIDER_ID,
  cloudflarePagesProjectNameForProject,
  DeployError,
  deployToCloudflarePages,
  deployToVercel,
  isDeployProviderId,
  listCloudflarePagesZones,
  prepareDeployPreflight,
  publicDeployConfigForProvider,
  readDeployConfig,
  readCloudflarePagesDomain,
  VERCEL_PROVIDER_ID,
  writeDeployConfig,
} from '../deploy.js';
import { finalizeDesignPackage, FinalizePackageLockedError, FinalizeUpstreamError } from '../finalize-design.js';
import { redactSecrets, validateBaseUrl } from '../connectionTest.js';
import { isSafeId } from '../projects.js';

/**
 * Context required by the deploy routes.
 */
export interface DeployRouteContext {
  db: any;
  sendApiError: (res: Response, status: number, code: string, message: string, init?: any) => void;
  getProject: (db: any, id: string) => any;
  getDeployment: (db: any, projectId: string, fileName: string, providerId: string) => any;
  getDeploymentById: (db: any, projectId: string, deploymentId: string) => any;
  listDeployments: (db: any, projectId: string) => any[];
  upsertDeployment: (db: any, deployment: any) => any;
  PROJECTS_DIR: string;
  DESIGN_SYSTEMS_DIR: string;
}

function cloudflarePagesDeploymentMetadata(projectName) {
  const normalized = typeof projectName === 'string' ? projectName.trim() : '';
  return normalized
    ? { cloudflarePagesProjectName: normalized }
    : undefined;
}

function cloudflarePagesProjectNameFromDeployment(deployment) {
  const value = deployment?.providerMetadata?.cloudflarePagesProjectName;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return cloudflarePagesProjectNameFromUrl(deployment?.url);
}

function cloudflarePagesProjectNameFromUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (!host.endsWith('.pages.dev')) return '';
    const labels = host.slice(0, -'.pages.dev'.length).split('.').filter(Boolean);
    return labels.at(-1) || '';
  } catch {
    return '';
  }
}

function cloudflarePagesProjectNameForDeploy(db, projectId, projectName, prior) {
  const priorName = cloudflarePagesProjectNameFromDeployment(prior);
  if (priorName) return priorName;
  for (const deployment of ctx.listDeployments(db, projectId)) {
    if (deployment.providerId !== CLOUDFLARE_PAGES_PROVIDER_ID) continue;
    const stableName = cloudflarePagesProjectNameFromDeployment(deployment);
    if (stableName) return stableName;
  }
  return cloudflarePagesProjectNameForProject(projectId, projectName);
}

function publicDeployment(deployment) {
  if (!deployment || typeof deployment !== 'object') return deployment;
  const { providerMetadata: _providerMetadata, ...publicShape } = deployment;
  return publicShape;
}

function publicDeployments(deployments) {
  return (deployments || []).map(publicDeployment);
}

async function checkCloudflarePagesDeploymentLinks(existing) {
  const current = existing.cloudflarePages || {};
  const projectName = current.projectName || cloudflarePagesProjectNameFromDeployment(existing);
  const config = await readDeployConfig(CLOUDFLARE_PAGES_PROVIDER_ID);
  const pagesDevUrl = current.pagesDev?.url || existing.url;
  const pagesDevResult = await checkDeploymentUrl(pagesDevUrl);
  const pagesDev = {
    ...(current.pagesDev || {}),
    url: pagesDevUrl,
    status: pagesDevResult.reachable ? 'ready' : pagesDevResult.status || 'link-delayed',
    statusMessage: pagesDevResult.reachable
      ? 'Public link is ready.'
      : pagesDevResult.statusMessage || current.pagesDev?.statusMessage || 'Cloudflare Pages is still preparing the pages.dev link.',
    reachableAt: pagesDevResult.reachable ? Date.now() : current.pagesDev?.reachableAt,
  };
  let customDomain = current.customDomain;
  if (customDomain?.url && customDomain.status !== 'conflict') {
    let pagesDomain = null;
    if (config?.token && config?.accountId && projectName) {
      try {
        pagesDomain = await readCloudflarePagesDomain({ ...config, projectName }, customDomain.hostname);
      } catch {
        pagesDomain = null;
      }
    }
    const customResult = await checkDeploymentUrl(customDomain.url);
    const pagesDomainStatus = pagesDomain?.status || customDomain.pagesDomainStatus;
    const failedByApi = ['error', 'blocked', 'deactivated'].includes(String(pagesDomainStatus || '').toLowerCase());
    const activeByApi = String(pagesDomainStatus || '').toLowerCase() === 'active';
    const readyByReachability = customResult.reachable && activeByApi;
    customDomain = {
      ...customDomain,
      domainStatus: pagesDomain
        ? pagesDomain.status === 'active' ? 'active' : failedByApi ? 'failed' : 'pending'
        : customDomain.domainStatus,
      pagesDomainStatus,
      validationData: pagesDomain?.validation_data ?? customDomain.validationData,
      verificationData: pagesDomain?.verification_data ?? customDomain.verificationData,
      status: readyByReachability ? 'ready' : customDomain.status === 'failed' || failedByApi ? 'failed' : 'pending',
      statusMessage: readyByReachability
        ? 'Custom domain is ready.'
        : failedByApi ? 'Cloudflare Pages reported a custom-domain error.'
        : customResult.statusMessage || customDomain.statusMessage || 'Custom domain is still being prepared.',
    };
  }
  const cloudflarePages = {
    ...current,
    projectName,
    pagesDev,
    ...(customDomain ? { customDomain } : {}),
  };
  const aggregate = aggregateCloudflarePagesStatus(pagesDev, customDomain);
  return {
    url: pagesDev.url,
    status: aggregate.status,
    statusMessage: aggregate.statusMessage,
    cloudflarePages,
    providerMetadata: {
      ...(existing.providerMetadata || {}),
      cloudflarePages,
    },
  };
}

export function registerDeployRoutes(app: Express, ctx: DeployRouteContext) {
  const {
    db,
    sendApiError,
    getProject,
    getDeployment,
    getDeploymentById,
    listDeployments,
    upsertDeployment,
    PROJECTS_DIR,
    DESIGN_SYSTEMS_DIR,
  } = ctx;

  const validateExternalApiBaseUrl = (baseUrl) => validateBaseUrl(baseUrl);

  app.get('/api/deploy/config', async (req, res) => {
    try {
      const providerId =
        typeof req.query.providerId === 'string' ? req.query.providerId : VERCEL_PROVIDER_ID;
      if (!isDeployProviderId(providerId)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'unsupported deploy provider');
      }
      const body = publicDeployConfigForProvider(providerId, await readDeployConfig(providerId));
      res.json(body);
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.put('/api/deploy/config', async (req, res) => {
    try {
      const input = req.body || {};
      const providerId =
        typeof input.providerId === 'string' ? input.providerId : VERCEL_PROVIDER_ID;
      if (!isDeployProviderId(providerId)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'unsupported deploy provider');
      }
      const body = await writeDeployConfig(providerId, input);
      res.json(body);
    } catch (err) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  });

  app.get('/api/deploy/cloudflare-pages/zones', async (_req, res) => {
    try {
      const body = await listCloudflarePagesZones(await readDeployConfig(CLOUDFLARE_PAGES_PROVIDER_ID));
      res.json(body);
    } catch (err) {
      const status = err instanceof DeployError ? err.status : 400;
      const init = err instanceof DeployError && err.details ? { details: err.details } : {};
      sendApiError(res, status, 'BAD_REQUEST', String(err?.message || err), init);
    }
  });

  app.get('/api/projects/:id/deployments', (req, res) => {
    try {
      const body = { deployments: publicDeployments(listDeployments(db, req.params.id)) };
      res.json(body);
    } catch (err) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  });

  app.post('/api/projects/:id/deploy', async (req, res) => {
    try {
      const { fileName, providerId = VERCEL_PROVIDER_ID, cloudflarePages } = req.body || {};
      if (!isDeployProviderId(providerId)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'unsupported deploy provider');
      }
      if (typeof fileName !== 'string' || !fileName.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'fileName required');
      }
      const prior = getDeployment(db, req.params.id, fileName, providerId);
      const deployProject = getProject(db, req.params.id);
      const files = await buildDeployFileSet(PROJECTS_DIR, req.params.id, fileName, { metadata: deployProject?.metadata });
      const project = getProject(db, req.params.id);
      const cloudflarePagesProjectName =
        providerId === CLOUDFLARE_PAGES_PROVIDER_ID
          ? cloudflarePagesProjectNameForDeploy(db, req.params.id, project?.name, prior)
          : '';
      const result = providerId === CLOUDFLARE_PAGES_PROVIDER_ID
        ? await deployToCloudflarePages({
            config: { ...await readDeployConfig(CLOUDFLARE_PAGES_PROVIDER_ID), projectName: cloudflarePagesProjectName },
            files,
            projectId: req.params.id,
            cloudflarePages,
            priorMetadata: prior?.providerMetadata,
          })
        : await deployToVercel({
            config: await readDeployConfig(VERCEL_PROVIDER_ID),
            files,
            projectId: req.params.id,
          });
      const now = Date.now();
      const body = upsertDeployment(db, {
        id: prior?.id ?? randomUUID(),
        projectId: req.params.id,
        fileName,
        providerId,
        url: result.url,
        deploymentId: result.deploymentId,
        deploymentCount: (prior?.deploymentCount ?? 0) + 1,
        target: 'preview',
        status: result.status,
        statusMessage: result.statusMessage,
        reachableAt: result.reachableAt,
        cloudflarePages: result.cloudflarePages,
        providerMetadata:
          providerId === CLOUDFLARE_PAGES_PROVIDER_ID
            ? (result.providerMetadata ?? cloudflarePagesDeploymentMetadata(cloudflarePagesProjectName))
            : prior?.providerMetadata,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
      });
      res.json(publicDeployment(body));
    } catch (err) {
      const status = err instanceof DeployError ? err.status : 400;
      const init = err instanceof DeployError && err.details ? { details: err.details } : {};
      sendApiError(res, status, status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST', String(err?.message || err), init);
    }
  });

  app.post('/api/projects/:id/deploy/preflight', async (req, res) => {
    try {
      const { fileName, providerId = VERCEL_PROVIDER_ID } = req.body || {};
      if (!isDeployProviderId(providerId)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'unsupported deploy provider');
      }
      if (typeof fileName !== 'string' || !fileName.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'fileName required');
      }
      const preflightProject = getProject(db, req.params.id);
      const body = await prepareDeployPreflight(PROJECTS_DIR, req.params.id, fileName, {
        metadata: preflightProject?.metadata,
        providerId,
      });
      res.json(body);
    } catch (err) {
      if (!(err instanceof DeployError)) {
        console.error('[deploy/preflight]', err);
      }
      const status = err instanceof DeployError ? err.status : 400;
      sendApiError(res, status, status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST', String(err?.message || err));
    }
  });

  app.post('/api/projects/:id/finalize/anthropic', async (req, res) => {
    const { apiKey, baseUrl, model, maxTokens } = req.body || {};
    try {
      if (!isSafeId(req.params.id)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'invalid project id');
      }
      if (typeof apiKey !== 'string' || !apiKey.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'apiKey is required');
      }
      if (typeof model !== 'string' || !model.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'model is required');
      }
      if (baseUrl !== undefined) {
        if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'baseUrl must be a non-empty string when provided');
        }
        const validated = validateExternalApiBaseUrl(baseUrl);
        if (validated.error) {
          return sendApiError(res, validated.forbidden ? 403 : 400, validated.forbidden ? 'FORBIDDEN' : 'BAD_REQUEST', validated.error);
        }
      }
      if (maxTokens !== undefined && (typeof maxTokens !== 'number' || maxTokens <= 0)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'maxTokens must be a positive number when provided');
      }
      const project = getProject(db, req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      const result = await finalizeDesignPackage(db, PROJECTS_DIR, DESIGN_SYSTEMS_DIR, req.params.id, { apiKey, baseUrl, model, maxTokens });
      res.json(result);
    } catch (err) {
      if (err instanceof FinalizePackageLockedError) {
        return sendApiError(res, 409, 'CONFLICT', err.message);
      }
      if (err instanceof FinalizeUpstreamError) {
        const safeDetails = redactSecrets(err.rawText || '', [apiKey]);
        const init = safeDetails ? { details: safeDetails } : {};
        if (err.status === 401) return sendApiError(res, 401, 'UNAUTHORIZED', err.message, init);
        if (err.status === 429) return sendApiError(res, 429, 'RATE_LIMITED', err.message, init);
        return sendApiError(res, 502, 'UPSTREAM_UNAVAILABLE', err.message, init);
      }
      const errName = err && typeof err === 'object' && 'name' in err ? err.name : '';
      if (errName === 'AbortError') {
        return sendApiError(res, 503, 'UPSTREAM_UNAVAILABLE', 'finalize timed out');
      }
      console.error('[finalize/anthropic]', err);
      const safeMsg = redactSecrets(String(err?.message || err), [apiKey]);
      return sendApiError(res, 500, 'INTERNAL_ERROR', safeMsg);
    }
  });

  app.post('/api/projects/:id/deployments/:deploymentId/check-link', async (req, res) => {
    try {
      const existing = getDeploymentById(db, req.params.id, req.params.deploymentId);
      if (!existing) {
        return sendApiError(res, 404, 'FILE_NOT_FOUND', 'deployment not found');
      }
      const stableCloudflareProjectName =
        existing.providerId === CLOUDFLARE_PAGES_PROVIDER_ID
          ? cloudflarePagesProjectNameFromDeployment(existing)
          : '';
      if (existing.providerId === CLOUDFLARE_PAGES_PROVIDER_ID && existing.cloudflarePages?.pagesDev?.url) {
        const checked = await checkCloudflarePagesDeploymentLinks(existing);
        const now = Date.now();
        const body = upsertDeployment(db, {
          ...existing,
          ...checked,
          reachableAt: checked.status === 'ready' ? now : existing.reachableAt,
          updatedAt: now,
        });
        return res.json(publicDeployment(body));
      }
      const checkUrl = stableCloudflareProjectName
        ? `https://${stableCloudflareProjectName}.pages.dev`
        : existing.url;
      const result = await checkDeploymentUrl(checkUrl);
      const now = Date.now();
      const body = upsertDeployment(db, {
        ...existing,
        url: checkUrl || existing.url,
        status: result.reachable ? 'ready' : result.status || 'link-delayed',
        statusMessage: result.reachable
          ? 'Public link is ready.'
          : result.statusMessage || 'Vercel is still preparing the public link.',
        reachableAt: result.reachable ? now : existing.reachableAt,
        updatedAt: now,
      });
      res.json(publicDeployment(body));
    } catch (err) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  });
}
