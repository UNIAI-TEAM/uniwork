CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_edit_locks_org_user
  ON document_edit_locks (organization_id, user_id) WHERE ended_at IS NULL;
