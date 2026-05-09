# Design Systems Audit — nexu-io/open-design

**Audited:** 2026-05-09
**Total:** 146 design systems in `design-systems/`

## Structure

Each design system is a single `DESIGN.md` file — no folders with CSS, JSON, or component code.

## Two Tiers of Quality

### Tier 1: Rich Product Systems (~70 systems, 200-1000+ lines)
Source: `VoltAgent/awesome-design-md` (the `getdesign` npm package)

Examples: linear-app (370 lines), stripe (331 lines), vercel, apple, notion, airbnb (393 lines), starbucks (583 lines), urdu (1001 lines)

Each has the full 9-section structure:
1. Visual Theme & Atmosphere
2. Color Palette & Roles
3. Typography Rules
4. Component Stylings
5. Layout Principles
6. Depth & Elevation
7. Do's and Don'ts
8. Responsive Behavior
9. Agent Prompt Guide

**Quality:** Genuinely detailed. Directly implementable by an agent. Includes exact CSS values, pixel measurements, font metrics.

### Tier 2: Template/Short Systems (~59 systems, ~71 lines each)
Source: `bergside/awesome-design-skills`

Examples: neobrutalism, glassmorphism, claymorphism, retro, shadcn, agentic, bold, brutalism

**Quality:** Minimal boilerplate. Only colors and font families differ. Sections 4-9 nearly identical across all 59. NOT implementable — an agent would have to improvise everything beyond the color palette.

### Tier 0: Hand-Authored Starters (~3 systems)
`default`, `warm-editorial`, `atelier-zero` — concise style guides.

## Token Definition Format

**All tokens are defined in Markdown prose — NOT in CSS variables, Tailwind config, or JSON.**

For Tier 1, tokens are in narrative paragraphs and tables:
- Colors: Hex values inline in prose (`#08090a`)
- Typography: Full tables with px/rem/weight/line-height/letter-spacing
- Spacing: Base unit and scale
- Shadows: Full CSS declarations
- Border radius: Named scale

For Tier 2, tokens are minimal:
- 7-8 color tokens
- Font family names (no size/weight specifics)
- Generic spacing scale

## What's Missing

- **No machine-parseable tokens** — everything is prose
- **No component library integration** — no references to shadcn/ui, Radix
- **No dark mode toggle specs** — Linear is dark, Stripe is light, none define both
- **No accessibility tokens** — no ARIA patterns, no contrast ratios
- **No animation/motion specs** — generic "150-250ms" only
- **No component state definitions** — hover/focus/active/disabled mentioned in passing
- **No responsive breakpoint tokens**

## Device Frames

5 pixel-accurate HTML files in `assets/frames/`:
- iPhone 15 Pro (390×844)
- Android Pixel (412×900)
- iPad Pro (1024×1366)
- MacBook (1440×900)
- Browser Chrome

Each accepts `?screen=<path>` query parameter. Production quality.

## Prompt Templates

96 templates (46 image + 50 video) in JSON format:
- Image: Structured JSON prompts for gpt-image-2
- Video: Cinematic narratives for Seedance 2.0
- HyperFrames: HTML+GSAP compositions for headless Chrome

**Quality:** Genuinely high — detailed, specific, with source attribution.
