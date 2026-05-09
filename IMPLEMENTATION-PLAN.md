# Implementation Plan — Ultimate Open Design

## Overview

6-phase plan to transform [nexu-io/open-design](https://github.com/nexu-io/open-design) into a gap-free, feature-complete AI design system.

**Source:** 34,250 stars, 146 design systems, 113 skills, Express.js + SQLite + Next.js + Electron

## The 8 Gaps Found

| # | Gap | Severity | Phase |
|---|-----|----------|-------|
| 1 | Design systems are prose, not code | HIGH | Phase 1 |
| 2 | Skills are uneven quality | MEDIUM-HIGH | Phase 2 |
| 3 | Zero web auditing | HIGH | Phase 3 |
| 4 | Agent engine is a thin wrapper | MEDIUM | Phase 0 |
| 5 | Media generation is API passthrough | MEDIUM | Phase 4 |
| 6 | No linter/formatter | LOW-MEDIUM | Phase 0 |
| 7 | Security gaps | HIGH | Phase 0 |
| 8 | No collaboration | MEDIUM | Phase 5 |

## Phase 0: Foundation (Week 1-2)

**Goal:** Fork, clean up, establish architecture

1. Fork open-design → Ultimate-Open-Design
2. Split `server.ts` (7083 lines) into modules
3. Add Biome (lint + format), .editorconfig
4. Add JWT auth, rate limiting, CSP headers
5. Add test infrastructure

**Agents needed:** 4-5 parallel

## Phase 1: Design System Overhaul (Week 3-4)

**Goal:** Machine-parseable, component-integrated design systems

1. Build token compiler (DESIGN.md → CSS vars + Tailwind config + JSON)
2. Expand 59 Tier 2 stub systems to full specs
3. Add dual-mode (light + dark), a11y tokens, motion tokens
4. Create shadcn/ui component mapping
5. Build `design-system validate` command

**Agents needed:** 4 parallel

## Phase 2: Skill Quality (Week 5-6)

**Goal:** Every skill meets minimum quality bar

1. Build automated skill validator
2. Wire axe-core + Lighthouse into generation pipeline
3. Build skill testing harness
4. Expand all skeletal skills to full quality

**Agents needed:** 4 parallel

## Phase 3: Web Auditing (Week 7-8)

**Goal:** Automated quality assurance on every artifact

1. Integrate Lighthouse (performance, SEO)
2. Integrate axe-core (WCAG compliance)
3. Add visual regression testing
4. Add performance budgets

**Agents needed:** 3 parallel

## Phase 4: Media Generation (Week 9-10)

**Goal:** Local media generation, not just API passthrough

1. ComfyUI integration for local image/video
2. Image editing (inpainting, outpainting)
3. TTS/STT integration

**Agents needed:** 3 parallel

## Phase 5: Collaboration (Week 11-12)

**Goal:** Team-ready, production-grade

1. CRDT-based real-time collaboration
2. Team workspaces with RBAC
3. Design version history
4. Developer handoff (CSS export)

**Agents needed:** 3 parallel

## Verified Repos to Integrate

All star counts verified via GitHub API on 2026-05-09:

| Repo | Stars | Purpose |
|------|-------|---------|
| anomalyco/opencode | 157,179 | Agent engine |
| shadcn-ui/ui | 113,861 | UI components |
| Comfy-Org/ComfyUI | 112,028 | Local media gen |
| tailwindlabs/tailwindcss | 94,892 | CSS framework |
| storybookjs/storybook | 89,871 | Component workshop |
| lobehub/lobehub | 76,597 | AI platform |
| cline/cline | 61,534 | IDE agent |
| penpot/penpot | 47,422 | Design tool |
| Aider-AI/aider | 44,547 | Terminal agent |
| GoogleChrome/lighthouse | 30,168 | Web auditing |
| vercel/ai | 24,106 | AI SDK |
| stackblitz-labs/bolt.diy | 19,335 | AI app builder |
| dequelabs/axe-core | 7,136 | Accessibility |
| OpenCoworkAI/open-codesign | 5,312 | Direct competitor |
