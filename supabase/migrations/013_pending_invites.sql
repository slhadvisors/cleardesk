-- Migration 013: pending_invites table + accept-invite support

CREATE TABLE IF NOT EXISTS pending_invites (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email           TEXT NOT NULL,
  display_name    TEXT,
  role            VARCHAR(20) DEFAULT 'ORG_STAFF'
                    CHECK (role IN ('ORG_ADMIN','ORG_STAFF','DEVELOPER')),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  accepted_at     TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  status          VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','expired','revoked')),
  UNIQUE(email)
);

ALTER TABLE pending_invites ENABLE ROW LEVEL SECURITY;

-- ORG_ADMIN can see/manage their org's invites
DROP POLICY IF EXISTS "Tenant RLS: pending_invites" ON pending_invites;
CREATE POLICY "Tenant RLS: pending_invites" ON pending_invites
  FOR ALL USING (
    organization_id = (
      SELECT (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
    )
  );

CREATE INDEX IF NOT EXISTS idx_pending_invites_org
  ON pending_invites(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_invites_email
  ON pending_invites(email);
