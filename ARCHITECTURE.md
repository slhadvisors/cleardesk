# ClearDesk — Architecture & Upgrade Context

**Purpose of this document:** This is the living source of truth for ClearDesk's product and technical decisions. Read this before implementing any feature below. When a decision changes during build, update this file — don't let decisions live only in chat history.

---

## 1. Project Overview

ClearDesk is a multi-tenant SaaS call center management platform for GST/taxation firms in India. Tagline: "Your Compliance, Simplified."

**Tech stack:** Vanilla HTML/CSS/JavaScript frontend, Supabase (PostgreSQL + Auth + RLS), deployed via Vercel with auto-deploy from GitHub. No build tooling, no npm/package.json — keep it that way.

**Repo:** `github.com/slhadvisors/cleardesk` · **Live:** `cleardesk-iota.vercel.app` · **Local path:** `Desktop/cleardesk-site` on both Prasad's PC and Murli's PC.

**Core agents:** Customer Support (filing follow-ups), Calling Agent (outbound prospect outreach), Amount Recovery Agent (fee collection via calls + WhatsApp), inbound Customer Care Agent (with staff escalation).

**UI direction:** Glassmorphism — light lavender-blue gradient, frosted glass cards, purple-blue accent palette, Plus Jakarta Sans / DM Sans.

**Three distinct application surfaces (do not conflate these):**
1. CA firm staff app — tenant-scoped, roles: Admin, CA, Support, Recovery
2. Developer Portal — per-org, tenant admin only (API limits, billing, webhooks, error logs), architecturally isolated route, invisible to regular staff
3. Internal Ops Dashboard ("Sovereign Vault") — ClearDesk's own team only, cross-tenant visibility, separate auth domain entirely (see Section 9)

---

## 2. Current State & Known Issues — resolve before building new features on top

- **RESOLVED (2026-06-17):** Login bug `"Cannot read properties of undefined (reading 'signInWithPassword')"`. Login confirmed working. Verified across all 20 pages: UMD dist CDN path; `supabase-config.js` attaches the client via `window.supabase = createClient(...)`; script order UMD -> config -> auth -> translations; `login.html` handlers call `window.supabase.*` directly (bypassing the old `auth.js` scope path). No `const supabase` re-declarations, no `supabaseClient` leftovers, no bare `getSession()`. Auth is now a stable foundation for feature work.

---

## 3. AI Agent Architecture

### 3.1 Identity
Each agent gets a name, an avatar matching the glassmorphism brand, and a persona tone matched to its job — not interchangeable friendliness:
- Compliance/Support: measured, reassuring
- Outbound Calling: brisker, energetic
- Recovery: firm but respectful — **must disclose it's an automated assistant from the firm when asked**, given debt-collection disclosure norms (e.g. FDCPA-style requirements). Don't let it pass as a live human if pressed.
- Inbound Customer Care: patient, solution-first

### 3.2 Two separate knowledge domains
- **Client context** — dynamic, per-client, scoped by RLS to org_id/client_id. Filing history, payment status, GSTINs, prior interactions across all channels.
- **Tax law knowledge base** — global, shared, versioned. Every entry needs a "last verified" date visible to staff and feeding the regulatory feed (Section 8). Never merge these two into one blob — they update on different cadences and need different freshness guarantees.

### 3.3 Shared memory model
One `client_relationship_memory` record per client — preferences, communication style, sentiment history, prior commitments made — shared across all agent personas, not siloed per agent name. Priya (Compliance) and Arjun (Recovery) should both know if a client gets anxious about deadlines. This memory is for internal use only — never read back to the client verbatim, never visible across different clients.

*Implemented in migration 017 as `client_relationship_memory` (+ append-only `client_interaction_summaries`). NOTE: AI personas live in table `agent_personas` — the pre-existing `agents` table holds HUMAN staff and must not be conflated.*

