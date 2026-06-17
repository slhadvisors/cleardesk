-- ============================================================
-- Migration 030: verification queue + usage→spend accrual trigger
-- ============================================================
-- Two pieces:
--   1. verification_queue — per-org document review surface (verification.html)
--   2. trg_usage_accrue_spend — AFTER INSERT on usage_events: the single
--      place that accrues current_month_accumulated_spend, flips the budget
--      lockout, and decrements the org wallet. Centralises spend so the
--      credit dashboard reflects every tagged Claude/Twilio/Sarvam/Vapi call.
--
-- NOTE: vapi-webhook previously deducted credit directly via deduct_org_credits
-- on call-end. With this trigger handling the deduction off usage_events, that
-- explicit deduct is removed in the webhook to avoid double-charging.
--
-- Builds on 016 helpers (current_org_id / is_developer) + 026 (usage_events).
-- Idempotent.
-- ============================================================

-- ── 1. Verification queue ───────────────────────────────────
DO $$ BEGIN
  CREATE TYPE verification_status_enum AS ENUM ('pending','review','verified','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS verification_queue (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    doc_name        VARCHAR(255) NOT NULL,
    doc_size        VARCHAR(40)  DEFAULT NULL,
    doc_type        VARCHAR(80)  DEFAULT NULL,     -- 'GST invoice' | 'Bank statement' | ...
    client_name     VARCHAR(255) DEFAULT NULL,
    contact_id      UUID DEFAULT NULL,
    storage_path    TEXT DEFAULT NULL,             -- supabase storage object key
    status          verification_status_enum NOT NULL DEFAULT 'pending',
    uploaded_by     UUID DEFAULT NULL,
    reviewed_by     UUID DEFAULT NULL,
    reviewed_at     TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE verification_queue IS 'Per-org document verification surface. Powers verification.html (verify/reject with row-exit). Tenant-isolated via RLS.';

CREATE INDEX IF NOT EXISTS idx_verif_org_status ON verification_queue(organization_id, status, created_at DESC);

ALTER TABLE verification_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant RLS: Verification Queue" ON verification_queue;
CREATE POLICY "Tenant RLS: Verification Queue" ON verification_queue
    FOR ALL
    USING (organization_id = public.current_org_id() OR public.is_developer())
    WITH CHECK (organization_id = public.current_org_id() OR public.is_developer());

-- ── 2. Usage → spend accrual trigger ────────────────────────
CREATE OR REPLACE FUNCTION public.trg_usage_accrue_spend()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Accrue monthly spend + flip lockout when the cap is reached.
  UPDATE organization_developer_vault v
     SET current_month_accumulated_spend = COALESCE(v.current_month_accumulated_spend,0) + COALESCE(NEW.cost_credits,0),
         budget_breached_lockout = (COALESCE(v.current_month_accumulated_spend,0) + COALESCE(NEW.cost_credits,0))
                                     >= COALESCE(v.monthly_budget_cap, 0) AND COALESCE(v.monthly_budget_cap,0) > 0,
         updated_at = NOW()
   WHERE v.organization_id = NEW.organization_id;

  -- Decrement the org wallet (single source of credit burn).
  UPDATE organizations
     SET credit_balance = credit_balance - COALESCE(NEW.cost_credits,0)
   WHERE id = NEW.organization_id;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_usage_accrue_spend() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS usage_accrue_spend ON usage_events;
CREATE TRIGGER usage_accrue_spend
    AFTER INSERT ON usage_events
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_usage_accrue_spend();
