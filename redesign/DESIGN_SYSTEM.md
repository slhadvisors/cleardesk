# ClearDesk — Design System

**Direction:** Light-first, navy + a single teal-blue accent. Calm, precise, premium-enterprise.
**Targets:** WCAG 2.1 AA. Token-driven. Maps 1:1 to `tailwind.config.ts`.

---

## 1. Design principles
1. **Restraint signals trust.** One accent. Color carries meaning, never decoration.
2. **Precision over flourish.** Crisp 1px borders, tabular figures, fast motion. No bounce, no glow.
3. **Whitespace is a feature.** Let dense financial data breathe.
4. **Hierarchy by weight & space**, not by color.
5. **Accessible by construction.** Every fg/bg pair ≥ 4.5:1; visible focus everywhere.

---

## 2. Color tokens

### Brand & accent
| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand` | `#0B1F3A` | `#E8EEF6` | Logo, primary ink |
| `--accent` | `#1E6FE0` | `#4D94FF` | Primary buttons, active nav, links, focus |
| `--accent-hover` | `#1A5FC4` | `#6AA8FF` | Hover state |
| `--accent-soft` | `#EAF1FC` | `#11233D` | Accent-tinted backgrounds, selected rows |

### Neutrals (the workhorses)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F8FAFC` | `#0A0F1A` | App canvas |
| `--surface` | `#FFFFFF` | `#111827` | Cards, sidebar, modals |
| `--surface-2` | `#F1F5F9` | `#1B2433` | Subtle fills, table header |
| `--border` | `#E2E8F0` | `#222C3D` | Hairlines, dividers |
| `--border-strong` | `#CBD5E1` | `#33415A` | Inputs, focus base |
| `--text` | `#0B1F3A` | `#F1F5F9` | Primary text |
| `--text-muted` | `#475569` | `#9AA8BD` | Secondary text (≥4.5:1) |
| `--text-subtle` | `#64748B` | `#6B7A91` | Captions, placeholders (large/secondary only) |

### Semantic (status only)
| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--success` | `#0F9D58` | `#34D399` | Completed, delivered, active |
| `--warning` | `#B45309` | `#FBBF24` | Pending, due soon |
| `--danger` | `#DC2626` | `#F87171` | Failed, overdue, destructive |
| `--info` | `#1E6FE0` | `#4D94FF` | Neutral notices |

> Status colors always pair with an icon or text label — never color alone (colorblind-safe).

**On-soft text variants (for small status text on tinted pills).** The base semantic colors are tuned for icons and larger glyphs (≥3:1). For small bold pill *text* on a `*-soft` background, use these darker foregrounds to clear AA (4.5:1) for small text:
`--accent-on-soft #1A5FC4` · `--success-on-soft #0A6B3A` · `--warning-on-soft #92400E` · `--danger-on-soft #B91C1C`. (All verified ≥5.3:1 against their soft backgrounds.)

---

## 3. Typography
- **UI / body:** Inter (variable). **Numerals / IDs / amounts:** IBM Plex Mono *or* Inter with `font-variant-numeric: tabular-nums`.
- Base 16px, line-height 1.5 body / 1.25 headings. Measure 60–75ch for prose.

| Role | Size / LH | Weight |
|---|---|---|
| Display | 36 / 1.1 | 700 |
| H1 | 28 / 1.2 | 700 |
| H2 | 22 / 1.25 | 600 |
| H3 | 18 / 1.3 | 600 |
| Body | 16 / 1.5 | 400 |
| Body-sm | 14 / 1.5 | 400 |
| Label | 13 / 1.4 | 500 |
| Caption / overline | 12 / 1.4 | 500, +0.04em, uppercase for overlines |

Financial figures use **tabular numerals** so columns and tickers never reflow.

---

## 3a. Spatial UI layer

The interface uses a **spatial / layered-material model** (visionOS-inspired) for a premium, depth-rich feel — applied with restraint so it never tips back into the heavy "glassmorphism everywhere" look we're leaving behind.

**Canvas as the back plane.** The app background is a soft off-white (`--bg #EAEFF7`) with very low-opacity radial gradients (cool blue/violet) anchored to the corners, `background-attachment: fixed`. This gives floating surfaces something to cast depth against.

**Materials (translucent surfaces).** Floating elements use a frosted material rather than flat white:
`--mat rgba(255,255,255,.72)` · `--mat-2 rgba(255,255,255,.55)` · `--mat-hi rgba(255,255,255,.85)`, each with `backdrop-filter: saturate(160%) blur(22px)`. Reserve material for *structural floating layers* — sidebar, topbar, cards, panels, modals, dropdowns. Content that needs maximum legibility (inputs, table bodies, dense figures) stays on solid `--surface`.

**Glass edge.** Every material panel carries a top inner highlight to read as a physical pane:
`--glass-edge: inset 0 1px 0 rgba(255,255,255,.7), inset 0 0 0 1px rgba(255,255,255,.35);` applied alongside its drop shadow.

**Detached layout.** The shell is composed of floating panels separated by 16px gutters (sidebar and topbar are detached cards with their own radius and shadow), not edge-to-edge chrome — reinforcing the sense of layers hovering above the canvas.

**Depth shadows (3-tier, multi-layer).** Depth comes from stacked soft shadows, not glow:
- `--e1` `0 1px 2px rgba(11,31,58,.04), 0 10px 28px -14px rgba(11,31,58,.22)` — resting panels
- `--e2` `0 2px 8px rgba(11,31,58,.06), 0 22px 50px -18px rgba(11,31,58,.32)` — hover / dropdowns
- `--e3` `0 8px 20px rgba(11,31,58,.10), 0 40px 90px -26px rgba(11,31,58,.45)` — modals (top layer)

