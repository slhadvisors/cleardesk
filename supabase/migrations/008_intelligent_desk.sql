-- ============================================================
-- Migration 008: Intelligent Desk — tenant_financial_insights
-- Run in Supabase SQL Console (after 007)
-- ============================================================

CREATE TYPE insight_type_enum AS ENUM ('info', 'optimization_alert', 'critical_crunch');

CREATE TABLE IF NOT EXISTS tenant_financial_insights (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    insight_type insight_type_enum NOT NULL DEFAULT 'info',
    metric_title VARCHAR(255) NOT NULL,
    detailed_finding_summary TEXT NOT NULL,
    projected_savings_amount NUMERIC(14,2) DEFAULT 0.00,
    is_published_to_taxpayer BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insights_org_type
    ON tenant_financial_insights(organization_id, insight_type, is_published_to_taxpayer);

ALTER TABLE tenant_financial_insights ENABLE ROW LEVEL SECURITY;

-- Tenant RLS: reads org_id from JWT (app_metadata or user_metadata)
CREATE POLICY "Tenant RLS: Financial Insights" ON tenant_financial_insights
    FOR ALL USING (
        organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
        OR organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::uuid
    );

-- DEVELOPER bypass
CREATE POLICY "DEVELOPER bypass: Financial Insights" ON tenant_financial_insights
    FOR ALL USING (auth.is_developer());

-- Auto-update timestamp
CREATE TRIGGER insights_updated_at
    BEFORE UPDATE ON tenant_financial_insights
    FOR EACH ROW EXECUTE FUNCTION trg_contacts_updated_at();
