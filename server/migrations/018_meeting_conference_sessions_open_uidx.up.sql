CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_meeting_conference_sessions_open ON meeting_conference_sessions (meeting_id) WHERE status <> 'ENDED' AND status <> 'FAILED';
