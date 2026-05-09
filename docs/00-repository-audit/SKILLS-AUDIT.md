# Skills Audit — nexu-io/open-design

**Audited:** 2026-05-09
**Total:** 113 skills in `skills/`

## Structure

Each skill lives in `skills/<name>/`:
```
skills/<name>/
├── SKILL.md              # Required. Frontmatter + workflow body.
├── example.html          # Optional. Pre-baked demo artifact.
├── assets/               # Optional. Seed templates.
│   └── template.html
├── references/           # Optional. Layout libraries, checklists.
└── examples/             # Optional. Derived example cards.
```

## SKILL.md Frontmatter

```yaml
---
name: skill-name
description: Multi-line description
triggers: ["keyword1", "keyword2"]
od:
  mode: prototype | deck | template | design-system | image | video | audio
  platform: desktop | mobile
  scenario: general | engineering | product | design | marketing | ...
  featured: 7
  design_system:
    requires: true | false
  craft:
    requires: [state-coverage, accessibility-baseline]
  fidelity: wireframe | high-fidelity
  inputs: [...]
  parameters: [...]
---
```

## Categories

| Category | Count | Examples |
|----------|-------|---------|
| Prototype (desktop) | ~60 | web-prototype, dashboard, saas-landing, kanban-board, invoice |
| Prototype (mobile) | 2 | mobile-app, mobile-onboarding |
| Deck | ~35 | html-ppt (36 themes), simple-deck, guizang-ppt, kami-deck |
| Template | 1 | design-brief |
| Image | 3 | image-poster, magazine-poster, social-carousel |
| Video | 4 | video-shortform, motion-frames, sprite-animation, hyperframes |
| Audio | 1 | audio-jingle |
| Meta/Quality | 2 | critique, tweaks |
| Live | 3 | live-artifact, live-dashboard, flowai-live-dashboard-template |

## Quality Assessment

### Exceptionally Well-Written
- **critique** — 5-dimension scoring framework with evidence-based bands (0-10)
- **tweaks** — Curated color swatches, localStorage persistence, `prefers-reduced-motion`
- **web-prototype** — Seed + layout library + P0/P1/P2 checklist
- **html-ppt** — 36 themes, 27 CSS animations, presenter mode, keyboard runtime
- **web-prototype-taste-brutalist** — Opinionated, clear banned list, mechanical motion rules

### Generally Good
- dashboard, saas-landing, mobile-app, social-carousel, dating-web, sprite-animation

### Skeletal (Needs Work)
- **invoice** — ~30 lines, no seed, no checklist
- **hr-onboarding** — ~30 lines, no seed
- **eng-runbook** — minimal
- **team-okrs** — minimal
- **meeting-notes** — minimal

## Skills System Architecture

Skills operate through a prompt composition system:
1. **Discovery layer** — turn-by-turn conversation rules
2. **Base designer prompt** — identity, workflow charter
3. **Active design system** (DESIGN.md) — authoritative tokens
4. **Active skill** (SKILL.md body) — workflow-specific instructions
5. **Deck framework** (conditional) — nav/counter/scroll JS

## What's Missing

- **No automated validation** of skill output
- **No shared responsive framework** — each skill defines its own breakpoints
- **Accessibility "available" not "enforced"** — only 2 skills require `accessibility-baseline`
- **No testing harness** — no generate → validate → screenshot compare
- **No skill versioning** or dependency management
- **No skill marketplace** or community contribution pipeline
- **The `lint-artifact` linter** mentioned in craft docs isn't wired into the pipeline
