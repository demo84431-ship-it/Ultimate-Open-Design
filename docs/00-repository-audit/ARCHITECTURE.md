# Architecture Audit — nexu-io/open-design

## Monorepo Structure

```
open-design/
├── apps/
│   ├── daemon/     # Express.js + SQLite backend (THE MONOLITH)
│   ├── web/        # Next.js frontend (static export)
│   ├── desktop/    # Electron wrapper
│   ├── packaged/   # Electron packaging
│   └── landing-page/ # Astro marketing site
├── packages/
│   ├── contracts/  # Shared TypeScript types
│   ├── platform/   # Cross-platform utilities
│   ├── sidecar/    # JSON-IPC runtime
│   └── sidecar-proto/ # Sidecar message contracts
├── design-systems/ # 146 DESIGN.md files
├── skills/         # 113 SKILL.md files + templates
├── prompt-templates/ # 96 image/video prompts
├── assets/         # Device frames, community pets
├── tools/          # Dev CLI, packaging CLI
├── deploy/         # Docker configs
├── e2e/            # Playwright tests
└── scripts/        # Build scripts, guard
```

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | ~22 (target ~24) |
| Package manager | pnpm | 10.33.2 |
| Backend | Express.js | 4.19.2 |
| Database | SQLite (better-sqlite3) | 12.9.0 |
| Frontend | Next.js (App Router) | 16.2.5 |
| UI | React | 18.3.1 |
| Desktop | Electron | 41.3.0 |
| Language | TypeScript | 5.x / 6.x (split) |
| Bundler | esbuild | 0.27.7 |
| Testing | Vitest + Playwright | 2.1.8 / 1.59.1 |
| Landing | Astro | 5.15.4 |

## The Monolith: server.ts (7083 lines)

The daemon's `apps/daemon/src/server.ts` is a single 7083-line file containing:
- All API route handlers (chat, proxy, projects, deploy, health, tools)
- Agent spawning and stream parsing
- Database queries
- Proxy forwarding with SSRF protection
- Design system and skill loading
- Media task management
- Critique orchestration
- Live artifact management
- MCP server configuration
- Deploy system (Vercel, Cloudflare)
- PDF export
- Origin validation
- Tool token management

This is the primary target for Phase 0 refactoring.

## Data Flow

```
User → Web UI → Daemon
                  ↓
           composeSystemPrompt(base + designSystem + skill)
                  ↓
           spawnAgent(binary, args, stdin)
                  ↓
           Agent CLI (Claude Code / Codex / etc.)
                  ↓
           stdout → parseStream(format) → SSE → Web UI
                  ↓
           <artifact> → Renderer → Sandboxed iframe
                  ↓
           Export: HTML / PDF / PPTX / ZIP / Markdown
```

## Key Design Decisions

1. **Local-first** — Everything runs on the user's machine
2. **BYOK** — Bring Your Own Key for any model provider
3. **Agent-agnostic** — Doesn't ship its own agent, uses existing CLIs
4. **Prompt composition** — Skills + design systems composed into system prompts
5. **Artifact-first** — Output is self-contained HTML, not code to compile
6. **Sandboxed preview** — Iframes with CSP and storage polyfills

## Agent System

16 supported agents, detected via PATH scanning:
- Claude Code, Codex CLI, Gemini CLI, OpenCode, Cursor Agent, Qwen Code, Qoder CLI, GitHub Copilot CLI, DeepSeek TUI, Devin, Hermes, Kimi, Pi, Kiro, Kilo, Mistral Vibe

Each agent has:
- Binary name and detection logic
- Stream format (claude-stream-json, json-event-stream, copilot-stream-json, plain, pi-rpc, acp-json-rpc, qoder-stream-json)
- Default arguments
- Capability flags from --help parsing

## Database Schema

SQLite with 6 core tables:
- `projects` — name, skill_id, design_system_id, metadata
- `conversations` — project_id, title
- `messages` — conversation_id, role, content, agent info, events
- `preview_comments` — project_id, file_path, element_id, position
- `tabs` — project_id, name, position
- `deployments` — project_id, file_name, provider, url, status

Plus dynamic tables: `critique_runs`, `media_tasks`

## Security Model

**Current state:**
- SSRF protection on proxy (blocks localhost, private IPs)
- CSP headers on sandboxed iframes
- Tool tokens scoped to {runId, projectId, allowedEndpoints}
- Docker hardening (read-only fs, no-new-privileges, memory cap)

**Gaps:**
- API unauthenticated for non-browser clients
- No rate limiting
- No prompt injection detection
- `allow-same-origin` on iframes (potential escape)
