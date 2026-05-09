# Phase 3: Web Auditing Pipeline

**Status:** ⏳ Pending
**Goal:** Automated quality assurance on every artifact

## Tasks

### 1. Lighthouse Integration
- `POST /api/audit/lighthouse` — runs Lighthouse on artifact URL
- Returns: Performance, Accessibility, Best Practices, SEO, PWA scores
- Audit dashboard UI in web app

### 2. Accessibility Automation
- `POST /api/audit/accessibility` — runs axe-core on artifact HTML
- Returns WCAG violations with severity + fixes
- WCAG 2.2 AA compliance certificate per artifact

### 3. Visual Regression & Budgets
- Playwright screenshot comparison
- Cross-browser (Chromium, Firefox, WebKit)
- Responsive (375px, 768px, 1440px)
- Performance budgets: LCP <2.5s, FID <100ms, CLS <0.1, bundle <500KB

## Verification
- [ ] Lighthouse endpoint returns valid scores
- [ ] axe-core endpoint returns violations
- [ ] Audit dashboard displays scores
- [ ] Visual regression detects changes
- [ ] Performance budgets enforced
