-- At most one item per meeting is open for voting; a racing second open hits 23505.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_meeting_motions_open ON meeting_motions (meeting_id) WHERE status = 'OPEN';
