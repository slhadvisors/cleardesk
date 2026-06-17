-- ============================================================
-- Migration 028: §9 INTERNAL OPS DASHBOARD ("Sovereign Vault")
-- ============================================================
-- ARCHITECTURE.md §9: ClearDesk's OWN team only, cross-tenant visibility,
-- higher security bar than the per-org Developer Portal. Internal least-
-- privilege role tiers (NOT "team = full access"). Every cross-tenant query/
-- action writes an access-log entry (who, what org, when, why). Read defaults
-- to wide/aggregated; destructive Actions require a reason + audit + two-person
-- approval for the most dangerous ones.
--
-- NOTE: §9 also calls for a SEPARATE auth domain + mandatory MFA + shorter
-- sessions. Those are app/deploy concerns (separate Supabase project or aal2
-- enforcement) — this migration is the data model + server-side guards.
--
-- §10 RESOLUTION: internal role tiers finalized as billing_ops / engineering /
-- founder with the capability map seeded below.
--
-- Idempotent.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE internal_role_enum AS ENUM ('billing_ops','engineering','founder');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sovereign_action_enum AS ENUM
    ('refund','suspend_org','force_reprovision','integration_health',
     'org_deletion','mass_action','impersonate','data_export');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sovereign_action_status_enum AS ENUM ('pending','approved','rejected','executed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Internal staff (ClearDesk team) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS internal_staff (
    user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    internal_role internal_role_enum NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
COMMENT ON TABLE internal_staff IS '§9 ClearDesk internal team members + least-privilege tier. Distinct from tenant users.';

-- ── Capability map (role → capability) ──────────────────────────────
CREATE TABLE IF NOT EXISTS internal_role_capabilities (
    internal_role internal_role_enum NOT NULL,
    capability    VARCHAR(40) NOT NULL,
    PRIMARY KEY (internal_role, capability)
);

INSERT INTO internal_role_capabilities (internal_role, capability) VALUES
  ('billing_ops','view_all'), ('billing_ops','refund'), ('billing_ops','suspend_org'),
  ('engineering','view_all'), ('engineering','force_reprovision'), ('engineering','integration_health'),
  ('founder','view_all'), ('founder','refund'), ('founder','suspend_org'),
  ('founder','force_reprovision'), ('founder','integration_health'),
  ('founder','org_deletion'), ('founder','mass_action'), ('founder','impersonate'), ('founder','data_export')
ON CONFLICT DO NOTHING;

-- ── Guards (SECURITY DEFINER, search_path pinned) ───────────────────
CREATE OR REPLACE FUNCTION public.is_sovereign()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM internal_staff WHERE user_id = auth.uid() AND is_active);
$$;

CREATE OR REPLACE FUNCTION public.internal_role_of(p_user uuid DEFAULT auth.uid())
RETURNS internal_role_enum LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT internal_role FROM internal_staff WHERE user_id = p_user AND is_active;
$$;

CREATE OR REPLACE FUNCTION public.internal_has_cap(p_cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM internal_staff s
    JOIN internal_role_capabilities c ON c.internal_role = s.internal_role
    WHERE s.user_id = auth.uid() AND s.is_active AND c.capability = p_cap
  );
$$;

-- ── RLS: internal-only on all sovereign objects ─────────────────────
ALTER TABLE internal_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sovereign: staff self/founder read" ON internal_staff;
CREATE POLICY "Sovereign: staff self/founder read" ON internal_staff
    FOR SELECT USING (user_id = auth.uid() OR public.internal_role_of() = 'founder');
DROP POLICY IF EXISTS "Sovereign: founder manage staff" ON internal_staff;
CREATE POLICY "Sovereign: founder manage staff" ON internal_staff
    FOR ALL USING (public.internal_role_of() = 'founder') WITH CHECK (public.internal_role_of() = 'founder');

ALTER TABLE internal_role_capabilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sovereign: caps read" ON internal_role_capabilities;
CREATE POLICY "Sovereign: caps read" ON internal_role_capabilities
    FOR SELECT USING (public.is_sovereign());
