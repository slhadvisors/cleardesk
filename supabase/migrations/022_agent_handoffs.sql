-- ============================================================
-- Migration 022: §4 CONVERSATION & CALL ROUTING — handoff/escalation log
-- ============================================================
-- ARCHITECTURE.md §4: intent-based routing decided inside each agent's own
-- response logic. Negotiation/dispute -> warm handoff to Recovery with a
-- written summary attached; fee waivers/discounts -> always escalate to a
-- human. Every handoff/escalation is logged (timestamp, reason, summary)
-- to the shared client record.
--
-- Builds on 016 helpers: public.current_org_id() / public.is_developer().
-- Idempotent.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE intent_bucket_enum AS ENUM
    ('informational','ambiguous','negotiation_dispute','fee_waiver_discount','high_risk','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE handoff_status_enum AS ENUM
    ('pending','accepted','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS agent_handoffs (
    id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id         UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    client_id               UUID REFERENCES contacts(id)      ON DELETE SET NULL,  -- may be unverified/unknown caller
    call_log_id             UUID REFERENCES call_logs(id)     ON DELETE SET NULL,
    from_agent_type         agent_type_enum DEFAULT NULL,
    to_target               VARCHAR(20) NOT NULL
                              CHECK (to_target IN ('recovery','human')),
    intent_bucket           intent_bucket_enum NOT NULL,
    reason                  TEXT NOT NULL,
    written_summary         TEXT DEFAULT NULL,    -- §4 warm handoff: convo summary attached
    requires_human_approval BOOLEAN NOT NULL DEFAULT false,  -- true for fee waivers/discounts
    status                  handoff_status_enum NOT NULL DEFAULT 'pending',
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE agent_handoffs IS '§4 Handoff/escalation log on the shared client record. Negotiation/dispute -> to_target=recovery with written_summary. Fee waivers/discounts -> requires_human_approval=true, to_target=human. Default-to-escalate when intent is uncertain.';

CREATE INDEX IF NOT EXISTS idx_handoffs_org    ON agent_handoffs(organization_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_client ON agent_handoffs(client_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_status ON agent_handoffs(organization_id, status);

ALTER TABLE agent_handoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant RLS: Agent Handoffs" ON agent_handoffs;
CREATE POLICY "Tenant RLS: Agent Handoffs" ON agent_handoffs
    FOR ALL
    USING (organization_id = public.current_org_id())
    WITH CHECK (organization_id = public.current_org_id());

DROP POLICY IF EXISTS "DEVELOPER bypass: Agent Handoffs" ON agent_handoffs;
CREATE POLICY "DEVELOPER bypass: Agent Handoffs" ON agent_handoffs
    FOR ALL USING (public.is_developer());

CREATE OR REPLACE FUNCTION trg_agent_handoffs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS agent_handoffs_updated_at ON agent_handoffs;
CREATE TRIGGER agent_handoffs_updated_at
    BEFORE UPDATE ON agent_handoffs
    FOR EACH ROW EXECUTE FUNCTION trg_agent_handoffs_updated_at();
