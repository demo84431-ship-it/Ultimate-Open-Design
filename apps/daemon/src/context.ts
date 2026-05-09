// @ts-nocheck
/**
 * Shared daemon context.
 *
 * This module defines the DaemonContext type that every route module
 * receives via its register function. The context is created once in
 * server.ts and threaded through to each route group.
 *
 * Keeping the context definition separate from server.ts means route
 * modules can import the type without pulling in the full server entry
 * point (circular dependency risk, test complexity).
 */

import type { Express, Request, Response } from 'express';
import type Database from 'better-sqlite3';

export interface DaemonContext {
  db: Database.Database;
  sendApiError: (res: Response, status: number, code: string, message: string, init?: any) => void;
  sendMulterError: (res: Response, err: any) => void;
  createSseResponse: (res: Response, opts?: any) => any;
  isLocalSameOrigin: (req: Request, port: number) => boolean;
  resolvedPort: () => number;
  PROJECT_ROOT: string;
  PROJECTS_DIR: string;
  RUNTIME_DATA_DIR: string;
  RUNTIME_DATA_DIR_CANONICAL: string;
  SKILLS_DIR: string;
  DESIGN_SYSTEMS_DIR: string;
  CRAFT_DIR: string;
  FRAMES_DIR: string;
  BUNDLED_PETS_DIR: string;
  PROMPT_TEMPLATES_DIR: string;
  ARTIFACTS_DIR: string;
  UPLOAD_DIR: string;
  daemonUrl: string;
}
