-- ============================================================
-- Migration 024: §6 ORG ONBOARDING & BILLING — plans + subscription state
-- ============================================================
-- ARCHITECTURE.md §6: data-driven plans table (NOT hardcoded limits); org
-- carries GSTIN + plan + Razorpay subscription state; org flips to "active"
-- ONLY on a verified, signature-checked webhook (handled by razorpay-webhook),
-- never the client redirect. Autopay failure → grace + past_due, not lockout.
-- Async provisioning surfaced via org_provisioning_status (migration 025).
--
-- Builds on 016 helpers. Idempotent.
-- ============================================================

-- ── Data-driven plans (global, shared) ──────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
    id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code                 VARCHAR(40) UNIQUE NOT NULL,
    name                 VARCHAR(120) NOT NULL,
    price_inr            NUMERIC(10,2) NOT NULL DEFAULT 0,
    billing_period       VARCHAR(20) NOT NULL DEFAULT 'monthly'
                           CHECK (billing_period IN ('monthly','yearly')),
    seats                INT NOT NULL DEFAULT 1,
    ai_minutes_included  INT NOT NULL DEFAULT 0,
    ai_messages_included INT NOT NULL DEFAULT 0,
    gstins_manageable    INT NOT NULL DEFAULT 1,
    razorpay_plan_id     VARCHAR(60) DEFAULT NULL,   -- maps to a Razorpay Plan
    is_active            BOOLEAN NOT NULL DEFAULT true,
    sort_order           INT NOT NULL DEFAULT 0,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE plans IS '§6 Data-driven plan catalogue (seats, AI minutes/messages, GSTINs manageable). Never hardcode these limits in app code.';

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Plans read: authenticated" ON plans;
CREATE POLICY "Plans read: authenticated" ON plans
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Plans write: developer" ON plans;
CREATE POLICY "Plans write: developer" ON plans
    FOR ALL USING (public.is_developer()) WITH CHECK (public.is_developer());

INSERT INTO plans (code, name, price_inr, seats, ai_minutes_included, ai_messages_included, gstins_manageable, sort_order)
VALUES
  ('starter',  'Starter',   2999,  2,  300,  1000,   5, 1),
  ('growth',   'Growth',    7999,  5,  1000, 5000,   25, 2),
  ('scale',    'Scale',     19999, 15, 3000, 20000,  100, 3)
ON CONFLICT (code) DO NOTHING;

-- ── Organization subscription state ─────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS gstin                   VARCHAR(20) DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_id                 UUID REFERENCES plans(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS razorpay_customer_id    VARCHAR(60) DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS razorpay_subscription_id VARCHAR(60) DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status     VARCHAR(30) DEFAULT NULL; -- raw Razorpay state mirror
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS grace_until             TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_orgs_rzp_sub ON organizations(razorpay_subscription_id);
