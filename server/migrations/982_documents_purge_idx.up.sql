-- The purge job scans archived documents whose grace window expired
-- (C-01 §4.3; UNI-675).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_purge
  ON documents (purge_after)
  WHERE archived_at IS NOT NULL;
