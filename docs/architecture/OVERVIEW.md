# Architecture Overview — Ultimate Open Design

## High-Level

```
┌─────────────────────────────────────────────────────────┐
│  User Interface                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Web UI   │  │ Desktop  │  │ CLI      │              │
│  │ (Next.js)│  │(Electron)│  │ (od)     │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       └──────────────┼────────────┘                     │
│                      ▼                                  │
│  ┌──────────────────────────────────────────────┐      │
│  │  Daemon (Express.js + SQLite)                │      │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐│      │
│  │  │ Routes │ │ Agents │ │   DB   │ │ Proxy  ││      │
│  │  └────────┘ └────────┘ └────────┘ └────────┘│      │
│  └──────────────────┬───────────────────────────┘      │
│                     ▼                                   │
│  ┌──────────────────────────────────────────────┐      │
│  │  Prompt Composition                          │      │
│  │  base + designSystem + skill + craft         │      │
│  └──────────────────┬───────────────────────────┘      │
│                     ▼                                   │
│  ┌──────────────────────────────────────────────┐      │
│  │  Agent Spawn                                 │      │
│  │  Claude Code / Codex / Gemini / etc.         │      │
│  └──────────────────┬───────────────────────────┘      │
│                     ▼                                   │
│  ┌──────────────────────────────────────────────┐      │
│  │  Artifact Render                             │      │
│  │  HTML → Sandboxed iframe → Export            │      │
│  └──────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

1. User types prompt in Web UI
2. Daemon composes system prompt from: base prompt + DESIGN.md + SKILL.md + craft rules
3. Daemon spawns agent CLI (e.g., Claude Code) with composed prompt
4. Agent generates HTML artifact
5. Daemon streams SSE events back to Web UI
6. Web UI renders artifact in sandboxed iframe
7. User can export as HTML / PDF / PPTX / ZIP / Markdown

## Key Design Decisions

1. **Local-first** — no mandatory cloud
2. **BYOK** — any model provider
3. **Agent-agnostic** — uses existing CLIs, doesn't ship its own
4. **Prompt composition** — skills + design systems are prompt context, not code
5. **Artifact-first** — output is self-contained HTML
6. **Sandboxed preview** — iframes with CSP
