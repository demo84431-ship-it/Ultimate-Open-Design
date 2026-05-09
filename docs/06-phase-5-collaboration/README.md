# Phase 5: Collaboration & Polish

**Status:** ⏳ Pending
**Goal:** Team-ready, production-grade
**Estimated Effort:** 2 weeks

---

## Overview

Currently single-user, local-first. This phase adds team collaboration and production polish.

---

## Agent Tasks

### Agent 1: P5-collab — Real-time Collaboration

**Output:** `apps/daemon/src/collab/`

Features:
- Yjs or Automerge for CRDT-based editing
- Shared cursors and presence indicators
- Conflict-free concurrent editing
- WebSocket transport via daemon

Files:
- `collab/yjs-provider.ts` — Yjs document provider
- `collab/websocket-handler.ts` — WebSocket server for sync
- `collab/presence.ts` — cursor and selection presence
- `apps/web/src/hooks/useCollaboration.ts` — React hook for collab

**Verification:** Two browser tabs can edit the same project simultaneously with shared cursors.

### Agent 2: P5-teams — Team Workspaces

**Output:** `apps/daemon/src/teams/`

Features:
- Team creation and management
- Role-based access control (owner, editor, viewer)
- Shared projects within teams
- Activity feed (who changed what, when)
- Team-level design system management

Database additions:
- `teams` table
- `team_members` table
- `team_projects` table
- `activity_log` table

**Verification:** Create a team, add members, share a project, verify RBAC.

### Agent 3: P5-handoff — Design Handoff

**Output:** `apps/daemon/src/handoff/`

Features:
- Design version history (git-like branching)
- Diff view between design versions
- Developer handoff:
  - CSS export from artifacts (computed styles → CSS file)
  - Design token export (CSS vars, Tailwind config, JSON)
  - Component spec generation (dimensions, colors, fonts)
  - Spacing/sizing measurements tool
- Commenting system:
  - Pin comments to specific elements
  - Thread discussions
  - Resolve/reopen comments
  - @mentions

**Verification:** Export CSS from an artifact. Create a comment pinned to an element.

---

## Verification Criteria

- [ ] Two users can edit simultaneously
- [ ] Presence indicators show active users
- [ ] Version history tracks all changes
- [ ] Developer handoff exports valid CSS
- [ ] Comments persist and sync
- [ ] RBAC prevents unauthorized access

---

## Commit Message

```
feat(phase-5): collaboration — CRDT, team workspaces, design handoff, commenting
```
