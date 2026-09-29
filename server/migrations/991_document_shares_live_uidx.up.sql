-- At most one live share per (document, principal) (C-01 §3.4; UNI-675);
-- re-granting a revoked principal inserts a fresh row.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_document_shares_live
  ON document_shares (document_id, principal_type, principal_id)
  WHERE revoked_at IS NULL;
