// @ts-nocheck
import type { Express } from 'express';

/**
 * Register health-check and version endpoints.
 *
 * These routes remain open to monitoring probes (no origin/auth check).
 */
export function registerHealthRoutes(
  app: Express,
  ctx: {
    readCurrentAppVersionInfo: () => Promise<{ version: string }>;
  },
) {
  app.get('/api/health', async (_req, res) => {
    const versionInfo = await ctx.readCurrentAppVersionInfo();
    res.json({ ok: true, version: versionInfo.version });
  });

  app.get('/api/version', async (_req, res) => {
    const version = await ctx.readCurrentAppVersionInfo();
    res.json({ version });
  });
}
