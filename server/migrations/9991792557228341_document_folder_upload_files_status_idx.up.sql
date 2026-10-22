CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_folder_upload_files_status
  ON document_folder_upload_files (batch_id, status);
