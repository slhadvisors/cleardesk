# ClearDesk — UI Redesign & Stack Migration Plan

**Author:** Lead Frontend / UX Architect
**Date:** 15 June 2026
**Scope:** Client-facing application only. The Developer Portal (`developer/*`, `developer-portal.html`) and the Sovereign Ops Vault (`ops.html`) are **explicitly out of scope and untouched.**

---

## 1. The problem in one sentence

ClearDesk is a serious compliance-automation product for Chartered Accountancy firms, but the current UI reads as a consumer "vibe-coded" app — neon-lime on near-black, heavy glassmorphism, 24px radii and bouncy spring physics — which actively undermines the trust an accounting firm needs to feel before handing over client data and outbound calling.

The redesign goal: make ClearDesk look and feel like a **premium, calm, precise AI product an accountant would trust** — closer to Mercury, Ramp, Stripe Dashboard, and Linear than to a gaming overlay.

---

## 2. What's there today (audit)

| Area | Files | State |
|---|---|---|
| Marketing site | `index.html` (1,558 lines) | Dark neon hero |
| Auth | `login.html`, `invite.html`, `reset-password.html` | Glass cards, dark |
| Workspace | `app.html` (1,271 lines, React via in-browser Babel) | Dashboard |
| Campaigns | `campaigns.html` (1,055) | Largest feature |
| Data views | `contacts.html`, `call-logs.html`, `sms-logs.html` | Tables |
| People | `team-management.html`, `agent-detail.html` | |
| Account | `settings.html` (1,434), `profile.html` (1,273) | |
| Misc | `project-phases.html`, `style-guide.html` | |
| Shared | `theme-hub.css` (1,791), `sidebar-shared.js` (570) | Design layer |
| **Untouched** | `ops.html`, `developer/*`, `developer-portal.html` | **Leave as-is** |

### Key problems found
1. **Aesthetic mismatch.** Electric-lime `#a3ff12` + neon cyan + coral on `#080c14` is a gamer/crypto palette, not an enterprise-fintech one. Spring easing `cubic-bezier(0.68,-0.6,0.32,1.6)` makes everything bounce — the opposite of "precise."
2. **Performance debt.** `app.html` ships React + ReactDOM + **Babel Standalone** and transpiles JSX *in the browser* on every load. This is slow, blocks first paint, and is not production-grade.
3. **Duplication.** The sidebar, topbar, and theming are hand-injected via `sidebar-shared.js` string templates and repeated token blocks across 14 files. Every change touches many files; drift is inevitable (two parallel token sets already exist: inline in `index.html` and in `theme-hub.css`).
4. **Inconsistent tokens.** `theme-hub.css` already carries "legacy tokens (backwards compat)" beside new ones — a sign the system has been patched rather than designed.
5. **No real component library.** Cards, tables, buttons, and forms are restyled per page.

---

## 3. Recommended stack (decided)

**Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui**, deployed on Vercel (already the host).

Why this is the right call here:
- **shadcn/ui** gives accessible, unstyled-by-default primitives (Dialog, Table, Tabs, Toast, Form, DropdownMenu) that we theme once with our tokens — eliminating per-page restyling.
- **Tailwind** turns the design system into enforceable tokens (`bg-surface`, `text-muted`, `rounded-card`) so "no hardcoded hex" becomes structural, not a guideline.
- **Next.js** removes in-browser Babel entirely (real build step), enables route-level code splitting, server components for the data-heavy tables, and keeps the Supabase + Vercel deploy story intact.
- One `<AppShell>` component replaces `sidebar-shared.js` — sidebar/topbar defined once.

### Supporting libraries
- **@supabase/ssr** for auth/session (replaces the CDN UMD + global `window.supabase` pattern; keeps RLS model identical).
- **lucide-react** for icons (replaces Material Symbols web-font; SVG, themeable, no FOIT).
- **TanStack Table** for sortable/filterable logs (contacts, calls, SMS).
- **Recharts** for the dashboard charts (call volume, campaign outcomes).
- **next-themes** for light/dark.
- **Inter** (UI) + **IBM Plex Mono** / tabular numerals for figures and IDs.

