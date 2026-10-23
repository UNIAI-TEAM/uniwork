-- The reconciler's sweep over jobs that have not settled (G2-02 / UNI-685).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_office_jobs_live_deadline
  ON office_jobs (deadline_at)
  WHERE state IN ('accepted', 'running');
