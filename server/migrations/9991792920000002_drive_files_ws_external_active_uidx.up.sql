CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_files_ws_external_active_uidx
  ON drive_files (workspace_id, external_file_id)
  WHERE unlinked_at IS NULL;
