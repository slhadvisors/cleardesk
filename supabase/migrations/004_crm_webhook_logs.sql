-- ============================================================
-- Migration 004: CRM Webhook Logs + call_logs table
-- Run in Supabase SQL Console
-- ============================================================

-- ── call_logs ────────────────────────────────────────────────────
-- Records every Vapi call attempt dispatched by vapi-dispatch
CREATE TABLE IF NOT EXISTS call_logs (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE,
    campaign_id      UUID REFERENCES outbound_campaigns(id) ON DELETE SET NULL,
    vapi_call_id     TEXT,
    contact_phone    VARCHAR(30) NOT NULL,
    contact_name     VARCHAR(200),
    status           VARCHAR(30) DEFAULT 'in_progress',  -- in_progress | completed | failed | no-answer
    jurisdiction     VARCHAR(5) DEFAULT 'US',
    duration_seconds INT,
    cost_credits     NUMERIC(8,4) DEFAULT 0,
    summary          TEXT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant RLS: Call Logs" ON call_logs
    FOR ALL USING (
        organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
        OR
        organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::uuid
    );

CREATE INDEX idx_call_logs_org_campaign ON call_logs(organization_id, campaign_id, created_at DESC);
CREATE INDEX idx_call_logs_vapi_id      ON call_logs(vapi_call_id) WHERE vapi_call_id IS NOT NULL;

-- ── crm_webhook_logs ─────────────────────────────────────────────
-- Audit trail for every inbound CRM webhook received
CREATE TABLE IF NOT EXISTS crm_webhook_logs (
    id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id   UUID REFERENCES organizations(id) ON DELETE CASCADE,
    event_type        VARCHAR(100),
    trigger_condition TEXT,
    contacts_received INT DEFAULT 0,
    calls_queued      INT DEFAULT 0,
    outcome           VARCHAR(50),   -- dispatched | no_matching_campaigns | no_trigger_match
    raw_payload       JSONB,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE crm_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant RLS: CRM Webhook Logs" ON crm_webhook_logs
    FOR ALL USING (
        organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
        OR
        organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::uuid
    );

CREATE INDEX idx_crm_webhook_logs_org ON crm_webhook_logs(organization_id, created_at DESC);

-- ── Vapi webhook result handler ───────────────────────────────────
-- Updates call_logs when Vapi sends back call completion webhooks
-- (called from vapi-webhook edge function — see below)
CREATE OR REPLACE FUNCTION update_call_log_from_vapi()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Deduct credits from org wallet when a call completes
    IF NEW.status = 'completed' AND OLD.status = 'in_progress' THEN
        UPDATE organizations
        SET    credit_balance = credit_balance - NEW.cost_credits
        WHERE  id = NEW.organization_id;
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_call_log_on_update
    BEFORE UPDATE ON call_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_call_log_from_vapi();
