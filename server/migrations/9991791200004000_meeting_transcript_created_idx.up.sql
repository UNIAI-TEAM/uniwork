-- G18: the in-room transcript feed reads deltas by (meeting_id, created_at).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_transcript_meeting_created ON meeting_transcript_segments (meeting_id, created_at);
