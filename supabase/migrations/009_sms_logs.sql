-- ============================================================
-- Migration 009: SMS Logs
-- Run in Supabase SQL Console (after 008)
-- ============================================================

CREATE TABLE IF NOT EXISTS sms_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    campaign_id UUID REFERENCES outbound_campaigns(id) ON DELETE SET NULL,
    contact_name VARCHAR(200),
    phone_number VARCHAR(30) NOT NULL,
    message_body TEXT NOT NULL,
    campaign_name VARCHAR(150) DEFAULT NULL,
    delivery_status VARCHAR(30) DEFAULT 'sent'
        CHECK (delivery_status IN ('sent', 'delivered', 'failed', 'pending', 'replied')),
    reply_body TEXT DEFAULT NULL,
    provider_message_id VARCHAR(200) DEFAULT NULL,
    cost_inr NUMERIC(8,4) DEFAULT 0.0000,
    sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_org_status
    ON sms_logs(organization_id, delivery_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_logs_campaign
    ON sms_logs(campaign_id);

ALTER TABLE sms_logs ENABLE ROW LEVEL SECURITY;

-- Tenant RLS: reads org_id from JWT (app_metadata or user_metadata)
CREATE POLICY "Tenant RLS: SMS Logs" ON sms_logs
    FOR ALL USING (
        organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
        OR organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::uuid
    );

-- DEVELOPER bypass
CREATE POLICY "DEVELOPER bypass: SMS Logs" ON sms_logs
    FOR ALL USING (public.is_developer());

-- Auto-update timestamp
CREATE TRIGGER sms_logs_updated_at
    BEFORE UPDATE ON sms_logs
    FOR EACH ROW EXECUTE FUNCTION trg_contacts_updated_at();
