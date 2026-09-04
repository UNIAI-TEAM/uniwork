CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_transcript_meeting ON meeting_transcript_segments (meeting_id, spoken_at);
