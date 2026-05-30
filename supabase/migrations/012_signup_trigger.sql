-- Migration 012: Auto-provision org + profile + vault on new user signup
-- Fires when a new row is inserted into auth.users (i.e. on signUp)
-- Reads firm_name, country_code, full_name from raw_user_meta_data
-- Creates: organizations → user_profiles → organization_developer_vault
-- Then stamps app_metadata with organization_id + user_role via admin API

-- ── Ensure required tables exist ─────────────────────────────────

CREATE TABLE IF NOT EXISTS user_profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id   UUID REFERENCES organizations(id) ON DELETE CASCADE,
  role              VARCHAR(20) DEFAULT 'ORG_ADMIN'
                      CHECK (role IN ('ORG_ADMIN','ORG_STAFF','DEVELOPER')),
  display_name      TEXT,
  preferred_language VARCHAR(20) DEFAULT 'ENGLISH',
  avatar_url        TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name            VARCHAR(150) NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams         ENABLE ROW LEVEL SECURITY;

-- RLS: users can only see their own org's profiles
DROP POLICY IF EXISTS "Tenant RLS: user_profiles" ON user_profiles;
CREATE POLICY "Tenant RLS: user_profiles" ON user_profiles
  FOR ALL USING (
    organization_id = (
      SELECT (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
    )
  );

DROP POLICY IF EXISTS "Tenant RLS: teams" ON teams;
CREATE POLICY "Tenant RLS: teams" ON teams
  FOR ALL USING (
    organization_id = (
      SELECT (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
    )
  );

-- ── Trigger function ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id        UUID;
  v_firm_name     TEXT;
  v_country_code  TEXT;
  v_full_name     TEXT;
  v_avatar_url    TEXT;
BEGIN
  -- Extract metadata from the new auth.users row
  v_firm_name    := COALESCE(
                      NEW.raw_user_meta_data->>'firm_name',
                      NEW.raw_user_meta_data->>'organization_name',
                      split_part(NEW.email, '@', 2) -- fallback: domain
                    );
  v_country_code := COALESCE(NEW.raw_user_meta_data->>'country_code', 'IN');
  v_full_name    := COALESCE(
                      NEW.raw_user_meta_data->>'full_name',
                      NEW.raw_user_meta_data->>'display_name',
                      split_part(NEW.email, '@', 1)
                    );
  v_avatar_url   := NEW.raw_user_meta_data->>'avatar_url';

  -- 1. Create organization
  INSERT INTO public.organizations (
    firm_name,
    country_code,
    billing_status,
    credit_balance,
    overdraft_allowed,
    overdraft_limit
  ) VALUES (
    v_firm_name,
    v_country_code,
    'trial',
    0.00,
    true,
    500.00
  )
  RETURNING id INTO v_org_id;

  -- 2. Create user profile (ORG_ADMIN — first user is always admin)
  INSERT INTO public.user_profiles (
    id,
    organization_id,
    role,
    display_name,
    preferred_language,
    avatar_url
  ) VALUES (
    NEW.id,
    v_org_id,
    'ORG_ADMIN',
    v_full_name,
    'ENGLISH',
    v_avatar_url
  );

  -- 3. Create developer vault for the org
  INSERT INTO public.organization_developer_vault (
    organization_id,
    crm_type,
    monthly_budget_cap,
    current_month_accumulated_spend,
    max_demo_files_allowed,
    demo_files_processed_count,
    demo_voice_minutes_allowed,
    budget_breached_lockout
  ) VALUES (
    v_org_id,
    'none',
    100.00,
    0.00,
    3,
    0,
    2,
    false
  );

  -- 4. Stamp app_metadata with organization_id + user_role
  --    This makes it available in the JWT for all subsequent requests
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data ||
    jsonb_build_object(
      'organization_id', v_org_id::text,
      'user_role',       'ORG_ADMIN',
      'display_name',    v_full_name,
      'country_code',    v_country_code
    )
  WHERE id = NEW.id;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Log error but don't block the auth.users insert
  RAISE WARNING '[handle_new_user] Error for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- ── Attach trigger to auth.users ──────────────────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_profiles_org   ON user_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role  ON user_profiles(organization_id, role);
CREATE INDEX IF NOT EXISTS idx_teams_org           ON teams(organization_id);

-- ── Backfill: existing auth users with no profile ─────────────────
-- Only runs if user_profiles is empty (safe for fresh installs)
-- For existing users who signed up before this migration:
-- You can manually run handle_new_user logic or re-invite them.
DO $$
DECLARE
  r RECORD;
  v_org_id UUID;
BEGIN
  FOR r IN
    SELECT u.id, u.email, u.raw_user_meta_data
    FROM auth.users u
    LEFT JOIN public.user_profiles p ON p.id = u.id
    WHERE p.id IS NULL
  LOOP
    BEGIN
      INSERT INTO public.organizations (
        firm_name, country_code, billing_status
      ) VALUES (
        COALESCE(r.raw_user_meta_data->>'firm_name', split_part(r.email,'@',2)),
        COALESCE(r.raw_user_meta_data->>'country_code', 'IN'),
        'trial'
      ) RETURNING id INTO v_org_id;

      INSERT INTO public.user_profiles (id, organization_id, role, display_name)
      VALUES (
        r.id, v_org_id, 'ORG_ADMIN',
        COALESCE(r.raw_user_meta_data->>'full_name', split_part(r.email,'@',1))
      );

      INSERT INTO public.organization_developer_vault (organization_id)
      VALUES (v_org_id)
      ON CONFLICT DO NOTHING;

      UPDATE auth.users
      SET raw_app_meta_data = raw_app_meta_data ||
        jsonb_build_object('organization_id', v_org_id::text, 'user_role', 'ORG_ADMIN')
      WHERE id = r.id;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Backfill failed for %: %', r.email, SQLERRM;
    END;
  END LOOP;
END;
$$;
