-- Meeting scribe (UNI-2023): the per-meeting switch (spec §6.2, D14; NULL =
-- the organization default, which is on), the agent segment contract (parent
-- spec §5.4 plus language) and the long-meeting summary flag (parent §7.8).
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS scribe_off_at TIMESTAMPTZ;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS scribe_off_by TEXT;

ALTER TABLE meeting_transcript_segments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'CAPTION';
ALTER TABLE meeting_transcript_segments ADD COLUMN IF NOT EXISTS transcription_id TEXT;
ALTER TABLE meeting_transcript_segments ADD COLUMN IF NOT EXISTS start_ms INT;
ALTER TABLE meeting_transcript_segments ADD COLUMN IF NOT EXISTS end_ms INT;
ALTER TABLE meeting_transcript_segments ADD COLUMN IF NOT EXISTS speaker_label TEXT NOT NULL DEFAULT '';
ALTER TABLE meeting_transcript_segments ADD COLUMN IF NOT EXISTS client_segment_id TEXT;
ALTER TABLE meeting_transcript_segments ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT '';

ALTER TABLE meeting_summaries ADD COLUMN IF NOT EXISTS partial BOOLEAN NOT NULL DEFAULT false;
