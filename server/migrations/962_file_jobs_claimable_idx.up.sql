-- Worker claim scan: pending jobs ordered by when they may next run.
CREATE INDEX CONCURRENTLY idx_file_jobs_claimable
  ON file_jobs (next_attempt_at, id) WHERE status = 'pending';
