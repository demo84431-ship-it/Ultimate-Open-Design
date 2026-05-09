# Phase 3: Web Auditing Pipeline

**Status:** ⏳ Pending
**Goal:** Automated quality assurance on every artifact
**Estimated Effort:** 2 weeks

---

## Overview

The current "critique" skill is an LLM evaluating its own output. This phase adds real, objective web auditing.

---

## Agent Tasks

### Agent 1: P3-lighthouse — Lighthouse Integration

**Output:** `apps/daemon/src/audit/lighthouse.ts` + web UI components

Daemon endpoint:
```
POST /api/audit/lighthouse
Body: { url: string, categories?: string[] }
Response: { performance: 95, accessibility: 100, seo: 92, bestPractices: 88 }
```

Also create:
- `apps/web/src/components/AuditDashboard.tsx` — shows audit scores per artifact
- Historical trends chart (scores over time)
- Comparison view across design systems

**Verification:** Endpoint returns valid scores for a test URL.

### Agent 2: P3-accessibility — axe-core Automation

**Output:** `apps/daemon/src/audit/accessibility.ts`

Daemon endpoint:
```
POST /api/audit/accessibility
Body: { html: string }
Response: { violations: [...], passes: [...], incomplete: [...] }
```

Features:
- WCAG 2.2 AA compliance check
- Returns violation severity (critical/serious/moderate/minor)
- Suggests fixes for common violations
- Auto-fix capability for simple issues (missing alt text, missing labels)

**Verification:** Endpoint returns valid violations for HTML with known issues.

### Agent 3: P3-visual-regression — Visual Regression + Budgets

**Output:** `apps/daemon/src/audit/visual.ts` + Playwright config

Features:
- Playwright screenshot comparison across artifact versions
- Cross-browser testing (Chromium, Firefox, WebKit)
- Responsive testing (375px mobile, 768px tablet, 1440px desktop)
- Performance budgets:
  - LCP < 2.5s
  - FID < 100ms
  - CLS < 0.1
  - Bundle size < 500KB
- Fail generation if budgets exceeded

**Verification:** Screenshot comparison detects intentional changes. Budget enforcement works.

---

## Verification Criteria

- [ ] Lighthouse endpoint returns valid scores
- [ ] axe-core endpoint returns valid violations
- [ ] Audit dashboard displays scores in web UI
- [ ] Visual regression detects changes
- [ ] Performance budgets enforced
- [ ] Cross-browser tests pass

---

## Commit Message

```
feat(phase-3): web auditing — Lighthouse, axe-core, visual regression, performance budgets
```
