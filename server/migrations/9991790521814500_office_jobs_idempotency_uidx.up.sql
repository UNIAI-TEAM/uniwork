-- One job per idempotency key in a workspace (G2-02 / UNI-685): a retry with
-- the same key reads this row or replays its output, never a second job.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_office_jobs_idempotency
  ON office_jobs (organization_id, workspace_id, idempotency_key);
