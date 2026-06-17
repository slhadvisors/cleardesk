-- ============================================================
-- Migration 025: §6 ASYNC PROVISIONING CHECKLIST
-- ============================================================
-- ARCHITECTURE.md §6.6/§6.7: once active, automated provisioning kicks off
-- (Twilio subaccount, virtual number, WhatsApp sender — async, Meta approval
-- can take days). The dashboard shows a setup checklist reflecting these async
-- items so the org doesn't think something's broken.
--
-- Builds on 016 helpers. Idempotent.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE provisioning_status_enum AS ENUM ('pending','in_progress','done','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS org_provisioning_status (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    task_key        VARCHAR(40) NOT NULL
                      CHECK (task_key IN ('twilio_subaccount','virtual_number','whatsapp_sender')),
    status          provisioning_status_enum NOT NULL DEFAULT 'pending',
    detail          TEXT DEFAULT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, task_key)
);

COMMENT ON TABLE org_provisioning_status IS '§6.7 Per-org async provisioning checklist (Twilio subaccount, virtual number, WhatsApp sender). Drives the onboarding setup checklist UI.';

CREATE INDEX IF NOT EXISTS idx_provstatus_org ON org_provisioning_status(organization_id);

ALTER TABLE org_provisioning_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant RLS: Provisioning" ON org_provisioning_status;
CREATE POLICY "Tenant RLS: Provisioning" ON org_provisioning_status
    FOR ALL
    USING (organization_id = public.current_org_id())
    WITH CHECK (organization_id = public.current_org_id());

DROP POLICY IF EXISTS "DEVELOPER bypass: Provisioning" ON org_provisioning_status;
CREATE POLICY "DEVELOPER bypass: Provisioning" ON org_provisioning_status
    FOR ALL USING (public.is_developer());

CREATE OR REPLACE FUNCTION trg_provstatus_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS provstatus_updated_at ON org_provisioning_status;
CREATE TRIGGER provstatus_updated_at
    BEFORE UPDATE ON org_provisioning_status
    FOR EACH ROW EXECUTE FUNCTION trg_provstatus_updated_at();

-- Seed the 3 checklist rows for an org (called on subscription activation).
CREATE OR REPLACE FUNCTION public.seed_provisioning_tasks(p_org uuid)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO org_provisioning_status (organization_id, task_key, status)
  SELECT p_org, k, 'pending'
  FROM unnest(ARRAY['twilio_subaccount','virtual_number','whatsapp_sender']) AS k
  ON CONFLICT (organization_id, task_key) DO NOTHING;
$$;
