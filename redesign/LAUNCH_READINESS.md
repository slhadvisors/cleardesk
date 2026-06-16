# ClearDesk — Launch-Readiness Audit

**Reviewer role:** Full-stack engineer + designer
**Date:** 15 June 2026
**Scope reviewed:** entire production codebase (`cleardesk-site/`) — HTML pages, `auth.js`, `supabase-config.js`, `api/`, `supabase/functions/`, `supabase/migrations/`, `vercel.json`. Dev portal and ops vault reviewed for security only (UI untouched per instruction).

---

## Architecture in one picture

Static HTML/CSS/JS hosted on Vercel. Supabase is the backend (Postgres + Auth + RLS + Edge Functions). `app.html` is a React SPA transpiled **in the browser** by Babel Standalone. Shared client logic lives in `auth.js`, `sidebar-shared.js`, `sandbox-guard.js`, `cache.js`, `translations.js`. Server logic is split between **Supabase Edge Functions** (`send-sms`, `vapi-dispatch`, `vapi-webhook`, `crm-webhook`, `send-invite`, `accept-invite`, `sync-contacts`, `deadline-reminder`, `generate-insights`, `cache-proxy`) and **one Vercel function** (`api/send-message.js`). Three UI pillars: client app (`app.cleardesk.com`), settings, and the Sovereign Ops Vault (`ops.cleardesk.com`, host-routed in `vercel.json`). Goal: AI outreach automation (voice/WhatsApp/SMS) for CA firms across IN/US/AE with per-tenant isolation, credit/budget control, and 7-day data retention.

The architecture is sound. The blockers are in **security correctness** and a few **incomplete/dead UI paths** — not the overall design.

---

## P0 — Must fix before launch (security / data integrity)

### P0-1 · Cross-tenant data breach via client-writable `user_metadata`  ✅ fix supplied
RLS policies in migrations **003, 004, 007, 008, 009** (and the DEVELOPER check in **005**) trust `auth.jwt() -> 'user_metadata' ->> 'organization_id'` (and `... ->> 'user_role'`) as a fallback. `user_metadata` is **client-writable** — any signed-in user can run `supabase.auth.updateUser({ data: { organization_id: '<victim-org-uuid>', user_role: 'DEVELOPER' } })` and then read/write **another firm's** contacts, SMS logs, call logs, financial insights and webhook logs, and reach the **ops vault** as a fake DEVELOPER.
**Impact:** full multi-tenant breach + privilege escalation. This is the single biggest launch blocker.
**Fix:** `supabase/migrations/016_tenant_isolation_hardening.sql` (added in this pass) redefines `is_developer()` and recreates every tenant policy to read **`app_metadata` only** (set server-side by the signup trigger in 012, not client-writable). Apply it, then run the included verification query — it should return zero policies referencing `user_metadata`. Also confirm the bootstrap `organizations` / `outbound_campaigns` policies (CLAUDE.md schema currently shows them using `user_metadata`) are recreated the same way.

### P0-2 · App role was never read correctly  ✅ fixed
`auth.js` computed the role as `user.role || app_metadata.user_role`. In supabase-js v2, `user.role` is the **Postgres** role and is always `'authenticated'`, so the real app role was never reached — and `'authenticated'` isn't in `ROLE_HIERARCHY`, so `hasMinimumRole()` returned `-1 <= n` = **true for everyone**, silently passing admin-only client gates.
**Fix applied:** `auth.js` now reads `app_metadata.user_role` first. (Client gating is defense-in-depth; the real enforcement is RLS in P0-1.)

### P0-3 · `api/send-message.js` is unauthenticated (and unused)
The Vercel function sends WhatsApp/SMS via Twilio with **no auth, no rate limit, no org/budget check, no Twilio signature** — anyone who finds the URL can spend the firm's Twilio balance. The frontend doesn't call it (campaigns use the `send-sms` / `vapi-dispatch` edge functions instead).
**Recommendation:** delete `api/send-message.js`, **or** if it must stay, require a valid Supabase JWT, resolve `organization_id` server-side, and run the cost circuit-breaker from CLAUDE.md §10 before sending. Don't ship two divergent send paths.

### P0-4 · Verify the cost circuit-breaker actually wraps outbound calls
CLAUDE.md §10 defines `enforceProgrammaticCircuitBreaker`, but confirm `vapi-dispatch` and `send-sms` call it (and decrement/limit by `organizations.credit_balance` + overdraft) **before** firing. Without it, a runaway campaign can bill unbounded Twilio/Vapi spend. (Edge function bodies weren't all reviewed line-by-line here — make this an explicit pre-launch check.)

---

## P1 — Should fix before launch

- **Legal pages are dead links.** `index.html` footer links Privacy Policy, Terms, Security, About, Blog all to `href="#"`. For a compliance product handling client PII across GDPR (EU/UK), India DPDP, and UAE, real **Privacy Policy + Terms + DPA** pages are effectively mandatory. Create `privacy.html`, `terms.html`, `security.html` and wire them.
- **In-browser Babel in `app.html` / `app-react.html`.** Shipping `@babel/standalone` and transpiling JSX on every page load is slow (blocks first paint) and not production-grade. Precompile (the planned Next.js migration solves this; short-term, a build step or prebuilt bundle).
- **Twilio webhook signature validation.** `crm-webhook` verifies HMAC (good). Confirm `vapi-webhook` and any Twilio status callbacks validate the `X-Twilio-Signature` — otherwise status/result endpoints can be spoofed.
- **Schema/code drift in `auth.js` fallback.** The fallback query selects `organizations(name, subdomain)`, but the documented schema uses `firm_name` and has no `subdomain`. If that fallback ever runs it throws. Align the column names.
- **Security headers are ops-only.** `vercel.json` sets `X-Frame-Options`, `nosniff`, etc. **only** for `/ops.html`. Apply a baseline CSP + these headers to all client routes too.

---

## P2 — Polish / post-launch

- **Dead button:** `team-management.html` → `editMember()` shows "Edit role coming soon". Either implement the role-edit modal (calls an admin edge function) or hide the action until ready.
- **`landing.html`** is a redirect stub to `index.html` — fine, just confirm it's intentional.
- **Orphaned file** `.fuse_hidden0000000b00000001` (40 KB HTML) is a stray editor artifact; remove from the working tree.
- **`app.html` vs `app-react.html`** — two dashboard implementations exist. Pick one canonical file to avoid drift.
- **Accessibility/perf sweep** (the redesign already raises the bar): run Lighthouse, verify focus order, reduced-motion, and contrast on the live pages.

---

## What I changed in this pass
1. `auth.js` — corrected app-role detection (P0-2).
2. `supabase/migrations/016_tenant_isolation_hardening.sql` — new migration that closes the cross-tenant / privilege-escalation hole (P0-1). **Review and apply it to Supabase**, then run its verification query.

Everything else above is documented rather than auto-changed, because it needs decisions (delete vs secure the Vercel endpoint), real legal content, or edge-function changes that should be tested against your Supabase project before deploy.

---

## Suggested launch checklist (order)
1. Apply migration 016; run verification query (zero `user_metadata` policies). Re-test all three roles + a cross-tenant attempt.
2. Decide on `api/send-message.js` (delete or secure).
3. Confirm circuit-breaker wraps `vapi-dispatch` + `send-sms`.
4. Add Privacy/Terms/DPA pages; wire footer.
5. Validate all inbound webhooks' signatures.
6. Precompile the React dashboard (or proceed with the Next.js migration in `PLAN.md`).
7. Global security headers + CSP.
8. Lighthouse + a11y pass on the redesigned UI.
