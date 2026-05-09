# Phase 0: Foundation

**Status:** ⏳ Pending
**Goal:** Fork, clean up, establish architecture

## Tasks

### 1. Daemon Monolith Split
Split `apps/daemon/src/server.ts` (7083 lines) into modules:
- `src/routes/chat.ts` — chat/run endpoints
- `src/routes/proxy.ts` — BYOK proxy endpoints
- `src/routes/projects.ts` — project CRUD
- `src/routes/deploy.ts` — deployment endpoints
- `src/routes/health.ts` — health check
- `src/routes/tools.ts` — tool token endpoints
- `src/agents/detect.ts` — PATH scanning
- `src/agents/spawn.ts` — process spawning
- `src/agents/stream.ts` — SSE parsing
- `src/agents/adapters.ts` — agent definitions
- `src/db/schema.ts` — SQLite schema
- `src/db/queries.ts` — query functions
- `src/proxy/handler.ts` — proxy forwarding
- `src/server.ts` — slim entry point (<200 lines)

### 2. Development Tooling
- Add Biome (lint + format)
- Add .editorconfig
- Unify TypeScript to 5.x
- Add workspace scripts

### 3. Security Layer
- JWT auth middleware
- Rate limiting (100/min global, 20/min chat, 30/min proxy)
- CSP headers
- Zod validation middleware

### 4. Test Infrastructure
- Test files for all new modules
- Test utilities (mock Express, mock DB)
- Vitest configuration

## Verification
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm guard` passes
- [ ] Server starts and responds to health check
- [ ] Auth blocks unauthenticated requests
- [ ] Rate limiting returns 429 on threshold

## Strategy
Split the 7083-line monolith into focused agents:
- Agent 1: Extract routes (chat, proxy, projects, deploy, health, tools)
- Agent 2: Extract agent logic (spawn, stream, adapters)
- Agent 3: Add tooling (Biome, .editorconfig, TS config)
- Agent 4: Add security (auth, rate limiting, CSP, validation)
- Agent 5: Add tests
