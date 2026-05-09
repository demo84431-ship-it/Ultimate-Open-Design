# Phase 2: Skill Quality & Validation

**Status:** ⏳ Pending
**Goal:** Every skill meets minimum quality bar

## Tasks

### 1. Skill Validator
CLI: `skill validate <name>` — checks frontmatter, seed, checklist, responsive, a11y, triggers, example prompt.

### 2. Audit Pipeline
Wire axe-core + Lighthouse into generation flow. Auto-run after artifact generation. Store results alongside artifacts.

### 3. Testing Harness
For each skill: generate → axe-core (WCAG 2.2 AA) → Lighthouse (>90 perf, >90 a11y) → screenshot compare → store results.

### 4. Expand Skeletal Skills
Upgrade invoice, hr-onboarding, eng-runbook, team-okrs, meeting-notes, weekly-update to full quality with seed + checklist.

## Verification
- [ ] Validator runs on all 113 skills
- [ ] All expanded skills have seed + checklist
- [ ] Audit pipeline runs on artifacts
- [ ] Testing harness produces baselines
- [ ] Zero critical a11y violations

## Agents
- P2-skill-validator: Build validator
- P2-audit-pipeline: Wire axe-core + Lighthouse
- P2-testing-harness: Build harness
- P2-expand-skills: Upgrade skeletal skills
