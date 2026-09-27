-- The "Chia sẻ" panel lists a document's live links (C-01 §3.5; UNI-675).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_share_links_doc
  ON document_share_links (document_id)
  WHERE revoked_at IS NULL;
