# AGENTS.md — Ultimate Open Design

Working guide for AI agents operating on this repository.

## Session Startup

Before doing anything else:

1. Read `SOUL.md` — this is who you are
2. Read `USER.md` — this is who you're helping
3. Read `memory/YYYY-MM-DD.md` (today + yesterday) for recent context
4. Read `SESSION-STATE.md` — current project progress

Don't ask permission. Just do it.

## Memory

You wake up fresh each session. These files are your continuity:

- **Daily notes:** `memory/YYYY-MM-DD.md` — raw logs of what happened
- **Long-term:** `MEMORY.md` — curated memories (if exists)
- **Session state:** `SESSION-STATE.md` — project progress tracker

Capture what matters. Write it down — "mental notes" don't survive restarts.

## Red Lines

- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking.
- `trash` > `rm` (recoverable beats gone forever).
- All work artifacts go inside this repo (workspace root), never in a subfolder.
- When in doubt, ask.

## Project Overview

Ultimate Open Design is a gap-free, feature-complete AI design system forked from [nexu-io/open-design](https://github.com/nexu-io/open-design) (34k⭐). It generates prototypes, decks, images, and videos using coding agents.

**Source repo:** `apps-orig/` and `packages-orig/` contain the original monolithic codebase.
**Target:** `apps/` contains the refactored, modular codebase.

## Repository Structure

The repo lives at the workspace root: `/root/.openclaw/workspace/`

```
(root = workspace = repo)
├── apps/
│   ├── daemon/         — Express + SQLite backend (REST/SSE, agent spawning, media, MCP, connectors)
│   │   ├── src/
│   │   │   ├── agents/         — Agent adapter system (adapters, detect, spawn, stream)
│   │   │   ├── middleware/     — Auth, rate-limit, security, validation
│   │   │   ├── routes/         — Extracted route modules (health, projects, proxy)
│   │   │   └── tests/          — Vitest tests (36+ passing)
│   │   └── sidecar/            — Daemon sidecar entry
│   ├── web/            — Next.js 16 + React 18 frontend
│   ├── desktop/        — Electron shell (sidecar IPC)
│   ├── packaged/       — Packaged Electron distribution entry
│   └── landing-page/   — Astro marketing site
├── apps-orig/          — Original monolithic source (reference)
│   └── daemon/src/
│       ├── server.ts   — 7083-line monolith (primary refactor target)
│       ├── agents.ts   — Agent definitions (16+ CLIs)
│       ├── cli.ts      — CLI entry point
│       ├── media.ts    — Media generation dispatcher
│       ├── mcp.ts      — MCP stdio server
│       ├── projects.ts — File operations
│       └── ...         — Many more modules
├── packages-orig/      — Original shared packages (reference)
├── docs/               — Audit docs, phase plans, architecture
├── skills/             — 113 skill definitions (SKILL.md + assets)
├── design-systems/     — 146 design system definitions (DESIGN.md)
├── prompt-templates/   — 96 image/video prompt templates
├── assets/             — Device frames, community pets
├── tools/              — Dev CLI, packaging scripts
├── scripts/            — Build scripts
├── deploy/             — Docker configs
├── e2e/                — Playwright tests
│
├── AGENTS.md           ← THIS FILE (project guide for AI agents)
├── README.md
├── SESSION-STATE.md
├── IMPLEMENTATION-PLAN.md
├── package.json
├── pnpm-workspace.yaml
│
│ OpenClaw workspace files (gitignored, not pushed to GitHub):
├── SOUL.md             — Agent persona
├── USER.md             — User info
├── IDENTITY.md         — Agent identity
├── TOOLS.md            — Local tool notes
├── HEARTBEAT.md        — Heartbeat config
├── memory/             — Daily memory logs
└── .openclaw/          — OpenClaw config
```

## Key Commands

```bash
# Install dependencies
pnpm install

# Build (pick the package you changed)
pnpm --filter @open-design/daemon build
pnpm --filter @open-design/web build
pnpm --filter @open-design/desktop build
pnpm --filter @open-design/packaged build

# Typecheck
pnpm --filter @open-design/daemon typecheck
pnpm --filter @open-design/web typecheck
pnpm --filter @open-design/desktop typecheck

# Test
pnpm --filter @open-design/daemon test
pnpm --filter @open-design/web test

# Full dev stack (daemon + web + desktop)
pnpm tools-dev
```

## Architecture

### How Apps Communicate

```
Desktop (Electron)  ←──sidecar IPC──→  Daemon (Express)
        ↕                                    ↕
   Web (Next.js)    ←──/api/* proxy──→  External AI CLIs
                                         (child-process spawn)
```

- **Daemon** is the hub — Express server on port 7456, SQLite DB, spawns AI agent CLIs as child processes
- **Web** proxies `/api/*` to daemon via Next.js rewrites
- **Desktop** wraps web in Electron, communicates via sidecar IPC (JSON-RPC over Unix sockets)
- **Packaged** boots daemon + web as sidecar child processes of Electron
- **Streaming**: SSE (Server-Sent Events) for real-time agent output

### Agent System

16+ agent adapters in `apps/daemon/src/agents/`:
- Claude Code, Codex, Gemini CLI, Cursor Agent, DeepSeek TUI, Qoder, Copilot, Pi, Hermes, Kimi, Kiro, Kilo, Vibe, Devin, OpenCode, Qwen
- Each adapter defines: `buildArgs()`, `streamFormat`, `promptViaStdin`, model list, capabilities
- Stream formats: `claude-stream-json`, `qoder-stream-json`, `acp-json-rpc`, `pi-rpc`, `json-event-stream`, `plain`

### Key Modules (apps-orig/daemon/src/)

| Module | Lines | Purpose |
|--------|-------|---------|
| `server.ts` | 7083 | Monolithic server — primary refactor target |
| `agents.ts` | ~1200 | Agent adapter definitions |
| `media.ts` | ~1500 | Multi-provider media generation |
| `projects.ts` | ~600 | File operations with path traversal protection |
| `mcp.ts` | ~800 | MCP stdio server |
| `connectors/service.ts` | ~500 | Composio-backed connector framework |
| `live-artifacts/store.ts` | ~1200 | Live artifact persistence |
| `critique/orchestrator.ts` | ~700 | Multi-round critique system |

## Refactoring Status

Phase 0 is in progress. See `SESSION-STATE.md` for detailed status.

**Completed:**
- Agent system extracted (`apps/daemon/src/agents/` — 5 files, 2014 lines)
- Middleware extracted (`apps/daemon/src/middleware/` — 5 files)
- Some routes extracted (`apps/daemon/src/routes/` — health, projects, proxy)
- Test infrastructure (36 passing tests)

**Remaining:**
- Extract remaining routes (chat, deploy, tools, MCP, connectors, live-artifacts, critique, orbit)
- Create slim `server.ts` entry point (<300 lines)
- Wire everything together
- Verify: lint, typecheck, test all pass

## Conventions

- TypeScript throughout, `@ts-nocheck` on older files being refactored
- Tests in `tests/` sibling to `src/` (not inside `src/`)
- Sidecar awareness stays in `apps/<app>/sidecar` — business layers don't import sidecar packages
- Path traversal protection: always use `resolveSafe` / `resolveSafeReal` for file operations
- Loopback-only security: daemon checks peer address + Host header
- Biome for lint + format (configured in `biome.json`)
- `.editorconfig` for cross-editor consistency

## Current Phase

**Phase 0 — Foundation** (in progress)
- Splitting `apps-orig/daemon/src/server.ts` (7083 lines) into modules under `apps/daemon/src/`
- See `docs/01-phase-0-foundation/` for detailed agent task specs

## ⚠️ Workspace Rule (DO NOT VIOLATE)

**The repo IS the workspace.** Do NOT create a subfolder for the repo.

- Workspace root = `/root/.openclaw/workspace/` = repo root
- All project files (apps/, docs/, skills/, etc.) live directly in the workspace
- OpenClaw config files (SOUL.md, USER.md, etc.) are gitignored — they stay local
- When pushing to GitHub, push from the workspace root: `git push origin main`
- Never do: `mkdir SomeRepo && cd SomeRepo && git clone ...` — just clone INTO the workspace

## Important Files to Read First

1. `SESSION-STATE.md` — current progress, what's done, what's next
2. `IMPLEMENTATION-PLAN.md` — 6-phase roadmap
3. `docs/00-repository-audit/GAP-ANALYSIS.md` — the 8 gaps being fixed
4. `apps-orig/daemon/src/server.ts` — the monolith being split
5. `apps/daemon/src/agents/` — already extracted (reference for pattern)
