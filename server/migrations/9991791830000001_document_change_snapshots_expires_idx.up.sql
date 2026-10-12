CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_change_snapshots_expires
  ON document_change_snapshots (expires_at);
