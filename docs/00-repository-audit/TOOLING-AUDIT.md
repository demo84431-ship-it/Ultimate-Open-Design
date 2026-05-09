# Tooling Audit — nexu-io/open-design

**Audited:** 2026-05-09

## Build System

- **Monorepo:** pnpm workspaces with 4 groups (apps, packages, tools, e2e)
- **Packages/tools:** esbuild + tsc --emitDeclarationOnly (dual output)
- **Apps:** tsc (daemon, desktop) or next build (web)
- **Postinstall:** Auto-builds all package entrypoints after pnpm install

## Testing

| Layer | Tool | Count |
|-------|------|-------|
| Unit/integration | Vitest | ~50+ test files |
| E2E smoke | Vitest | 4 spec/test files |
| E2E UI | Playwright | 7 test files |
| Deploy tests | Vitest | 1 test file |

## CI/CD

- **CI:** PR + main push → typecheck + guard + i18n + all tests + all builds + packaged smoke
- **Release Beta:** Manual → Cloudflare R2
- **Release Stable:** Manual → GitHub Release + R2 + rollback support
- **Landing Page:** Astro → Cloudflare Pages

## What's Missing

- **No linter** (ESLint, Biome, oxlint)
- **No formatter** (Prettier, Biome)
- **No `.editorconfig`**
- **No visual regression testing** (Percy, Chromatic)
- **No performance/load testing** (k6, artillery)
- **No API contract testing** (Pact)
- **No mutation testing** (Stryker)
- **No fuzz testing** for HTTP boundary
- **Thin daemon test coverage** (acknowledged in roadmap R10)
- **45-minute CI timeout** — suggests slow builds
- **No Node version matrix testing**
- **No Playwright browser caching in CI**
- **TypeScript version split** — apps use ^5.6.3, tools/packages use 6.0.3

## Security

**Current:**
- SSRF protection on proxy endpoints
- CSP headers on sandboxed iframes
- Tool tokens scoped to {runId, projectId}
- Docker hardening (read-only fs, no-new-privileges, memory cap)

**Gaps:**
- API unauthenticated for non-browser clients
- No rate limiting
- No prompt injection detection
- No CSP for main web app
- `allow-same-origin` on iframes

## Guard System

`scripts/guard.ts` — repository layout policy enforcer:
1. Residual JavaScript check (TypeScript-only enforcement)
2. Test layout check (tests in sibling `tests/` dirs)
3. E2E layout check
4. Web test layout check
5. Tools layout check

This is **excellent** — rare to see this level of automated structure validation.
