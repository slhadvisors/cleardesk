-- ============================================================
-- Migration 007: Contacts table
-- Run in Supabase SQL Console
-- ============================================================

CREATE TABLE IF NOT EXISTS contacts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    full_name VARCHAR(200) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(200) DEFAULT NULL,
    company VARCHAR(200) DEFAULT NULL,
    tags TEXT[] DEFAULT '{}',
    notes TEXT DEFAULT NULL,
    country_code VARCHAR(5) DEFAULT 'IN' CHECK (country_code IN ('IN', 'US', 'AE')),
    do_not_call BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast org-scoped lookups
CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(organization_id, phone);

-- RLS
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant RLS: Contacts" ON contacts
    FOR ALL USING (
        organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
        OR organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::uuid
    );

-- DEVELOPER bypass
CREATE POLICY "DEVELOPER bypass: Contacts" ON contacts
    FOR ALL USING (public.is_developer());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION trg_contacts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER contacts_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION trg_contacts_updated_at();
