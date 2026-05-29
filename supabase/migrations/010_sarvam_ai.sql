-- Migration 010: Sarvam AI integration
-- Adds sarvam_api_key to organization_developer_vault
-- Adds tts_engine column to call_logs for audit trail

-- ── Vault: Sarvam API key ─────────────────────────────────────────
ALTER TABLE organization_developer_vault
  ADD COLUMN IF NOT EXISTS sarvam_api_key TEXT DEFAULT NULL;

COMMENT ON COLUMN organization_developer_vault.sarvam_api_key
  IS 'Sarvam AI API key for Bulbul-v2 TTS (IN jurisdiction). Encrypted at rest.';

-- ── Call logs: TTS engine audit ───────────────────────────────────
ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS tts_engine VARCHAR(50) DEFAULT 'vapi_default';

COMMENT ON COLUMN call_logs.tts_engine
  IS 'TTS engine used: vapi_default | sarvam_bulbul_v2';

-- ── Index for analytics ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_call_logs_tts_engine
  ON call_logs(organization_id, tts_engine);
