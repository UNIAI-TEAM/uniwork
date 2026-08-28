CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_access_grants_participant ON meeting_access_grants (participant_id, status);
