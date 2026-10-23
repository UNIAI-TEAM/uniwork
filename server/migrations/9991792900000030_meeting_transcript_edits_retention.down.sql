ALTER TABLE meeting_settings DROP CONSTRAINT IF EXISTS meeting_settings_transcript_retention_days_check;
ALTER TABLE meeting_settings DROP COLUMN IF EXISTS transcript_retention_days;
ALTER TABLE meeting_summaries DROP COLUMN IF EXISTS transcript_changed_at;
ALTER TABLE meeting_transcript_segments DROP COLUMN IF EXISTS edited_by;
ALTER TABLE meeting_transcript_segments DROP COLUMN IF EXISTS edited_at;
ALTER TABLE meeting_transcript_segments DROP COLUMN IF EXISTS original_text;
