-- ─────────────────────────────────────────────────────────────────────────────
-- ClearDesk Migration 003: Invite Flow + User Profiles
-- Run in Supabase SQL Console (Database → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. pending_invites — audit trail for sent invites ──────────────────────
CREATE TABLE IF NOT EXISTS pending_invites (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email            VARCHAR(255) NOT NULL UNIQUE,
    display_name     VARCHAR(255) NOT NULL,
    role             VARCHAR(50)  NOT NULL CHECK (role IN ('ORG_ADMIN', 'ORG_STAFF')),
    organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invited_by       UUID REFERENCES auth.users(id),
    invited_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    accepted_at      TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    status           VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_pending_invites_email  ON pending_invites(email);
CREATE INDEX IF NOT EXISTS idx_pending_invites_org    ON pending_invites(organization_id, status);

ALTER TABLE pending_invites ENABLE ROW LEVEL SECURITY;

-- ORG_ADMIN and DEVELOPER can read their org's pending invites
CREATE POLICY "Invite read: org members" ON pending_invites
    FOR SELECT USING (
        organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::uuid
        OR (auth.jwt() -> 'app_metadata' ->> 'user_role') = 'DEVELOPER'
    );

-- Only the Edge Function (service role) can INSERT / UPDATE
-- (service role bypasses RLS — no client-side insert allowed)


-- ── 2. user_profiles — denormalised profile for quick reads ────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
    id               UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email            VARCHAR(255),
    display_name     VARCHAR(255),
    organization_id  UUID REFERENCES organizations(id),
    role             VARCHAR(50) DEFAULT 'ORG_STAFF' CHECK (role IN ('DEVELOPER', 'ORG_ADMIN', 'ORG_STAFF')),
    preferred_language VARCHAR(20) DEFAULT 'ENGLISH',
    status           VARCHAR(20) DEFAULT 'online' CHECK (status IN ('online', 'offline', 'busy')),
    avatar_url       TEXT DEFAULT NULL,
    calls_today      INT DEFAULT 0,
    joined_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read profiles within their org
CREATE POLICY "Profile read: org scope" ON user_profiles
    FOR SELECT USING (
        organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::uuid
        OR (auth.jwt() -> 'app_metadata' ->> 'user_role') = 'DEVELOPER'
        OR id = auth.uid()
    );

-- Users can update their own profile
CREATE POLICY "Profile update: self" ON user_profiles
    FOR UPDATE USING (id = auth.uid());

-- Users can insert their own profile (on first login after invite)
CREATE POLICY "Profile insert: self" ON user_profiles
    FOR INSERT WITH CHECK (id = auth.uid());


-- ── 3. Auto-create user_profile row on first sign-in ──────────────────────
-- This function fires when a new user is confirmed (invite accepted).
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profiles (
    id,
    email,
    display_name,
    organization_id,
    role,
    preferred_language
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    (NEW.raw_user_meta_data->>'organization_id')::uuid,
    COALESCE(NEW.raw_user_meta_data->>'user_role', 'ORG_STAFF'),
    COALESCE(NEW.raw_user_meta_data->>'preferred_language', 'ENGLISH')
  )
  ON CONFLICT (id) DO UPDATE SET
    display_name    = EXCLUDED.display_name,
    organization_id = EXCLUDED.organization_id,
    role            = EXCLUDED.role,
    updated_at      = NOW();
  RETURN NEW;
END;
$$;

-- Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ── 4. Expire stale pending invites (run via pg_cron daily) ───────────────
-- Supabase doesn't expose pg_cron in the dashboard by default,
-- but you can schedule this as a cron Edge Function:
--
-- UPDATE pending_invites
--   SET status = 'expired'
--   WHERE status = 'pending'
--     AND invited_at < NOW() - INTERVAL '48 hours';
