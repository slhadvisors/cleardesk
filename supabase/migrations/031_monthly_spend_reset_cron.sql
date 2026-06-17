-- ============================================================
-- Migration 031: monthly spend-cycle reset (pg_cron)
-- ============================================================
-- The 030 trigger only ACCRUES current_month_accumulated_spend. Nothing
-- resets it, so the credit dashboard bars + budget_breached_lockout would
-- stay stuck after the billing month rolls over. This job zeroes the cycle
-- counter at the start of each month. usage_events rows are kept (audit).
--
-- Runs 00:05 UTC on the 1st. Idempotent.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.reset_monthly_spend()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE organization_developer_vault
     SET current_month_accumulated_spend = 0,
         budget_breached_lockout = false,
         updated_at = NOW();
$$;

REVOKE EXECUTE ON FUNCTION public.reset_monthly_spend() FROM anon, authenticated, PUBLIC;

-- Re-register cleanly (unschedule prior if present).
DO $$
BEGIN
  PERFORM cron.unschedule('reset-monthly-spend');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('reset-monthly-spend', '5 0 1 * *', $$ SELECT public.reset_monthly_spend(); $$);
