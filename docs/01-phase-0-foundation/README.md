# Phase 0: Foundation

**Status:** 🔄 In Progress
**Goal:** Fork, clean up, establish architecture
**Estimated Effort:** 2 weeks

---

## Overview

The original `apps/daemon/src/server.ts` is a 7083-line monolith. This phase breaks it into clean modules, adds development tooling, security infrastructure, and test coverage.

---

## Agent Tasks

### Agent 1: P0-routes — Extract Routes from Monolith

**Input:** `apps-orig/daemon/src/server.ts` (7083 lines)
**Output:** 7 files under `apps/daemon/src/routes/`

Extract these route groups into separate files:

| File | Routes | Key Functions |
|------|--------|---------------|
| `chat.ts` | POST /api/chat, POST /api/runs, GET /api/chat/:id/events | startChatRun(), SSE streaming, message processing |
| `proxy.ts` | POST /api/proxy/{anthropic,openai,azure,google,ollama}/stream | SSRF protection, stream forwarding |
| `projects.ts` | GET/POST/PUT/DELETE /api/projects | CRUD operations, file management |
| `deploy.ts` | POST /api/deploy, GET /api/deploy/status | Vercel, Cloudflare Pages deployment |
| `health.ts` | GET /api/health | Health check endpoint |
| `tools.ts` | POST /api/tools/* | Tool token minting, live artifacts, connectors |
| `index.ts` | — | Barrel file re-exporting all route modules |

Each file should:
- Start with `// @ts-nocheck` (original uses it)
- Export a `registerXxxRoutes(app, ctx)` function
- Preserve ALL logic from the original

### Agent 2: P0-agents — Extract Agent System

**Input:** `apps-orig/daemon/src/agents.ts`
**Output:** 5 files under `apps/daemon/src/agents/`

| File | Lines | Purpose |
|------|-------|---------|
| `adapters.ts` | ~750 | 16 agent definitions, types, helpers |
| `detect.ts` | ~510 | PATH scanning, probing, model validation |
| `spawn.ts` | ~410 | Child process lifecycle, prompt composition |
| `stream.ts` | ~270 | SSE stream routing per agent format |
| `index.ts` | ~75 | Barrel export |

**Status:** ✅ Completed (2014 lines extracted)

### Agent 3: P0-tooling — Add Development Tooling

**Output:**
- `biome.json` — linting + formatting config
- `.editorconfig` — editor config
- `tsconfig.base.json` — shared TypeScript config
- Updated `package.json` with workspace scripts

**Status:** ✅ Completed

### Agent 4: P0-security — Add Security Layer

**Output:** 5 files under `apps/daemon/src/middleware/`

| File | Purpose |
|------|---------|
| `auth.ts` | JWT authentication (auto-generated secret, 24h expiry) |
| `rate-limit.ts` | Rate limiting (100/min global, 20/min chat, 30/min proxy) |
| `security.ts` | CSP headers, X-Content-Type-Options, X-Frame-Options |
| `validate.ts` | Zod-based request validation middleware |
| `index.ts` | Barrel export |

**Status:** ✅ Completed

### Agent 5: P0-tests — Test Infrastructure

**Output:**
- `apps/daemon/tests/middleware/auth.test.ts` — 16 tests
- `apps/daemon/tests/middleware/rate-limit.test.ts` — 10 tests
- `apps/daemon/tests/middleware/validate.test.ts` — 10 tests
- `apps/daemon/tests/helpers.ts` — mock Express utilities
- `apps/daemon/vitest.config.ts` — test configuration

**Status:** ✅ Completed (36 passing tests)

### Agent 6: P0-server — Create Slim Server Entry Point

**Input:** All extracted modules
**Output:** `apps/daemon/src/server.ts` (<300 lines)

Create a clean entry point that:
1. Imports Express and sets up the app
2. Applies middleware (CORS, body-parser, security, rate-limiting, auth)
3. Registers all routes via route modules
4. Sets up database connection
5. Starts agent detection on startup
6. Starts HTTP server

Also create `apps/daemon/src/context.ts` — shared context object with DB, agent registry, config, tool tokens.

**Status:** ⏳ Pending

---

## Verification Criteria

- [ ] `pnpm lint` passes (Biome)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (36+ tests)
- [ ] `pnpm guard` passes (layout policy)
- [ ] Server starts and responds to GET /api/health
- [ ] Auth middleware blocks unauthenticated requests to /api/*
- [ ] Rate limiting returns 429 on threshold
- [ ] New server.ts is under 300 lines

---

## Commit Message

```
feat(phase-0): foundation — daemon split, tooling, security, tests
```

---

## How to Resume

1. Read `SESSION-STATE.md` to check which agents completed
2. For incomplete agents, re-spawn with the same task
3. After all agents complete, run verification
4. Commit and push
5. Update SESSION-STATE.md
6. Move to Phase 1
