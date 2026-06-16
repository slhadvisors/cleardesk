-- ============================================================
-- Migration 016: TENANT ISOLATION HARDENING  (P0 SECURITY FIX)
-- ============================================================
-- PROBLEM
--   Several RLS policies (003, 004, 005, 007, 008, 009) trust
--   `auth.jwt() -> 'user_metadata' ->> 'organization_id'` and
--   `... -> 'user_metadata' ->> 'user_role'` as a FALLBACK.
--
--   `user_metadata` is CLIENT-WRITABLE: any signed-in user can call
--   supabase.auth.updateUser({ data: { organization_id, user_role } })
--   and rewrite those claims in their own JWT. That lets a user:
--     • read/write ANOTHER firm's contacts, SMS logs, call logs,
--       financial insights and webhook logs   (cross-tenant breach)
--     • self-grant user_role = 'DEVELOPER' and reach the ops vault
--       (privilege escalation)
--
-- FIX
--   Trust ONLY `app_metadata`, which is set server-side by the signup
--   trigger (012) via the admin API and CANNOT be modified by the client.
--   This migration redefines is_developer() and recreates every tenant
--   policy to read organization_id from app_metadata exclusively.
--
--   Idempotent: safe to run more than once. Run in the Supabase SQL
--   editor (or via `supabase db push`) and verify with the checks at
--   the bottom.
-- ============================================================

-- ── 1. Hardened DEVELOPER check (app_metadata only) ─────────────────
CREATE OR REPLACE FUNCTION public.is_developer()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'user_role') = 'DEVELOPER',
    false
  )
$$;

-- ── 2. Hardened org-id helper (app_metadata only) ───────────────────
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
$$;

-- ── 3. CONTACTS ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Tenant RLS: Contacts" ON contacts;
CREATE POLICY "Tenant RLS: Contacts" ON contacts
  FOR ALL
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- ── 4. SMS LOGS ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Tenant RLS: SMS Logs" ON sms_logs;
CREATE POLICY "Tenant RLS: SMS Logs" ON sms_logs
  FOR ALL
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- ── 5. CALL LOGS ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Tenant RLS: Call Logs" ON call_logs;
CREATE POLICY "Tenant RLS: Call Logs" ON call_logs
  FOR ALL
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- ── 6. CRM WEBHOOK LOGS ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Tenant RLS: CRM Webhook Logs" ON crm_webhook_logs;
CREATE POLICY "Tenant RLS: CRM Webhook Logs" ON crm_webhook_logs
  FOR ALL
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- ── 7. FINANCIAL INSIGHTS ───────────────────────────────────────────
DROP POLICY IF EXISTS "Tenant RLS: Financial Insights" ON tenant_financial_insights;
CREATE POLICY "Tenant RLS: Financial Insights" ON tenant_financial_insights
  FOR ALL
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- ── 8. PENDING INVITES (read scoped to org; DEVELOPER sees all) ─────
DROP POLICY IF EXISTS "Invite read: org members" ON pending_invites;
CREATE POLICY "Invite read: org members" ON pending_invites
  FOR SELECT
  USING (organization_id = public.current_org_id() OR public.is_developer());

-- ── 9. USER PROFILES (read scoped to own org) ───────────────────────
DROP POLICY IF EXISTS "Profile read: org scope" ON user_profiles;
CREATE POLICY "Profile read: org scope" ON user_profiles
  FOR SELECT
  USING (organization_id = public.current_org_id() OR public.is_developer());

-- NOTE: also confirm the base tenant policies on `organizations` and
-- `outbound_campaigns` (from the bootstrap schema in CLAUDE.md) read
-- app_metadata, not user_metadata. If they still reference user_metadata,
-- drop and recreate them the same way:
--   DROP POLICY IF EXISTS "Tenant RLS: Organizations" ON organizations;
--   CREATE POLICY "Tenant RLS: Organizations" ON organizations
--     FOR ALL USING (id = public.current_org_id());
--   DROP POLICY IF EXISTS "Tenant RLS: Campaigns" ON outbound_campaigns;
--   CREATE POLICY "Tenant RLS: Campaigns" ON outbound_campaigns
--     FOR ALL USING (organization_id = public.current_org_id())
--     WITH CHECK (organization_id = public.current_org_id());

-- ── 10. VERIFICATION ────────────────────────────────────────────────
-- Any row returned here is still trusting client-writable user_metadata
-- and must be fixed:
--   SELECT schemaname, tablename, policyname, qual
--   FROM pg_policies
--   WHERE qual ILIKE '%user_metadata%'
--   ORDER BY tablename, policyname;