**Motion = elevation change.** Interactive cards lift on hover (`translateY(-3px)` + e1→e2, 220ms `--ease-out`). Modals/sheets scale up from their trigger. No parallax beyond a subtle fixed background; movement always reads as "this came forward," never decoration.

**Accessibility & fallbacks (required).**
- Honor `prefers-reduced-transparency` / `prefers-contrast`: swap `--mat*` to solid `--surface` and drop `backdrop-filter` so text contrast never depends on what's behind the pane.
- Honor `prefers-reduced-motion`: disable lift/scale transitions.
- Text and controls always sit on a surface that independently meets 4.5:1 — translucency is a finish, never load-bearing for legibility.
- Provide a non-blur fallback for browsers without `backdrop-filter` (raise material opacity to ~0.92).

```css
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  :root { --mat:#fff; --mat-2:#fff; --mat-hi:#fff; }
  .sidebar,.topbar,.panel,.kpi,.card { backdrop-filter:none; -webkit-backdrop-filter:none; }
}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))) {
  :root { --mat:rgba(255,255,255,.94); --mat-2:rgba(255,255,255,.92); }
}
```

In dark mode the same model uses dark translucent materials (`rgba(17,24,39,.62)`) with a faint light top-edge and border-driven separation instead of heavy shadow.

---

## 4. Spacing, radii, elevation
- **Spacing scale (4/8px):** 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- **Radii:** `--r-sm 8px` (inputs, chips) · `--r-md 12px` (buttons, cards) · `--r-lg 16px` (panels, modals) · `--r-pill 999px`. *(Down from today's 22–30px — calmer, more enterprise.)*
- **Elevation (soft, not glowing):**
  - `--e-1` `0 1px 2px rgba(11,31,58,.06)` — cards at rest
  - `--e-2` `0 4px 12px rgba(11,31,58,.08)` — hover, dropdowns
  - `--e-3` `0 16px 40px rgba(11,31,58,.14)` — modals
  - Dark mode uses border + subtle lift, not heavy shadow.

---

## 5. Motion
- Durations: 120ms (micro), 180ms (default), 240ms (enter), exits ~70% of enter.
- Easing: `--ease-out cubic-bezier(0.22,1,0.36,1)` enter · `--ease-in cubic-bezier(0.4,0,1,1)` exit. **No spring/overshoot.**
- Animate `transform` + `opacity` only. Respect `prefers-reduced-motion`.
- Numeric KPIs may use a count-up on load (instant when reduced-motion).

---

## 6. Core components (shadcn/ui, themed)
- **Button** — Primary (accent fill, white text), Secondary (surface + border), Ghost (text), Destructive (danger). Height 40px (44px touch), `--r-md`, loading spinner + disabled at submit.
- **Input / Select / Textarea** — surface bg, `--border-strong`, label always visible above, helper text below, accent focus ring (2px), inline validation on blur, error text + `aria-live`.
- **Card / Panel** — surface, 1px border, `--e-1`, 20–24px padding, optional header row with title + action.
- **Table** — sticky `--surface-2` header, row hover `--accent-soft`, sortable headers with `aria-sort`, zebra optional, sticky first column on mobile, empty + loading (skeleton) states.
- **Badge / Status pill** — soft semantic bg + icon + label.
- **Tabs, Dialog/Sheet, DropdownMenu, Toast** (aria-live, auto-dismiss 4s), **Tooltip**, **Skeleton**, **EmptyState** (icon + message + CTA).
- **AppShell** — collapsible left sidebar (active item: accent text + 3px accent indicator + `--accent-soft` bg), topbar (search, org switcher, notifications, avatar menu, theme toggle), mobile bottom nav ≤5.

---

## 7. Accessibility checklist
- Contrast ≥ 4.5:1 text / ≥ 3:1 large & UI glyphs (all pairs above verified).
- Visible focus ring (2px accent, 2px offset) on every interactive element.
- Touch targets ≥ 44×44.
- Icon-only buttons have `aria-label`; status never color-only.
- Full keyboard nav, logical tab order, skip-to-content link.
- `prefers-reduced-motion` + dynamic type respected.

---

## 8. Tailwind config mapping (excerpt)
```ts
// tailwind.config.ts — colors reference CSS vars so light/dark swap via class
theme: {
  extend: {
    colors: {
      brand: 'var(--brand)',
      accent: { DEFAULT: 'var(--accent)', hover: 'var(--accent-hover)', soft: 'var(--accent-soft)' },
      bg: 'var(--bg)', surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)' },
      border: { DEFAULT: 'var(--border)', strong: 'var(--border-strong)' },
      text: { DEFAULT: 'var(--text)', muted: 'var(--text-muted)', subtle: 'var(--text-subtle)' },
      success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', info: 'var(--info)',
    },
    borderRadius: { sm: '8px', md: '12px', lg: '16px', pill: '999px' },
    boxShadow: { e1: '0 1px 2px rgba(11,31,58,.06)', e2: '0 4px 12px rgba(11,31,58,.08)', e3: '0 16px 40px rgba(11,31,58,.14)' },
    fontFamily: { sans: ['Inter','-apple-system','sans-serif'], mono: ['IBM Plex Mono','monospace'] },
  }
}
```
CSS variables are defined under `:root` (light) and `.dark` (dark), so theming is a single class toggle via `next-themes`.
