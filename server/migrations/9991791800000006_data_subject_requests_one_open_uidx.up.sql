CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_data_subject_requests_one_open
  ON data_subject_requests (organization_id)
  WHERE completed_at IS NULL AND failed_at IS NULL AND cancelled_at IS NULL;
