-- "Recent documents" listing for the workspace (C-01 §3.1; UNI-675).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_ws_updated
  ON documents (workspace_id, updated_at DESC)
  WHERE archived_at IS NULL AND owner_id IS NULL;
