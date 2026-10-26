-- The runs of one meeting, newest first: the sweep reads the latest one.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_scribe_runs_meeting
  ON meeting_scribe_runs (meeting_id, created_at);
