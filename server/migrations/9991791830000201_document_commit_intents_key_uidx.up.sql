-- One intent per Idempotency-Key in a workspace, the same scope the
-- idempotency_keys ledger uses for documents.versions.commit.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_document_commit_intents_key
  ON document_commit_intents (organization_id, workspace_id, idempotency_key);
