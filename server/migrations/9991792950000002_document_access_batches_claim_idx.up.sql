-- Worker claim index for background folder access batches (UNI-2244 §5).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_access_batches_claim
  ON document_access_batches (status, created_at)
  WHERE status IN ('queued', 'running');
