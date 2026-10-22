CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_document_folder_upload_files_key
  ON document_folder_upload_files (batch_id, file_key);
