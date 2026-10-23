-- Restore-by-batch reads one workspace's rows of one batch; the partial
-- index covers exactly the rows that carry a batch (CONCURRENTLY, alone -
-- ADR 0001).
CREATE INDEX CONCURRENTLY idx_documents_archive_batch
  ON documents (organization_id, workspace_id, archive_batch_id) WHERE archive_batch_id IS NOT NULL;
