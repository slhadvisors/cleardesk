-- ============================================================
-- Migration 026: §7 INFRASTRUCTURE SUBSCRIPTION MODEL — usage metering
-- ============================================================
-- ARCHITECTURE.md §7: single MASTER ClearDesk account per upstream provider
-- (Twilio, Claude/Anthropic, Sarvam) — never per-client subscriptions. The
-- ONLY per-org separation is Twilio SUBACCOUNTS for telecom identity isolation
-- (caller-ID / WhatsApp sender). Every API call (Claude, Twilio, Sarvam, Vapi)
-- must be tagged with org_id (and agent type) at the point of invocation —
-- this feeds the per-org usage-metering event log that powers the API credit
-- dashboard. Without this tagging, costs can't be attributed to tenants.
--
-- Master account credentials live in env (no DB). This migration is the
-- per-org metering log + the Twilio subaccount identity pointer.
--
-- Builds on 016 helpers. Idempotent.
-- ============================================================

-- Per-org Twilio subaccount (identity isolation only — not billing).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS twilio_subaccount_sid VARCHAR(60) DEFAULT NULL;

DO $$ BEGIN
  CREATE TYPE usage_provider_enum AS ENUM ('claude','twilio','sarvam','vapi');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE usage_unit_enum AS ENUM ('call_minute','sms_segment','message','llm_token','tts_char');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS usage_events (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    agent_type      agent_type_enum DEFAULT NULL,        -- which persona drove the spend
    provider        usage_provider_enum NOT NULL,
    unit            usage_unit_enum NOT NULL,
    quantity        NUMERIC(14,4) NOT NULL DEFAULT 0,
    cost_credits    NUMERIC(12,4) NOT NULL DEFAULT 0,     -- retail credit burn
    wholesale_cost  NUMERIC(12,4) NOT NULL DEFAULT 0,     -- infra cost (margin calc, §10 formula)
    ref_type        VARCHAR(40) DEFAULT NULL,             -- 'call_log' | 'sms_log' | ...
    ref_id          UUID DEFAULT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE usage_events IS '§7 Per-org, per-provider usage-metering log. Every Claude/Twilio/Sarvam/Vapi call is tagged here with org_id + agent_type at invocation. Powers the API credit dashboard and gross-margin alerting.';

CREATE INDEX IF NOT EXISTS idx_usage_org_time     ON usage_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_org_provider ON usage_events(organization_id, provider);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

-- Tenants READ their own usage (dashboard). Writes only via service role
-- (server-side at invocation) — no tenant INSERT policy.
DROP POLICY IF EXISTS "Tenant read: Usage Events" ON usage_events;
CREATE POLICY "Tenant read: Usage Events" ON usage_events
    FOR SELECT
    USING (organization_id = public.current_org_id() OR public.is_developer());
