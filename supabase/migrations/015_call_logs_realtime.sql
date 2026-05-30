-- Migration 015: call_logs realtime columns + deduct_org_credits RPC

-- ── Add missing columns to call_logs ────────────────────────────
ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS recording_url    TEXT          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS transcript       TEXT          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS summary          TEXT          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS started_at       TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ended_at         TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS duration_seconds INT           DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cost_credits     NUMERIC(10,4) DEFAULT NULL;

-- ── Enable Realtime on call_logs ─────────────────────────────────
-- Run in Supabase Dashboard: Database → Replication → Tables → enable call_logs
-- Or via SQL:
ALTER PUBLICATION supabase_realtime ADD TABLE call_logs;

-- ── deduct_org_credits RPC ────────────────────────────────────────
-- Atomic credit deduction (no race condition)
CREATE OR REPLACE FUNCTION public.deduct_org_credits(
  p_org_id UUID,
  p_amount NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.organizations
  SET credit_balance = GREATEST(credit_balance - p_amount, -overdraft_limit)
  WHERE id = p_org_id;
END;
$$;

-- ── Index for live call polling ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_call_logs_vapi_id
  ON call_logs(vapi_call_id) WHERE vapi_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_logs_status_org
  ON call_logs(organization_id, status, created_at DESC);
