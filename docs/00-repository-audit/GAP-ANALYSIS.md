# Gap Analysis — nexu-io/open-design

**Audited:** 2026-05-09
**Audited By:** 4 parallel AI agents (architecture, skills, design systems, tooling)
**Repository:** https://github.com/nexu-io/open-design (34,250 stars)
**Source Code Cloned:** /root/.openclaw/workspace/open-design-analysis

## Methodology

Deep-read of the entire repository: every source file, 113 skills, 146 design systems, build configs, test files, CI/CD pipelines, security headers, and documentation. Four specialized agents analyzed different aspects in parallel.

---

## Gap 1: Design Systems Are Prose, Not Code

**Severity:** HIGH
**Phase:** 1

**Finding:** 146 DESIGN.md files are pure Markdown prose. Zero machine-parseable tokens.

- 70 rich product systems (200-1000+ lines) — detailed but unstructured
- 59 template stubs (~71 lines) — identical boilerplate with only colors differing
- No CSS variables, Tailwind config, or JSON tokens
- No dark mode toggle specs
- No accessibility tokens (ARIA patterns, contrast ratios)
- No motion tokens
- No responsive breakpoint tokens
- No component library integration

**Impact:** Agents must parse Markdown prose to extract design values — fragile, inconsistent, and slow.

---

## Gap 2: Skills Are Uneven Quality

**Severity:** MEDIUM-HIGH
**Phase:** 2

**Finding:** 113 skills with extreme quality gradient.

- `html-ppt`: 200+ lines, 36 themes, 27 CSS animations, presenter mode
- `invoice`: ~30 lines, no seed, no checklist
- No automated validation of skill output
- No shared responsive framework
- Accessibility "available" not "enforced"
- No testing harness
- No skill versioning

**Impact:** Inconsistent output quality. Some skills produce production-ready artifacts, others produce bare-bones HTML.

---

## Gap 3: Zero Web Auditing

**Severity:** HIGH
**Phase:** 3

**Finding:** The "critique" skill is an LLM evaluating its own output.

- No Lighthouse integration (performance, SEO)
- No axe-core integration (WCAG compliance)
- No visual regression testing
- No cross-browser testing
- No performance budgets
- No automated accessibility auditing

**Impact:** No objective quality metrics. Generated artifacts may have poor performance, accessibility violations, or SEO issues with no detection.

---

## Gap 4: Agent Engine Is a Thin Wrapper

**Severity:** MEDIUM
**Phase:** 0

**Finding:** `agents.ts` does PATH scanning + process spawning. That's it.

- No agent orchestration
- No memory/context persistence
- No evaluation framework
- Daemon is a 7083-line monolith (`server.ts`)

**Impact:** Limited to single-agent, single-turn interactions. No workflow chaining or parallel tasks.

---

## Gap 5: Media Generation Is API Passthrough

**Severity:** MEDIUM
**Phase:** 4

**Finding:** 96 prompt templates call external APIs. No local generation.

- gpt-image-2 requires OpenAI/Azure key
- Seedance 2.0 requires ByteDance access
- No local image generation
- No image/video editing
- No TTS/STT

**Impact:** Requires API keys and internet. No offline capability for media.

---

## Gap 6: No Linter or Formatter

**Severity:** LOW-MEDIUM
**Phase:** 0

**Finding:** No ESLint, Biome, Prettier, or oxlint configured.

- No `.editorconfig`
- No automated code quality checks beyond TypeScript
- No mutation testing
- No API contract testing

**Impact:** Code style inconsistency. Technical debt accumulates silently.

---

## Gap 7: Security Gaps

**Severity:** HIGH
**Phase:** 0

**Finding:** API is unauthenticated for non-browser clients.

- No rate limiting
- No prompt injection detection
- No CSP for main web app
- Sandboxed iframes use `allow-same-origin`

**Impact:** Open to abuse if deployed on a network. No protection against prompt flooding.

---

## Gap 8: No Collaboration Features

**Severity:** MEDIUM
**Phase:** 5

**Finding:** Single-user, local-first design.

- No real-time collaboration
- No team workspaces
- No RBAC
- Basic commenting system
- No version history

**Impact:** Not usable for teams. Each user works in isolation.

---

## Summary

| Gap | Severity | Phase | Effort |
|-----|----------|-------|--------|
| Design systems are prose | HIGH | 1 | 2 weeks |
| Uneven skill quality | MEDIUM-HIGH | 2 | 2 weeks |
| No web auditing | HIGH | 3 | 2 weeks |
| Thin agent wrapper | MEDIUM | 0 | Part of Phase 0 |
| API-only media | MEDIUM | 4 | 2 weeks |
| No linter/formatter | LOW-MEDIUM | 0 | Part of Phase 0 |
| Security gaps | HIGH | 0 | Part of Phase 0 |
| No collaboration | MEDIUM | 5 | 2 weeks |
