-- The speaker-label list reads each label's first line (UNI-2024 review):
-- only labelled shared-mic or upload lines, in spoken order.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_transcript_segments_speaker
  ON meeting_transcript_segments (meeting_id, speaker_label, spoken_at) WHERE speaker_label <> '';
