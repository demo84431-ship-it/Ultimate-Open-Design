# Source Repository

**Original:** https://github.com/nexu-io/open-design
**Stars:** 34,250 (verified via GitHub API on 2026-05-09)
**License:** Apache 2.0

## What It Is

An open-source alternative to Anthropic's Claude Design. Local-first, web-deployable, BYOK at every layer. 16 coding-agent CLIs auto-detected on PATH, driven by 31 composable Skills and 72 brand-grade Design Systems.

## How We Use It

This repository (Ultimate-Open-Design) is a comprehensive fork and enhancement plan. The original source code is referenced for:
- Architecture analysis
- Gap identification
- Implementation planning

The actual source code will be pulled from the original repo when Phase 0 begins.

## Key Files in Original Repo

| File | Lines | Purpose |
|------|-------|---------|
| `apps/daemon/src/server.ts` | 7083 | THE monolith — primary refactor target |
| `apps/daemon/src/agents.ts` | — | Agent detection and spawning |
| `apps/daemon/src/db.ts` | — | SQLite database |
| `apps/daemon/src/prompts/system.ts` | — | System prompt composition |
| `packages/contracts/src/` | — | Shared TypeScript types |
| `design-systems/` | 146 dirs | DESIGN.md files |
| `skills/` | 113 dirs | SKILL.md files + templates |
