-- At most one open run per meeting: the Start request and the 15 s sweep may
-- both try to dispatch, and only the insert that wins sends one.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_meeting_scribe_runs_open
  ON meeting_scribe_runs (meeting_id) WHERE status IN ('DISPATCHED', 'ACTIVE');
