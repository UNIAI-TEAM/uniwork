-- "Shared with me": live shares pointing at a principal (C-01 §5.3; UNI-675).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_shares_principal
  ON document_shares (principal_type, principal_id)
  WHERE revoked_at IS NULL;
