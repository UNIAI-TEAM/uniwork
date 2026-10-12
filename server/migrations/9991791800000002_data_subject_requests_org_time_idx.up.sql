CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_data_subject_requests_org_time
  ON data_subject_requests (organization_id, created_at DESC);
