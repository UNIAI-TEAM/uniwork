CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_folder_uploads_open_expires
  ON document_folder_uploads (expires_at)
  WHERE status = 'open';
