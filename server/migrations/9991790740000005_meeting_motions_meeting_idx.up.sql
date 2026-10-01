CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_motions_meeting ON meeting_motions (meeting_id, position);
