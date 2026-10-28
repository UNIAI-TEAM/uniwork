-- Active-batch lookup index per folder for the 409 folder_access_batch_running guard (UNI-2244 §5).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_access_batches_ws_folder
  ON document_access_batches (workspace_id, folder_id);
