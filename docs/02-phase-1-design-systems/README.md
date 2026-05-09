# Phase 1: Design System Overhaul

**Status:** ⏳ Pending
**Goal:** Machine-parseable, component-integrated design systems
**Estimated Effort:** 2 weeks

---

## Overview

The 146 design systems are currently Markdown prose. This phase converts them to machine-parseable tokens and integrates with real component libraries.

---

## Agent Tasks

### Agent 1: P1-token-compiler — Build Token Compiler

**Input:** `design-systems/*/DESIGN.md` (146 files)
**Output:** `packages/tokens/src/compiler.ts`

Build a compiler that reads DESIGN.md prose and outputs:
- **CSS custom properties** (`:root { --color-primary: #08090a; --space-4: 16px; }`)
- **Tailwind config** (`tailwind.config.ts` with `extend` for colors, spacing, fonts, shadows)
- **JSON tokens** (Style Dictionary format for tooling)

The compiler must parse:
- Color palette (hex, HSL, semantic roles like "primary", "surface", "text")
- Typography scale (family, size px/rem, weight, line-height, letter-spacing)
- Spacing scale (base unit, multipliers)
- Shadow definitions (full CSS box-shadow values)
- Border radius scale
- Component-specific tokens (button padding, card radius, etc.)

**Verification:** `npx tsx packages/tokens/src/compiler.ts --all` processes all 146 systems without errors.

### Agent 2: P1-redesign-stubs — Expand Tier 2 Design Systems

**Input:** 59 template stub design systems (~71 lines each)
**Output:** 59 expanded DESIGN.md files (200+ lines each)

Each stub needs:
- **Dual-mode colors** — light AND dark mode palettes with semantic roles
- **Accessibility tokens** — contrast ratios for every text/background pair, focus ring colors
- **Motion tokens** — duration (fast/normal/slow), easing curves, reduced-motion variants
- **Responsive breakpoints** — mobile/tablet/desktop/wide values
- **Component state definitions** — hover/focus/active/disabled for buttons, inputs, links
- **Real typography scale** — not just font names, but full size/weight/line-height specs

**Verification:** `design-system validate` passes on all 59 expanded systems.

### Agent 3: P1-component-map — shadcn/ui Component Mapping

**Input:** All 146 design systems
**Output:** `design-systems/*/components.json` (146 files)

For each design system, create a `components.json` that maps to shadcn/ui components:
```json
{
  "button": {
    "primary": { "bg": "#08090a", "text": "#f7f8f8", "radius": "6px", "shadow": "..." },
    "secondary": { ... },
    "ghost": { ... },
    "destructive": { ... }
  },
  "card": { "bg": "...", "radius": "...", "shadow": "...", "border": "..." },
  "input": { "bg": "...", "border": "...", "focus": "..." },
  "navigation": { ... }
}
```

**Verification:** All 146 `components.json` files are valid JSON and cover at least button, card, input.

### Agent 4: P1-validator — Build Design System Validator

**Output:** `packages/tokens/src/validator.ts`

CLI: `design-system validate <slug>` or `design-system validate --all`

Checks:
- All 9 required sections present
- Color tokens include hex values AND contrast ratios
- Typography includes size + weight + line-height (not just font name)
- Responsive breakpoints defined
- Dark mode variant exists
- Accessibility tokens present
- Motion tokens defined
- Component states defined

**Verification:** Runs on all 146 systems. Reports pass/fail with specific missing items.

---

## Verification Criteria

- [ ] Token compiler processes all 146 design systems without errors
- [ ] Generated CSS variables are valid CSS
- [ ] Generated Tailwind config is valid TypeScript
- [ ] All 59 stubs expanded to 200+ lines with full specs
- [ ] Validator passes on all design systems
- [ ] shadcn/ui component mapping covers button, card, input, nav for all systems

---

## Commit Message

```
feat(phase-1): design system overhaul — token compiler, expanded specs, component mapping
```

---

## How to Resume

1. Check SESSION-STATE.md for Phase 1 status
2. Re-spawn agents for incomplete work
3. After all agents complete, run verification
4. Commit and push
5. Move to Phase 2
