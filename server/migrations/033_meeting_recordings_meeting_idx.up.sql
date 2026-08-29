CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_recordings_meeting ON meeting_recordings (meeting_id, started_at);
