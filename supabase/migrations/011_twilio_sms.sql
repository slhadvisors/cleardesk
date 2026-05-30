-- Migration 011: Twilio SMS dispatch columns
ALTER TABLE sms_logs
  ADD COLUMN IF NOT EXISTS twilio_sid    VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS error_message TEXT         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS campaign_id   UUID         DEFAULT NULL;

COMMENT ON COLUMN sms_logs.twilio_sid    IS 'Twilio Message SID (SMxxxxxxx)';
COMMENT ON COLUMN sms_logs.error_message IS 'Twilio error detail on failed sends';
COMMENT ON COLUMN sms_logs.campaign_id   IS 'Optional campaign this SMS belongs to';

CREATE INDEX IF NOT EXISTS idx_sms_logs_twilio_sid
  ON sms_logs(organization_id, twilio_sid);
