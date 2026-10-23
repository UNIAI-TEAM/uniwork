-- One live job per (file, operation): a second cleanup/reconcile for the same
-- file enqueues nothing (spec 9.4 - same-kind jobs dedupe while one is live).
CREATE UNIQUE INDEX CONCURRENTLY uidx_file_jobs_live
  ON file_jobs (file_id, operation) WHERE status IN ('pending', 'leased');
