-- Migration 014: Deadline reminder logs + pg_cron schedule

-- ── Log table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deadline_reminder_logs (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE,
  deadline_key     VARCHAR(50) NOT NULL,
  deadline_label   TEXT,
  campaign_id      UUID DEFAULT NULL,
  contacts_called  INT DEFAULT 0,
  calls_queued     INT DEFAULT 0,
  outcome          VARCHAR(30) DEFAULT 'pending',
  fired_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE deadline_reminder_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant RLS: deadline_reminder_logs" ON deadline_reminder_logs
  FOR ALL USING (
    organization_id = (
      SELECT (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
    )
  );

CREATE INDEX IF NOT EXISTS idx_deadline_logs_org
  ON deadline_reminder_logs(organization_id, fired_at DESC);

-- ── pg_cron: fire daily at 09:00 IST (03:30 UTC) ─────────────────
-- Requires pg_cron extension enabled in Supabase (Dashboard → Extensions)
-- Run this AFTER enabling pg_cron:

SELECT cron.schedule(
  'cleardesk-deadline-reminders',          -- job name (unique)
  '30 3 * * *',                             -- 03:30 UTC = 09:00 IST daily
  $$
    SELECT net.http_post(
      url    := current_setting('app.settings.supabase_url') || '/functions/v1/deadline-reminder',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer ' ||
                  current_setting('app.settings.service_role_key') || '"}'::jsonb,
      body   := '{}'::jsonb
    );
  $$
);

-- To verify cron job created:
-- SELECT * FROM cron.job;

-- To remove if needed:
-- SELECT cron.unschedule('cleardesk-deadline-reminders');
