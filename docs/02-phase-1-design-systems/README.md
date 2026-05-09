# Phase 1: Design System Overhaul

**Status:** ⏳ Pending
**Goal:** Machine-parseable, component-integrated design systems

## Tasks

### 1. Token Compiler
Build `packages/tokens/src/compiler.ts` that converts DESIGN.md prose to:
- CSS custom properties (`--color-primary`, `--space-4`)
- Tailwind config (`tailwind.config.ts`)
- JSON tokens (Style Dictionary format)

### 2. Expand Tier 2 Stubs
59 template stubs (~71 lines each) need:
- Dual-mode (light + dark) color tokens
- Accessibility tokens (contrast ratios, focus patterns)
- Motion tokens (duration, easing, reduced-motion)
- Responsive breakpoint tokens
- Component state definitions
- Real typography scales

### 3. Component Mapping
For each design system, create `components.json` mapping to shadcn/ui:
- Button variants, Card styles, Input styles
- Brand-specific overrides (colors, radius, shadows)

### 4. Design System Validator
CLI: `design-system validate <slug>` — checks completeness of all 9 sections, token coverage, a11y, responsive, dark mode.

## Verification
- [ ] Token compiler processes all 146 design systems
- [ ] Generated CSS variables are valid
- [ ] All 59 stubs expanded
- [ ] Validator passes on all systems
- [ ] shadcn/ui component mapping covers major components

## Agents
- P1-token-compiler: Build the compiler
- P1-redesign-stubs: Expand 59 stubs
- P1-component-map: shadcn/ui mapping
- P1-validator: Build validator CLI
