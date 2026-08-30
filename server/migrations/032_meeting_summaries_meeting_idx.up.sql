CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_summaries_meeting ON meeting_summaries (meeting_id, created_at);
