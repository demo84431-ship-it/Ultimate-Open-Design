# Phase 2: Skill Quality & Validation

**Status:** ⏳ Pending
**Goal:** Every skill meets minimum quality bar
**Estimated Effort:** 2 weeks

---

## Overview

113 skills with extreme quality gradient. This phase enforces a minimum standard and automates validation.

---

## Agent Tasks

### Agent 1: P2-skill-validator — Build Skill Validator

**Output:** `packages/tokens/src/skill-validator.ts`

CLI: `skill validate <name>` or `skill validate --all`

Checks per skill:
- SKILL.md has all required frontmatter (name, description, triggers, od.mode, od.scenario)
- Has seed template (`assets/template.html`) if mode is prototype or deck
- Has checklist (`references/checklist.md`) with P0/P1/P2 gates
- References a design system (`od.design_system.requires`)
- Has responsive breakpoints defined
- Has accessibility requirements (`od.craft.requires` includes `accessibility-baseline`)
- Triggers list is non-empty (at least English + Chinese)
- Example prompt exists (`od.example_prompt`)

**Verification:** Runs on all 113 skills. Reports pass/fail with specific missing items.

### Agent 2: P2-audit-pipeline — Wire axe-core + Lighthouse

**Output:** `apps/daemon/src/audit/`

Add to the generation pipeline:
- After artifact generation, auto-run axe-core on the HTML
- After artifact generation, auto-run Lighthouse on the served URL
- Store audit results in `audit-results/<project-id>/<artifact>.json`
- Fail generation if critical a11y violations found (WCAG 2.2 AA)

Files to create:
- `audit/axe-runner.ts` — runs axe-core on HTML string
- `audit/lighthouse-runner.ts` — runs Lighthouse on URL
- `audit/results-store.ts` — stores and retrieves audit results

**Verification:** Generate a test artifact, verify audit results are stored.

### Agent 3: P2-testing-harness — Build Skill Testing Harness

**Output:** `scripts/test-skill.ts`

For each skill:
1. Generate artifact from skill + design system + example prompt
2. Run axe-core (must pass WCAG 2.2 AA — 0 critical violations)
3. Run Lighthouse (must score >90 performance, >90 accessibility)
4. Take screenshot and compare against baseline
5. Store results in `test-results/<skill-name>/`

**Verification:** Run harness on 5 skills, verify results are stored.

### Agent 4: P2-expand-skills — Upgrade Skeletal Skills

**Input:** Skills with <50 lines in SKILL.md
**Output:** Expanded SKILL.md files with seed + checklist

Skills to upgrade:
- `invoice` — add seed template, checklist, responsive layout, finance scenario
- `hr-onboarding` — add seed template, checklist, a11y requirements
- `eng-runbook` — add seed template, checklist, engineering scenario
- `team-okrs` — add seed template, checklist, product scenario
- `meeting-notes` — add seed template, checklist
- `weekly-update` — add seed template, checklist

Each expanded skill should have:
- Full frontmatter with all fields
- `assets/template.html` seed (200+ lines)
- `references/checklist.md` with P0/P1/P2 gates
- Responsive breakpoints
- Accessibility requirements
- Example prompt

**Verification:** All expanded skills pass the skill validator.

---

## Verification Criteria

- [ ] Skill validator runs on all 113 skills
- [ ] All expanded skills have seed + checklist
- [ ] Audit pipeline runs on generated artifacts
- [ ] Testing harness produces baseline screenshots
- [ ] Zero critical a11y violations in any skill output
- [ ] All expanded skills pass validator

---

## Commit Message

```
feat(phase-2): skill quality — validator, audit pipeline, testing harness, expanded skills
```
