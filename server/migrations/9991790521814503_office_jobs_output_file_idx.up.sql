-- FileService reference lookups by output file id (G2-02 / UNI-685).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_office_jobs_output_file
  ON office_jobs (output_file_id)
  WHERE output_file_id IS NOT NULL;
