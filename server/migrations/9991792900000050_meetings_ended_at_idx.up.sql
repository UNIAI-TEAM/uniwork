-- follow-2: the pending-items nudge reads ENDED meetings by when they ended.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meetings_ended_at ON meetings ((COALESCE(actual_end_at, ends_at))) WHERE status = 'ENDED';
