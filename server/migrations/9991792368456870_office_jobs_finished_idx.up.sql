-- RETENTION-02 (UNI-1921): the settled-job sweep deletes rows by finished_at.
-- None of the four existing indexes covers it (idempotency, the live
-- fingerprint/deadline partials on accepted/running, output_file_id), so the
-- scan would be a sequential pass over the whole table. CONCURRENTLY, alone in
-- this file (Database and Migration Rules: an index never shares a migration).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_office_jobs_finished
    ON office_jobs (finished_at)
    WHERE finished_at IS NOT NULL;