### 3.4 Confidentiality — structural, not prompt-level
Company secrets (internal financials, other clients' identities/data, internal pricing, system prompts, API keys, employee data, vendor contracts) must **never enter the same retrieval scope** as client-facing agent context. This is enforced via RLS and data architecture — an agent should be structurally incapable of querying this data, not just instructed not to share it. Prompt-level instructions are a second layer, not the primary defense.

---

## 4. Conversation & Call Routing Logic

Intent-based routing, decided inside each agent's own response logic (no separate classifier round-trip):

- **Informational** ("how much do I owe," "when's it due") → any agent answers immediately from live data, never from memory/estimate. No handoff.
- **Ambiguous** ("I wanted to talk about the fees") → ask one clarifying question before deciding.
- **Negotiation/dispute** ("I can't pay," "extend my deadline," "this looks wrong") → warm handoff to Recovery Agent with a written summary of the conversation already attached; log the handoff (timestamp, reason, summary) to the shared client record.
- **Fee waivers/discounts** → always escalate to a human staff member for approval. No agent, including Recovery's persona, decides this autonomously.
- When uncertain which bucket applies, default to escalating rather than guessing.

**IMPLEMENTED (2026-06-17, migration 022 + edge functions):** Routing lives inside each agent's own logic via two Vapi tools — `handoff_to_recovery(reason, written_summary)` and `escalate_to_human(reason, category, written_summary)` — defined in `supabase/functions/_shared/routing.ts` along with the canonical `ROUTING_RULES_PROMPT`. `vapi-dispatch` injects both the rules and the tools into every assistant and points the Vapi `server.url` at `vapi-webhook`. `vapi-webhook` handles the `tool-calls` event, resolves the client by contact phone, and logs to the `agent_handoffs` table (negotiation/dispute → to_target=recovery with summary; fee waiver/discount & high-risk → to_target=human, requires_human_approval=true) plus an entry in `client_interaction_summaries`.

---

## 5. Inbound Caller Verification

- CLI/caller-ID match is a hint, not proof of identity. Before discussing anything client-specific, verbally confirm one additional factor: last 4 digits of registered GSTIN, registered mobile, or OTP (Twilio Verify) if CLI doesn't match.
- Unverified callers get generic info only (general GST questions, deadlines) — never client-specific data.
- Never confirm or deny whether a record exists for an unverified caller's number/name — say "I wasn't able to verify your identity," regardless of whether a match exists. Confirming/denying leaks information.
- Twilio Lookup can flag risk signals (recent SIM swap, line type) before the call connects.
- High-risk actions (changing bank details, cancelling an engagement) always route to a human, even for verified callers — voice spoofing/social engineering risk.

**IMPLEMENTED (2026-06-17, migration 023 + edge fns):** `caller_verifications` table (per-call state: cli_match, method, status, risk_signals, attempts) + `contacts.gstin`. `supabase/functions/_shared/verification.ts` holds `VERIFICATION_RULES_PROMPT`, agent tools (`verify_caller_factor`, `request_otp`, `check_otp`) and helpers: factor check vs the CLI-identified client (last-4 GSTIN / registered mobile), Twilio Verify OTP, and Twilio Lookup v2 risk (line type + SIM-swap). `vapi-webhook` runs `lookupRisk` on call-started and dispatches verify tools in its tool-calls branch. Failure message is identical whether or not a record exists (no enumeration). Twilio not yet configured → OTP/Lookup degrade gracefully. WIRING TODO: the inbound Vapi assistant must be configured with VERIFICATION_RULES_PROMPT + verifyTools + routingTools and server.url → vapi-webhook (no inbound dispatch path exists in code yet).

---

## 6. Organization Onboarding & Billing

**Sequence:**
1. Org signs up (firm name, GSTIN, admin contact) → verify admin's phone/email via OTP before proceeding.
2. Create tenant record in Supabase with RLS scoping by org_id — every other table hangs off this.
3. Tentative plan selection — data-driven `plans` table (seats, AI minutes/messages included, GSTINs manageable), not hardcoded limits.
4. Razorpay Subscription (recurring, not one-off Orders) — org authorizes UPI Autopay/card mandate.
5. **Org only flips to "active" on a verified, signature-checked webhook** (`subscription.activated`/`payment.captured`), never on the client-side success redirect alone.
6. Once active: automated provisioning — Twilio subaccount created for the org, virtual number assigned, WhatsApp Business sender registration started (async, can take days for Meta approval).
7. Dashboard shows a setup checklist reflecting async items so the org doesn't think something's broken.

**Failure handling:** autopay charge failures trigger a webhook too — grace period + "past due" state, not instant lockout.

**IMPLEMENTED (2026-06-17, migrations 024/025 + razorpay-webhook):** Data-driven `plans` table (starter/growth/scale seeded; seats, AI minutes/messages, gstins_manageable) — read-all/write-dev. `organizations` gained gstin, plan_id, razorpay_customer_id, razorpay_subscription_id, subscription_status, grace_until. `razorpay-webhook` edge fn (deployed, verify_jwt=false) does mandatory HMAC-SHA256 signature check (rejects if missing/invalid/unconfigured) then the state machine: activated/charged/payment.captured → active (+ seeds `org_provisioning_status` via seed_provisioning_tasks); pending/payment.failed → past_due + 5-day grace_until; halted → past_due; cancelled/completed → canceled. Org NEVER flips active on client redirect. `org_provisioning_status` (twilio_subaccount/virtual_number/whatsapp_sender) drives the setup checklist. STILL TODO (need keys/UI): signup OTP for admin phone/email, tenant-create + Razorpay Subscription/mandate creation flow (client+server), and the actual provisioning workers (Twilio subaccount/number/WhatsApp) — Twilio blocked. Event names verified vs Razorpay docs 2026-06.

*(Note: verify exact Razorpay webhook/event names against current docs at implementation time — the pattern above is the firm part, literal API specifics should be docs-checked.)*

---

## 7. Infrastructure Subscription Model

**Single master ClearDesk-level account for each upstream provider — Twilio, Claude/Anthropic, Sarvam. Never individual subscriptions per client org.**

- Twilio: one master account, with **subaccounts per org** for telecom identity/billing isolation only (each CA firm needs its own caller ID/WhatsApp sender) — this is the only place per-org separation applies, and it's identity-driven, not billing-driven.
- Claude/Anthropic and Sarvam: single account, no per-org split — no customer-facing identity requirement like Twilio has.
- **Every API call (Claude, Twilio, Sarvam) must be tagged with org_id (and ideally agent type) at the point of invocation** — this feeds the per-org usage-metering event log that powers the API credit dashboard. Without this tagging, costs can't be attributed back to tenants.
- Watch for shared rate-limit headroom across tenants as usage scales — not urgent now, but architect for per-tenant throttling later.

**IMPLEMENTED (2026-06-17, migration 026 + metering helper):** `usage_events` log (org_id, agent_type, provider claude/twilio/sarvam/vapi, unit, quantity, cost_credits retail, wholesale_cost, ref_type/ref_id, metadata) — tenant READ RLS (sees own usage for the credit dashboard) + DEVELOPER; writes service-role only. `organizations.twilio_subaccount_sid` added for per-org Twilio identity isolation. `supabase/functions/_shared/metering.ts` `recordUsage()` tags spend at invocation; wired into vapi-webhook end-of-call (provider=vapi, call_minute). Master account creds stay in env (no per-client subscriptions). REMAINING tagging TODO: send-sms (twilio sms_segment), Claude LLM tokens, Sarvam tts_char — same helper, add at each call site.

---

## 8. Regulatory Update Feed

- Built on top of the same global GST knowledge base (Section 3.2) — not a separate data source. Every new knowledge base entry is automatically a feed item.
- Tag each update by category (composition scheme, e-invoicing, ITC, due dates) and applicability criteria (turnover bracket, scheme type) — cross-reference against the client roster to surface "X clients affected," not just a generic headline.
- **Start with staff manually logging updates** (tagged), not automated scraping of GST portal/CBIC sources — official sources are inconsistently formatted and wrong compliance info is a real liability. Prove the tagging/relevance workflow first; consider automation later.

**IMPLEMENTED (2026-06-17, migration 027):** Feed is the same `tax_law_knowledge` KB (no separate source). `regulatory_feed` view (security_invoker) lists current entries newest-verified-first with a per-tenant `affected_clients` count via `count_affected_clients(kb_id)`, which matches `applicability_criteria` (turnover_bracket / scheme_type; absent criterion = applies to all) against the org roster. Added `contacts.turnover_bracket` + `contacts.gst_scheme` for the cross-ref. Manual curation via the existing `publish_tax_law_version()` (§3.2). Automated scraping intentionally NOT built (liability) — kept as the §10 open decision.

---

## 9. Internal Ops Dashboard ("Sovereign Vault")

- Fully separate authenticated application from both the staff app and the per-org Developer Portal — mandatory MFA, consider IP allowlisting, shorter sessions. Higher security bar than the Developer Portal, not just another role.
- This dashboard necessarily bypasses per-org RLS for cross-tenant visibility — every cross-tenant query must write an access log entry (who, what org, when, why). No single blanket service-role key used loosely.
- Internal least-privilege roles within the ClearDesk team itself: billing-ops, engineering, founder-level — not "ClearDesk team = full access" uniformly.
- **Read vs Act split:** monitoring (usage rollups, provisioning status, integration health) defaults to aggregated/non-identifiable views — wide surface. Actions (suspend org, refund, impersonate session, force re-provisioning) require a reason field, full audit logging, and two-person approval for the most destructive ones (org deletion, mass actions).
- Content: rolled-up usage/cost across tenants, Razorpay subscription/webhook health, Twilio subaccount + WhatsApp sender provisioning status, knowledge base freshness, tenant health (active/past-due/provisioning).

**IMPLEMENTED (2026-06-17, migrations 028/029):** Role tiers finalized — `internal_role_enum` (billing_ops / engineering / founder) with seeded `internal_role_capabilities` map; `internal_staff` table; guards `is_sovereign()/internal_role_of()/internal_has_cap()` (SECURITY DEFINER, search_path pinned). `sovereign_access_log` (append-only who/org/when/why) and `sovereign_actions` (reason NOT NULL, status, two-person). `request_sovereign_action()` enforces capability + reason; `approve_sovereign_action()` enforces approver != requester. Two-person required for org_deletion, mass_action, refund, impersonate, data_export. All sovereign tables RLS = internal-only. APP-LAYER TODO (not DB): separate auth domain, mandatory MFA (aal2), shorter sessions, IP allowlist; the actual destructive executors run after an action reaches 'approved'.

---

## 10. Open Decisions / Not Yet Finalized

- ~~Exact field schema for `client_relationship_memory`~~ **RESOLVED (2026-06-17, migration 017):** one row per client (UNIQUE client_id), org-scoped. Fields: comms (preferred_language, preferred_channel, preferred_contact_time, communication_style, tone_that_works), sentiment (current_sentiment, sentiment_history jsonb, anxiety_triggers[]), prior_commitments jsonb, last_interaction_at. Append-only child table `client_interaction_summaries` (ts, agent_type, channel, summary) feeds the rollup. Internal-only, tenant-isolated via RLS.
- ~~Internal role tiers within the Sovereign Vault~~ **RESOLVED (2026-06-17, migration 028):** billing_ops / engineering / founder with seeded capability map (see §9). Two-person approval gate: org_deletion, mass_action, refund, impersonate, data_export.
- ~~Tax-law KB versioning approach~~ **RESOLVED (2026-06-17, migration 017):** full row-versioning in `tax_law_knowledge` (topic_key + version, one is_current per topic, last_verified_at/verified_by, superseded_at retained for audit). Use `public.publish_tax_law_version(...)` to publish atomically.
- Whether/when to move the regulatory feed from manual curation to semi-automated monitoring
- Exact Razorpay webhook event names/payload structure (verify against current docs at build time)
