-- Jobs belong to a file: org/file teardown and claim-time cleanup lookup go
-- through file_id.
CREATE INDEX CONCURRENTLY idx_file_jobs_file ON file_jobs (file_id);
