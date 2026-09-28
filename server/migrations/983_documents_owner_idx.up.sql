-- §13.3 owner surface: list the live documents owned by a work product.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_owner
  ON documents (owner_kind, owner_id)
  WHERE owner_id IS NOT NULL AND archived_at IS NULL;