### Migration approach: the Strangler pattern
We do **not** rewrite all 14 pages before shipping anything. Instead:
1. Stand up the Next.js app alongside the current static site.
2. Build the design system + `AppShell` + shared components first.
3. Migrate pages route-by-route, highest-value first (Login → Dashboard → Campaigns → tables → settings).
4. Vercel rewrites send migrated routes to Next.js and leave `ops.html` / `developer/*` served as static files, untouched.

This keeps the product shippable at every step and de-risks the ops/dev carve-out.

---

## 4. Visual direction (decided): Light-first, navy + one accent

**Mood:** trustworthy, calm, precise, quietly premium. Generous whitespace, restrained color, crisp 1px borders, soft (not glowing) shadows, fast linear-ish motion.

- **Canvas:** warm off-white `#F8FAFC` / pure white surfaces.
- **Ink:** deep navy `#0B1F3A` for primary text and the brand.
- **Accent:** a single confident **teal-blue `#1E6FE0`** for primary actions and active states (one accent, used sparingly — the discipline is the point).
- **Semantics:** success/green, warning/amber, danger/red reserved strictly for status — never decoration.
- **Dark mode:** built from the same token set (light is default), shipped as first-class but secondary.

Full specification lives in `DESIGN_SYSTEM.md`. Two viewable reference pages (`reference/login.html`, `reference/dashboard.html`) implement it so you can approve the language before rollout. The tokens in those files map 1:1 to the planned `tailwind.config.ts`.

---

## 5. Information architecture (kept, refined)

Navigation stays close to today's mental model (Dashboard, Campaigns, Contacts, Calls, SMS, Teams, Agents, Settings, Profile) but is regrouped for clarity:

- **Overview** — Dashboard
- **Outreach** — Campaigns, Contacts
- **Activity** — Calls, SMS
- **Workspace** — Teams, Agents
- **Account** — Settings, Profile (in user menu, not main rail)

Desktop: persistent left sidebar (collapsible to icons). Mobile: bottom nav (≤5 items: Dashboard, Campaigns, Contacts, Calls, More).

---

## 6. Phased roadmap

**Phase 0 — Foundation (this deliverable + setup)**
Plan, design system spec, two reference pages. Then: scaffold Next.js, port tokens into `tailwind.config.ts`, install shadcn, configure Supabase SSR auth, build `AppShell`.

**Phase 1 — Auth & entry**
Login, invite, reset-password, marketing landing hero refresh.

**Phase 2 — Core workspace**
Dashboard (KPIs, charts, recent activity), then Campaigns (the flagship — manual batch + automated modes, script editor, tone selector).

**Phase 3 — Data surfaces**
Contacts, Call logs, SMS logs on TanStack Table with sort/filter/empty/loading states.

**Phase 4 — People & account**
Teams, Agent detail, Settings, Profile.

**Phase 5 — Polish & QA**
Dark mode pass, reduced-motion, full a11y audit (WCAG 2.1 AA), responsive sweep at 375/768/1024/1440, Lighthouse.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Auth regression during Supabase SSR swap | Migrate auth first behind a feature route; keep RLS/JWT model identical; test all three roles. |
| Ops/Dev portals accidentally restyled | They stay static; Vercel rewrites only route migrated paths. No shared CSS import. |
| Scope creep across 14 pages | Strangler pattern — ship route-by-route, reference pages gate the visual language first. |
| Tabular data perf | Server components + virtualized tables for 1k+ rows. |
| Brand recognition shock | Keep IA and naming; change the *skin*, not the *map*. |

---

## 8. Success criteria
- A CA firm partner's first reaction is "this looks like enterprise software," not "this looks like an app."
- Lighthouse: Performance ≥ 90, Accessibility ≥ 95.
- Zero hardcoded hex in components (tokens only).
- One source of truth for shell/components (no per-page restyling).
- Dev portal and Ops vault visually and functionally unchanged.
