CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_exports_file_id
  ON audit_exports (file_id) WHERE file_id IS NOT NULL;
