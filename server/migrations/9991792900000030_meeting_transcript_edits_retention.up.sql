-- UNI-1995 #5: a clerk corrects or removes what the transcript says, and an
-- organization keeps transcripts only as long as it chose.
--
-- original_text keeps what the source first said, once, however often the
-- line is corrected after; edited_at/edited_by say who corrected it last
-- (a clerk, always a person: the scribe and uploads only insert).
ALTER TABLE meeting_transcript_segments ADD COLUMN IF NOT EXISTS original_text TEXT;
ALTER TABLE meeting_transcript_segments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE meeting_transcript_segments ADD COLUMN IF NOT EXISTS edited_by TEXT;

-- The summary was made before its transcript was corrected, cut or replaced:
-- the page says so and offers Regenerate. A new summary row starts NULL.
ALTER TABLE meeting_summaries ADD COLUMN IF NOT EXISTS transcript_changed_at TIMESTAMPTZ;

-- Days an organization keeps transcript lines and uploaded meeting audio;
-- NULL keeps them (the default). Summaries, minutes, action items and tasks
-- are never swept. meeting_settings is one row per organization.
ALTER TABLE meeting_settings ADD COLUMN IF NOT EXISTS transcript_retention_days INT;
ALTER TABLE meeting_settings DROP CONSTRAINT IF EXISTS meeting_settings_transcript_retention_days_check;
ALTER TABLE meeting_settings ADD CONSTRAINT meeting_settings_transcript_retention_days_check
  CHECK (transcript_retention_days IS NULL OR transcript_retention_days IN (30, 90, 180, 365));
