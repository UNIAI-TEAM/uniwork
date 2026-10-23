CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_folder_uploads_open_creator
  ON document_folder_uploads (organization_id, created_by)
  WHERE status = 'open';
