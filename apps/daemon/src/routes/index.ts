// @ts-nocheck
/**
 * Route modules barrel file.
 *
 * Re-exports every route-registration function so the slim server.ts
 * entry point can import them all from one place.
 */

export { registerHealthRoutes } from './health.js';
export { registerProjectRoutes } from './projects.js';
export { registerProxyRoutes } from './proxy.js';
export { registerChatRoutes } from './chat.js';
export { registerDeployRoutes } from './deploy.js';
export { registerToolsRoutes } from './tools.js';
