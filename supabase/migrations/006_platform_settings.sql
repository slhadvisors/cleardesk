-- ============================================================
-- Migration 006: Platform settings table (maintenance mode etc.)
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by  TEXT
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Anyone (anon + authed) can READ platform settings (e.g. maintenance mode check)
CREATE POLICY "Public read platform_settings" ON platform_settings
    FOR SELECT USING (true);

-- Only DEVELOPER role can write
CREATE POLICY "DEVELOPER write platform_settings" ON platform_settings
    FOR ALL USING (public.is_developer())
    WITH CHECK (public.is_developer());

-- Seed default maintenance mode state
INSERT INTO platform_settings (key, value, updated_by)
VALUES (
    'maintenance_mode',
    '{"enabled": false, "mode": "off", "start": null, "end": null, "message": "ClearDesk is undergoing scheduled maintenance. We will be back shortly."}'::jsonb,
    'system'
)
ON CONFLICT (key) DO NOTHING;
