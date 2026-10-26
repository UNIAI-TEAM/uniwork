ALTER TABLE meeting_settings DROP CONSTRAINT IF EXISTS meeting_settings_scribe_policy_check;
ALTER TABLE meeting_settings DROP COLUMN IF EXISTS scribe_policy;
