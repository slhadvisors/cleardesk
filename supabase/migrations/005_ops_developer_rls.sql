-- ============================================================
-- Migration 005: DEVELOPER role RLS bypass for ops vault
-- Allows DEVELOPER-role users to read/update all orgs and
-- campaigns (needed for Sovereign Master Vault ops.html)
-- Run in Supabase SQL Console
-- ============================================================

-- ── Helper: is caller a DEVELOPER? ───────────────────────────────
CREATE OR REPLACE FUNCTION auth.is_developer()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata'  ->> 'user_role') = 'DEVELOPER'
    OR (auth.jwt() -> 'user_metadata' ->> 'user_role') = 'DEVELOPER',
    false
  )
$$;

-- ── Organizations: DEVELOPER can read ALL orgs ───────────────────
CREATE POLICY "DEVELOPER read all orgs" ON organizations
    FOR SELECT USING (auth.is_developer());

-- DEVELOPER can update credit_balance, billing_status, overdraft settings
CREATE POLICY "DEVELOPER update orgs" ON organizations
    FOR UPDATE USING (auth.is_developer())
    WITH CHECK (auth.is_developer());

-- ── Campaigns: DEVELOPER can read/update ALL campaigns ───────────
CREATE POLICY "DEVELOPER read all campaigns" ON outbound_campaigns
    FOR SELECT USING (auth.is_developer());

CREATE POLICY "DEVELOPER update all campaigns" ON outbound_campaigns
    FOR UPDATE USING (auth.is_developer())
    WITH CHECK (auth.is_developer());

-- ── Call logs: DEVELOPER can read all logs ───────────────────────
CREATE POLICY "DEVELOPER read all call logs" ON call_logs
    FOR SELECT USING (auth.is_developer());

-- ── CRM webhook logs: DEVELOPER can read all ─────────────────────
CREATE POLICY "DEVELOPER read all webhook logs" ON crm_webhook_logs
    FOR SELECT USING (auth.is_developer());
