-- ============================================================
-- Migration 023: §5 INBOUND CALLER VERIFICATION
-- ============================================================
-- ARCHITECTURE.md §5: CLI/caller-ID is a HINT, not proof. Before discussing
-- anything client-specific, verbally confirm a second factor (last 4 of
-- registered GSTIN, registered mobile, or OTP via Twilio Verify). Unverified
-- callers get generic info only. Never confirm/deny that a record exists for
-- an unverified caller. Twilio Lookup risk signals captured before/at connect.
--
-- Builds on 016 helpers. Idempotent.
-- ============================================================

-- Client GSTIN (used for the "last 4 of registered GSTIN" factor).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS gstin VARCHAR(20) DEFAULT NULL;

DO $$ BEGIN
  CREATE TYPE verification_method_enum AS ENUM ('gstin_last4','registered_mobile','otp');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE verification_status_enum AS ENUM ('unverified','pending','verified','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS caller_verifications (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    client_id       UUID REFERENCES contacts(id)      ON DELETE SET NULL,  -- never set for unmatched callers
    call_log_id     UUID REFERENCES call_logs(id)     ON DELETE SET NULL,
    channel         VARCHAR(20) DEFAULT 'call',
    cli_phone       VARCHAR(30) DEFAULT NULL,    -- caller-ID presented (a hint only)
    cli_match       BOOLEAN DEFAULT false,       -- did CLI match a known client number
    method          verification_method_enum DEFAULT NULL,
    status          verification_status_enum NOT NULL DEFAULT 'unverified',
    risk_signals    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- Twilio Lookup: sim_swap, line_type, ...
    attempts        INT NOT NULL DEFAULT 0,
    verified_at     TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE caller_verifications IS '§5 Inbound caller verification state. CLI is a hint (cli_match), proof requires a second factor. status gates client-specific data. Never reveal record existence to an unverified caller.';

CREATE INDEX IF NOT EXISTS idx_callerver_org   ON caller_verifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_callerver_call  ON caller_verifications(call_log_id);
CREATE INDEX IF NOT EXISTS idx_callerver_client ON caller_verifications(client_id);

ALTER TABLE caller_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant RLS: Caller Verifications" ON caller_verifications;
CREATE POLICY "Tenant RLS: Caller Verifications" ON caller_verifications
    FOR ALL
    USING (organization_id = public.current_org_id())
    WITH CHECK (organization_id = public.current_org_id());

DROP POLICY IF EXISTS "DEVELOPER bypass: Caller Verifications" ON caller_verifications;
CREATE POLICY "DEVELOPER bypass: Caller Verifications" ON caller_verifications
    FOR ALL USING (public.is_developer());

CREATE OR REPLACE FUNCTION trg_callerver_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS callerver_updated_at ON caller_verifications;
CREATE TRIGGER callerver_updated_at
    BEFORE UPDATE ON caller_verifications
    FOR EACH ROW EXECUTE FUNCTION trg_callerver_updated_at();
