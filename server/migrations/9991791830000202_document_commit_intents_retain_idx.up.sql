-- The retention sweep scans by retain_until (G5-07).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_commit_intents_retain
  ON document_commit_intents (retain_until);
